import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.auth.passwords import hash_password
from app.config import Settings
from app.context.assemble import assemble_model_input
from app.context.compact import (
    OUTPUT_RESERVE,
    SUMMARY_PREFIX,
    TurnRecord,
    prepare_context,
)
from app.graph.build import build_graph
from app.llm.protocol import AssistantMessage
from app.llm.usage import count_messages_locally, parse_context_limit, parse_input_tokens
from app.main import create_app
from app.storage.files import FileStore
from app.storage.repository import SqliteRepository
from app.tasks.runner import TurnContext, run_turn
from app.tools.registry import production_registry
from fastapi.testclient import TestClient


def test_parse_context_limit_reads_known_provider_fields():
    payload = {
        "data": [
            {"id": "other", "context_window": 32000},
            {"id": "teacher-model", "max_model_len": 1_000_000},
        ]
    }
    assert parse_context_limit(payload, "teacher-model") == 1_000_000
    assert parse_context_limit({"data": [{"id": "teacher-model", "context_length": 500_000}]}, "teacher-model") == 500_000
    assert parse_context_limit({"data": [{"id": "teacher-model"}]}, "teacher-model") is None
    assert parse_input_tokens({"object": "response.input_tokens", "input_tokens": 42}) == 42


def test_local_count_adds_message_overhead():
    import tiktoken

    encoding = tiktoken.get_encoding("o200k_base")
    messages = [{"role": "user", "content": "hello"}, {"role": "assistant", "content": "world"}]
    expected = 3 + sum(4 + len(encoding.encode(item["content"])) for item in messages)
    assert count_messages_locally(messages) == expected


def test_provider_count_and_model_window_come_from_the_compat_endpoints():
    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            seen["get"] = self.path
            body = json.dumps({"data": [{"id": "teacher-model", "context_window": 128_000}]}).encode("utf-8")
            self._send(body)

        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            seen["post"] = self.path
            seen["body"] = json.loads(self.rfile.read(length).decode("utf-8"))
            body = json.dumps({"object": "response.input_tokens", "input_tokens": 17}).encode("utf-8")
            self._send(body)

        def _send(self, body: bytes):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        settings = Settings(
            data_dir=__import__("pathlib").Path("."),
            llm_base_url=f"http://127.0.0.1:{port}/v1",
            llm_api_key="test-key",
            llm_model="teacher-model",
            llm_timeout_seconds=5,
        )
        from app.llm.usage import fetch_context_limit, fetch_input_tokens

        assert fetch_context_limit(settings) == 128_000
        messages = [{"role": "user", "content": "怎么讲通分"}]
        assert fetch_input_tokens(settings, messages) == 17
        assert seen["get"] == "/v1/models"
        assert seen["post"] == "/v1/responses/input_tokens"
        assert seen["body"]["model"] == "teacher-model"
        assert seen["body"]["input"] == messages
    finally:
        server.shutdown()


def test_compaction_stores_a_summary_and_keeps_a_recent_tail():
    turns = [
        TurnRecord("t1", "旧问题" * 40, "旧回答" * 40),
        TurnRecord("t2", "中问题" * 40, "中回答" * 40),
        TurnRecord("t3", "新问题" * 20, "新回答" * 20),
    ]
    seen = {}

    def count(messages):
        return sum(len(message.get("content") or "") for message in messages)

    def summarize(prompt):
        seen["prompt"] = prompt
        return "交接：已讲完旧内容和中段。"

    prepared = prepare_context(
        turns,
        "",
        "",
        [{"role": "system", "content": "系统"}],
        "当前问题",
        count_tokens=count,
        summarize=summarize,
        limit=650,
        keep_recent=130,
        output_reserve=50,
    )

    assert prepared.compacted is True
    assert prepared.until_task_id == "t2"
    assert prepared.summary.startswith(SUMMARY_PREFIX)
    assert "交接：已讲完旧内容和中段。" in prepared.summary
    assert [turn.task_id for turn in prepared.kept] == ["t3"]
    assert "旧问题" in seen["prompt"]
    assert "新问题" not in seen["prompt"]
    sent = [item["content"] for item in prepared.messages]
    assert "旧问题" * 40 not in sent
    assert "新问题" * 20 in sent
    assert sent[-1] == "当前问题"


def test_long_teacher_message_is_accepted_and_summarized_when_it_exceeds_the_window():
    from app.api.messages import parse_message

    long_text = "甲" * 5000
    assert parse_message({"content": long_text}) == (long_text, None)

    def count(messages):
        return sum(len(message.get("content") or "") for message in messages)

    prepared = prepare_context(
        [],
        "",
        "",
        [{"role": "system", "content": "系统"}],
        long_text,
        count_tokens=count,
        summarize=lambda _prompt: "短问：请讲通分。",
        limit=120,
        keep_recent=40,
        output_reserve=20,
    )

    assert prepared.model_user == "短问：请讲通分。"
    assert prepared.messages[-1]["content"] == "短问：请讲通分。"
    assert prepared.compacted is False


