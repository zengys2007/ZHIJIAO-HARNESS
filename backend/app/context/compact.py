"""接近窗口上限时，把更早的成功轮换成交接摘要。

摘要文案与 Codex 的本地压缩一致。最近原文按 token 预算保留，从一整轮的边界切开。
原文任务不在这里删除。
"""

from dataclasses import dataclass

from app.context.assemble import context_messages

SUMMARY_PREFIX = (
    "Another language model started to solve this problem and produced a summary of its thinking process. "
    "You also have access to the state of the tools that were used by that language model. "
    "Use this to build on the work that has already been done and avoid duplicating work. "
    "Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:"
)
SUMMARIZATION_PROMPT = """You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work."""

OUTPUT_RESERVE = 2000
KEEP_RECENT_TOKENS = 20_000


@dataclass(frozen=True)
class TurnRecord:
    task_id: str
    user_text: str
    assistant_text: str


@dataclass(frozen=True)
class PreparedContext:
    kept: list[TurnRecord]
    summary: str
    until_task_id: str
    compacted: bool
    messages: list[dict]
    model_user: str


def prepare_context(
    turns: list[TurnRecord],
    stored_summary: str,
    until_task_id: str,
    prefix: list[dict],
    current_user: str,
    *,
    count_tokens,
    summarize,
    limit: int,
    keep_recent: int = KEEP_RECENT_TOKENS,
    output_reserve: int = OUTPUT_RESERVE,
    exact_count=None,
    extra_tokens: int = 0,
) -> PreparedContext:
    base_count = count_tokens

    def count_tokens(messages):
        return base_count(messages) + extra_tokens

    open_turns = turns_after(turns, until_task_id)
    full = context_messages(prefix, stored_summary, _pairs(open_turns), current_user)

    def measured(messages: list[dict]) -> int:
        if exact_count is not None:
            found = exact_count(messages)
            if isinstance(found, int):
                return found + extra_tokens
        return count_tokens(messages)

    budget = max(limit - output_reserve, 1)
    if not _should_compact(measured(full), limit, output_reserve):
        return _fit_current(
            open_turns, stored_summary, until_task_id, False, current_user, prefix, count_tokens, summarize, budget
        )

    folded, kept = _split_recent(open_turns, prefix, current_user, count_tokens, keep_recent, budget)
    if not folded:
        return _fit_current(
            open_turns, stored_summary, until_task_id, False, current_user, prefix, count_tokens, summarize, budget
        )

    body = summarize(_summarization_input(summary_body(stored_summary), folded))
    if not body or not str(body).strip():
        kept_after_drop = _drop_until_fit(open_turns, prefix, stored_summary, current_user, count_tokens, budget)
        return _fit_current(
            kept_after_drop,
            stored_summary,
            until_task_id,
            False,
            current_user,
            prefix,
            count_tokens,
            summarize,
            budget,
        )

    summary = SUMMARY_PREFIX + "\n" + str(body).strip()
    while kept and count_tokens(context_messages(prefix, summary, _pairs(kept), current_user)) > budget:
        kept = kept[1:]
    return _fit_current(kept, summary, folded[-1].task_id, True, current_user, prefix, count_tokens, summarize, budget)


def turns_after(turns: list[TurnRecord], until_task_id: str) -> list[TurnRecord]:
    if not until_task_id:
        return list(turns)
    ids = [turn.task_id for turn in turns]
    if until_task_id not in ids:
        return list(turns)
    return turns[ids.index(until_task_id) + 1 :]


def summary_body(stored: str) -> str:
    if stored.startswith(SUMMARY_PREFIX):
        return stored[len(SUMMARY_PREFIX) :].lstrip("\n")
    return stored


def _should_compact(count: int, limit: int, output_reserve: int) -> bool:
    if limit <= 0:
        return False
    budget = limit - output_reserve
    return count >= (limit * 9) // 10 or (budget > 0 and count > budget)


def _split_recent(turns, prefix, current_user, count_tokens, keep_recent: int, budget: int):
    kept: list[TurnRecord] = []
    for turn in reversed(turns):
        trial = [turn, *kept]
        tail_cost = count_tokens(context_messages([], "", _pairs(trial), None))
        total = count_tokens(context_messages(prefix, "", _pairs(trial), current_user))
        if tail_cost > keep_recent or total > budget:
            break
        kept = trial
    folded = turns[: len(turns) - len(kept)]
    return folded, kept


def _drop_until_fit(turns, prefix, summary, current_user, count_tokens, budget: int):
    kept = list(turns)
    while kept and count_tokens(context_messages(prefix, summary, _pairs(kept), current_user)) > budget:
        kept = kept[1:]
    return kept


def _fit_current(kept, summary, until, compacted, current_user, prefix, count_tokens, summarize, budget: int):
    messages = context_messages(prefix, summary, _pairs(kept), current_user)
    if count_tokens(messages) <= budget:
        return PreparedContext(kept, summary, until, compacted, messages, current_user)
    body = summarize(SUMMARIZATION_PROMPT + "\n\nUser:\n" + current_user)
    candidate = str(body).strip() if body else ""
    if candidate:
        messages = context_messages(prefix, summary, _pairs(kept), candidate)
        if count_tokens(messages) <= budget:
            return PreparedContext(kept, summary, until, compacted, messages, candidate)
        current_user = candidate
    fitted = _trim_to_budget(prefix, summary, kept, current_user, count_tokens, budget)
    messages = context_messages(prefix, summary, _pairs(kept), fitted)
    return PreparedContext(kept, summary, until, compacted, messages, fitted)


def _trim_to_budget(prefix, summary, kept, text: str, count_tokens, budget: int) -> str:
    lo = 0
    hi = len(text)
    best = ""
    while lo <= hi:
        mid = (lo + hi) // 2
        piece = text[:mid]
        size = count_tokens(context_messages(prefix, summary, _pairs(kept), piece))
        if size <= budget:
            best = piece
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def _pairs(turns: list[TurnRecord]) -> list[tuple[str, str]]:
    return [(turn.user_text, turn.assistant_text) for turn in turns]


def _summarization_input(previous_body: str, turns: list[TurnRecord]) -> str:
    lines = [SUMMARIZATION_PROMPT, ""]
    if previous_body:
        lines.append(previous_body)
        lines.append("")
    for turn in turns:
        lines.append("User:\n" + turn.user_text)
        lines.append("Assistant:\n" + turn.assistant_text)
    return "\n".join(lines)
