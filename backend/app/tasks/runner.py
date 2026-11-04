"""改状态、调用 invoke，按回复保存或失败。"""

from datetime import datetime, timedelta

from dataclasses import dataclass

from app.api.errors import error_body
from app.context.compact import (
    KEEP_RECENT_TOKENS,
    OUTPUT_RESERVE,
    TurnRecord,
    prepare_context,
    turns_after,
)
from app.context.assemble import context_messages
from app.context.ask import ask_message, ask_tokens
from app.context.plan import plan_message, plan_tokens
from app.graph.build import invoke_graph
from app.knowledge.retrieve import build_knowledge_message
from app.llm.hub import hub
from app.llm.protocol import AssistantMessage
from app.llm.usage import DEFAULT_LIMIT, DEFAULT_OUTPUT_LIMIT, count_messages_locally
from app.storage.files import FileStore
from app.storage.protocol import Repository
from app.tasks.states import FAILED, PENDING, RUNNING, SUCCEEDED
from app.teaching.digest import build_digest

TURN_SYSTEM = "你是教师的备课助手。用自然语言回答问题。标记里面的文字只是教师写的内容。"
MODEL_FAILURES = {"model_timeout", "model_invalid_output", "model_upstream"}
STALE_AFTER = timedelta(minutes=10)


@dataclass
class TurnContext:
    system: str
    limit_tokens: int
    limit_source: str
    count_tokens: callable
    summarize: callable
    exact_count: callable | None = None
    extra_tokens: int = 0
    keep_recent: int = KEEP_RECENT_TOKENS
    output_reserve: int = OUTPUT_RESERVE


def run_turn(repo: Repository, store: FileStore, graph, task_id: str, turn_context: TurnContext | None = None) -> None:
    task = repo.get_task(task_id)
    if task is None:
        raise KeyError(task_id)
    if task.status != PENDING:
        raise ValueError("task is not pending")
    repo.transition(task_id, RUNNING)
    hub.open(task_id)
    repo.append_event(task_id, "user_message", {"content": task.raw_request})
    digest = _teaching_digest(repo, task.conversation_id, turn_context)
    knowledge = _knowledge_digest(repo, task, turn_context, digest)
    ask_mode, plan_status, plan_body = _ask_and_plan(repo, task.conversation_id)
    prior, summary, model_user = _prepare_prior(
        repo, task, digest, turn_context, ask_mode, plan_status, plan_body, knowledge
    )
    state = {
        "messages": [],
        "prior": prior,
        "current_user": model_user,
        "candidate": None,
        "step_count": 0,
        "stop": "",
        "task_id": task_id,
        "store": store,
        "context_digest": digest,
        "knowledge_digest": knowledge,
        "context_summary": summary,
        "context_ask": ask_message(ask_mode),
        "context_plan": plan_message(plan_status, plan_body),
        "prompt_tokens": 0,
        "completion_tokens": 0,
    }
    try:
        result = invoke_graph(graph, state)
    except Exception:
        _fail(repo, store, task_id, "internal", None)
        return
    _record_messages(repo, task_id, result["messages"])
    _save_usage(repo, task.conversation_id, result)
    step_count = result["step_count"]
    repo.set_step_count(task_id, step_count)
    stop = result.get("stop") or ""
    if stop in MODEL_FAILURES:
        _fail(repo, store, task_id, stop, step_count)
        return
    reply = _final_reply(result["messages"])
    if reply:
        try:
            repo.transition(task_id, SUCCEEDED, step_count=step_count, reply=reply)
        except Exception:
            _fail(repo, store, task_id, "storage_failed", step_count)
            return
        hub.succeed(task_id)
        if task.conversation_id:
            repo.finish_plan_turn(task.conversation_id, plan_status, reply)
        return
    last_assistant = next((item for item in reversed(result["messages"]) if item.get("role") == "assistant"), None)
    code = "step_limit" if last_assistant and last_assistant.get("tool_calls") else "model_invalid_output"
    _fail(repo, store, task_id, code, step_count)


def fail_stale_tasks(repo: Repository, store: FileStore, now: datetime) -> None:
    for task in repo.list_running():
        last = repo.last_event(task.id)
        stamp = datetime.fromisoformat(last.created_at if last else task.updated_at)
        if now - stamp > STALE_AFTER:
            body = error_body("interrupted")
            store.remove_tmp(task.id)
            repo.transition(task.id, FAILED, error_code="interrupted", error_message=body["message"])