def test_failed_summary_drops_oldest_turns_without_replacing_the_stored_summary():
    turns = [
        TurnRecord("t1", "甲" * 30, "答甲" * 30),
        TurnRecord("t2", "乙" * 10, "答乙" * 10),
    ]

    def count(messages):
        return sum(len(message.get("content") or "") for message in messages)

    prepared = prepare_context(
        turns,
        "已有摘要",
        "",
        [{"role": "system", "content": "系统"}],
        "现在",
        count_tokens=count,
        summarize=lambda _prompt: None,
        limit=120,
        keep_recent=40,
        output_reserve=20,
    )

    assert prepared.compacted is False
    assert prepared.summary == "已有摘要"
    assert prepared.until_task_id == ""
    contents = [item["content"] for item in prepared.messages]
    assert "甲" * 30 not in contents
    assert "乙" * 10 in contents


def test_run_turn_persists_the_summary_and_leaves_original_tasks(tmp_path):
    repo, store, conversation_id, owner_id = _conversation(tmp_path)
    replies = ["第一句。", "第二句。", "第三句。"]

    def complete(messages, tools):
        if messages and messages[0]["role"] == "user" and "CONTEXT CHECKPOINT" in messages[0]["content"]:
            return AssistantMessage(content="摘要：前两轮已讲完。", tool_calls=[])
        return AssistantMessage(content=replies.pop(0), tool_calls=[], prompt_tokens=11, completion_tokens=4)

    graph = build_graph(production_registry(), complete, system="系统")
    context = TurnContext(
        system="系统",
        limit_tokens=80,
        limit_source="fallback",
        count_tokens=lambda messages: sum(len(message.get("content") or "") for message in messages),
        summarize=_summarize_with(complete),
        keep_recent=12,
        output_reserve=10,
    )
    for text in ("甲" * 30, "乙" * 30, "丙" * 8):
        task = repo.submit_message(conversation_id, text, owner_id)
        run_turn(repo, store, graph, task.id, context)

    tasks = repo.list_conversation_tasks(conversation_id, owner_id)
    assert [task.raw_request for task in tasks] == ["甲" * 30, "乙" * 30, "丙" * 8]
    assert all(task.status == "succeeded" for task in tasks)
    summary, until, used = repo.get_context_state(conversation_id)
    assert summary.startswith(SUMMARY_PREFIX)
    assert "摘要：前两轮已讲完。" in summary
    assert until == tasks[1].id
    assert used == 15

    client_messages = assemble_model_input("系统", [], "下一句", [], context_summary=summary)
    assert client_messages[1]["role"] == "user"
    assert "甲" * 30 not in client_messages[1]["content"]


def test_conversation_payload_reports_context_usage(tmp_path):
    from app.llm.protocol import AssistantMessage as Message

    def complete(messages, tools):
        return Message(content="记下了。", tool_calls=[], prompt_tokens=20, completion_tokens=5)

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client)
    conversation_id = client.post("/api/conversations").json()["conversation_id"]
    empty = client.get(f"/api/conversations/{conversation_id}").json()["context"]
    assert empty["limit_tokens"] == 1_000_000
    assert empty["limit_source"] == "fallback"
    assert empty["compressed"] is False
    assert empty["used_tokens"] > 0
    assert [part["name"] for part in empty["parts"]] == [
        "system",
        "tools",
        "context",
        "summary",
        "goal",
        "plan",
        "conversation",
    ]
    assert empty["parts"][0]["tokens"] > 0
    assert empty["parts"][2]["tokens"] == 0

    posted = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "怎么讲通分"})
    _wait(client, posted.json()["task_id"])
    context = client.get(f"/api/conversations/{conversation_id}").json()["context"]
    assert context["used_tokens"] == 25
    assert context["compressed"] is False
    assert OUTPUT_RESERVE == 2000


def _summarize_with(complete):
    def summarize(prompt):
        result = complete([{"role": "user", "content": prompt}], None)
        if isinstance(result, AssistantMessage) and result.content.strip():
            return result.content.strip()
        return None

    return summarize


def _conversation(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    owner = repo.create_user("teacher", "老师", hash_password("correct-horse"))
    return repo, FileStore(tmp_path), repo.create_conversation(owner.id), owner.id


def _register(client: TestClient):
    response = client.post(
        "/api/auth/register",
        json={"username": "teacher", "password": "correct-horse", "display_name": "老师"},
    )
    assert response.status_code == 201


def _wait(client: TestClient, task_id: str):
    for _ in range(50):
        body = client.get(f"/api/tasks/{task_id}").json()
        if body["status"] in {"succeeded", "failed"}:
            return body
        threading.Event().wait(0.02)
    raise AssertionError("timed out")
