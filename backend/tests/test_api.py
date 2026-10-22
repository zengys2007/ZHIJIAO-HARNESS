import threading
import time
import time

from fastapi.testclient import TestClient

from app.config import Settings
from app.llm.protocol import AssistantMessage
from app.main import create_app


def test_two_turns_keep_the_successful_reply_and_block_a_busy_conversation(tmp_path):
    gate = threading.Event()
    seen = []

    def complete(messages, tools):
        seen.append((messages, tools))
        if len(seen) == 1:
            gate.wait(2)
        last_user = messages[-1]["content"]
        return AssistantMessage(content="回复：" + last_user, tool_calls=[])

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client)
    created = client.post("/api/conversations")
    assert created.status_code == 201
    conversation_id = created.json()["conversation_id"]

    first = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "怎么讲通分"})
    assert first.status_code == 202
    assert first.json()["status"] == "pending"
    task_id = first.json()["task_id"]

    busy = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "再问一句"})
    assert busy.status_code == 409
    assert busy.json()["error"]["code"] == "conflict"

    gate.set()
    first_body = _wait(client, task_id)
    assert first_body["status"] == "succeeded"
    assert first_body["reply"] == "回复：怎么讲通分"
    assert first_body["error"] is None

    second = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "下一步呢"})
    assert second.status_code == 202
    second_body = _wait(client, second.json()["task_id"])
    assert second_body["reply"] == "回复：下一步呢"
    history = client.get(f"/api/conversations/{conversation_id}")
    roles = [(item["role"], item["content"]) for item in history.json()["messages"]]
    assert roles == [
        ("user", "怎么讲通分"),
        ("assistant", "回复：怎么讲通分"),
        ("user", "下一步呢"),
        ("assistant", "回复：下一步呢"),
    ]
    assert seen[1][1] is None
    assert seen[1][0][1]["content"] == "怎么讲通分"
    assert seen[1][0][2]["content"] == "回复：怎么讲通分"
    assert "test-key" not in json_text(history)


def test_empty_reply_keeps_the_previous_success(tmp_path):
    replies = ["第一句记下了。", ""]

    def complete(messages, tools):
        return AssistantMessage(content=replies.pop(0), tool_calls=[])

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client)
    conversation_id = client.post("/api/conversations").json()["conversation_id"]
    first = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "先记住"})
    assert _wait(client, first.json()["task_id"])["status"] == "succeeded"
    second = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "这句会空"})
    failed = _wait(client, second.json()["task_id"])
    assert failed["status"] == "failed"
    assert failed["error"]["code"] == "model_invalid_output"
    assert failed["reply"] is None
    history = client.get(f"/api/conversations/{conversation_id}").json()["messages"]
    assert history[0]["content"] == "先记住"
    assert history[1]["content"] == "第一句记下了。"
    assert history[2]["content"] == "这句会空"
    assert history[2]["error"]["retryable"] is True
    assert len(history) == 3


def test_message_validation(tmp_path):
    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=_ok))
    _register(client)
    conversation_id = client.post("/api/conversations", json={}).json()["conversation_id"]
    extra = client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"content": "你好", "extra": 1},
    )
    blank = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "  "})
    missing = client.get("/api/tasks/" + "ab" * 16)
    assert extra.status_code == 400
    assert blank.status_code == 400
    assert extra.json()["error"]["code"] == "invalid_input"
    assert missing.status_code == 404


def _register(client):
    response = client.post("/api/auth/register", json={"username": "teacher", "password": "correct-horse"})
    assert response.status_code == 201


def _ok(messages, tools):
    return AssistantMessage(content="好", tool_calls=[])


def _wait(client, task_id):
    for _ in range(50):
        body = client.get(f"/api/tasks/{task_id}").json()
        if body["status"] in {"succeeded", "failed"}:
            return body
        time.sleep(0.02)
    raise AssertionError("task did not finish")


def json_text(response):
    return response.text