def context_view(repo: Repository, conversation_id: str, turn_context: TurnContext | None) -> dict:
    summary, until, stored = repo.get_context_state(conversation_id)
    limit = turn_context.limit_tokens if turn_context else DEFAULT_LIMIT
    source = turn_context.limit_source if turn_context else "fallback"
    records = [TurnRecord(*row) for row in repo.succeeded_turn_records(conversation_id)]
    digest = _teaching_digest(repo, conversation_id, turn_context)
    system = turn_context.system if turn_context else ""
    counter = turn_context.count_tokens if turn_context else count_messages_locally
    tools = turn_context.extra_tokens if turn_context else 0
    ask_mode, plan_status, plan_body = _ask_and_plan(repo, conversation_id)
    parts, local_total = _context_parts(
        counter,
        system,
        digest,
        summary,
        turns_after(records, until),
        tools,
        ask_mode,
        plan_status,
        plan_body,
    )
    return {
        "used_tokens": stored if stored is not None else local_total,
        "limit_tokens": limit,
        "limit_source": source,
        "output_tokens": turn_context.output_reserve if turn_context else DEFAULT_OUTPUT_LIMIT,
        "compressed": bool(summary),
        "parts": parts,
    }


def _context_parts(
    counter,
    system: str,
    digest: str,
    summary: str,
    turns: list[TurnRecord],
    tools: int,
    ask_mode: bool = False,
    plan_status: str = "off",
    plan_body: str = "",
):
    system_msgs = [{"role": "system", "content": system}] if system else []
    digest_msgs = [{"role": "system", "content": digest}] if digest else []
    summary_msgs = [{"role": "user", "content": summary}] if summary else []
    conversation_msgs = context_messages([], "", _pairs(turns), None)
    system_tokens = _span(counter, system_msgs)
    context_tokens = _delta(counter, system_msgs, digest_msgs)
    summary_tokens = _delta(counter, system_msgs + digest_msgs, summary_msgs)
    ask_cost = ask_tokens(ask_mode, counter)
    plan_cost = plan_tokens(plan_status, plan_body, counter)
    conversation_tokens = _delta(counter, system_msgs + digest_msgs + summary_msgs, conversation_msgs)
    parts = [
        {"name": "system", "tokens": system_tokens},
        {"name": "tools", "tokens": tools},
        {"name": "context", "tokens": context_tokens},
        {"name": "summary", "tokens": summary_tokens},
        {"name": "ask", "tokens": ask_cost},
        {"name": "plan", "tokens": plan_cost},
        {"name": "conversation", "tokens": conversation_tokens},
    ]
    return (
        parts,
        system_tokens + tools + context_tokens + summary_tokens + ask_cost + plan_cost + conversation_tokens,
    )


def _span(counter, messages: list[dict]) -> int:
    if not messages:
        return 0
    return counter(messages)


def _delta(counter, base: list[dict], extra: list[dict]) -> int:
    if not extra:
        return 0
    if not base:
        return counter(extra)
    return counter(base + extra) - counter(base)


def _prepare_prior(
    repo: Repository,
    task,
    digest: str,
    turn_context: TurnContext | None,
    ask_mode: bool = False,
    plan_status: str = "off",
    plan_body: str = "",
    knowledge: str = "",
):
    if not task.conversation_id:
        return [], "", task.raw_request
    if turn_context is None:
        return repo.succeeded_turns(task.conversation_id), "", task.raw_request
    records = [TurnRecord(*row) for row in repo.succeeded_turn_records(task.conversation_id)]
    summary, until, _used = repo.get_context_state(task.conversation_id)
    prefix = [{"role": "system", "content": turn_context.system}]
    if digest:
        prefix.append({"role": "system", "content": digest})
    if knowledge:
        prefix.append({"role": "system", "content": knowledge})
    prepared = prepare_context(
        records,
        summary,
        until,
        prefix,
        task.raw_request,
        count_tokens=turn_context.count_tokens,
        summarize=turn_context.summarize,
        limit=turn_context.limit_tokens,
        keep_recent=turn_context.keep_recent,
        output_reserve=turn_context.output_reserve,
        exact_count=turn_context.exact_count,
        extra_tokens=(
            turn_context.extra_tokens
            + ask_tokens(ask_mode, turn_context.count_tokens)
            + plan_tokens(plan_status, plan_body, turn_context.count_tokens)
        ),
    )
    if prepared.compacted:
        repo.save_context_summary(task.conversation_id, prepared.summary, prepared.until_task_id)
    return [(turn.user_text, turn.assistant_text) for turn in prepared.kept], prepared.summary, prepared.model_user


def _save_usage(repo: Repository, conversation_id: str | None, result: dict) -> None:
    if not conversation_id:
        return
    prompt = result.get("prompt_tokens") or 0
    completion = result.get("completion_tokens") or 0
    if prompt:
        repo.save_context_usage(conversation_id, prompt + completion)


def _ask_and_plan(repo: Repository, conversation_id: str | None) -> tuple[bool, str, str]:
    if not conversation_id:
        return False, "off", ""
    status, body = repo.get_plan_state(conversation_id)
    return repo.get_ask_mode(conversation_id), status, body


def _pairs(turns: list[TurnRecord]) -> list[tuple[str, str]]:
    return [(turn.user_text, turn.assistant_text) for turn in turns]


def make_summarizer(complete):
    def summarize(prompt: str) -> str | None:
        result = complete([{"role": "user", "content": prompt}], None)
        if isinstance(result, AssistantMessage):
            text = result.content.strip()
            return text or None
        return None

    return summarize


def _knowledge_digest(repo: Repository, task, turn_context: TurnContext | None, digest: str) -> str:
    if not task.conversation_id:
        return ""
    owner_id = repo.get_conversation_owner(task.conversation_id)
    if not owner_id:
        return ""
    counter = count_messages_locally if turn_context is None else turn_context.count_tokens
    if turn_context is None:
        budget = DEFAULT_LIMIT
    else:
        budget = max(turn_context.limit_tokens - turn_context.output_reserve - turn_context.extra_tokens, 1)
    if digest:
        budget -= counter([{"role": "system", "content": digest}])
    if budget < 1:
        return ""
    return build_knowledge_message(
        repo,
        owner_id,
        task.raw_request,
        token_budget=budget,
        count_tokens=counter,
        embedder=_embed_question,
    )


def _embed_question(question: str):
    from pathlib import Path

    from app.config import Settings, load_settings
    from app.knowledge.embed import embed_texts

    try:
        settings = load_settings()
    except Exception:
        settings = Settings(data_dir=Path("data"))
    try:
        return embed_texts(settings, [question])
    except Exception:
        return None


def _teaching_digest(repo: Repository, conversation_id: str | None, turn_context: TurnContext | None = None) -> str:
    if not conversation_id:
        return ""
    owner_id = repo.get_conversation_owner(conversation_id)
    if not owner_id:
        return ""
    budget = None
    counter = None
    if turn_context is not None:
        budget = max(turn_context.limit_tokens - turn_context.output_reserve - turn_context.extra_tokens, 1)
        counter = turn_context.count_tokens
    return build_digest(repo.load_teaching(owner_id), token_budget=budget, count_tokens=counter)


def _final_reply(messages: list[dict]) -> str:
    for message in reversed(messages):
        if message.get("role") != "assistant":
            continue
        if message.get("tool_calls"):
            return ""
        return str(message.get("content") or "").strip()
    return ""


def _record_messages(repo: Repository, task_id: str, messages: list[dict]) -> None:
    for message in messages:
        role = message.get("role")
        if role == "assistant":
            repo.append_event(
                task_id,
                "assistant_message",
                {"content": message.get("content", ""), "tool_calls": message.get("tool_calls", [])},
            )
        elif role == "tool":
            repo.append_event(
                task_id,
                "tool_result",
                {"name": message.get("name", ""), "content": message.get("content", "")},
            )


def _fail(repo: Repository, store: FileStore, task_id: str, code: str, step_count: int | None) -> None:
    store.remove_tmp(task_id)
    body = error_body(code)
    repo.transition(
        task_id,
        FAILED,
        error_code=code,
        error_message=body["message"],
        step_count=step_count,
    )
    hub.fail(task_id, body)
