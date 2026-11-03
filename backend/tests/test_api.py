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

    def complete(messages, tools, sink=None):
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

    def complete(messages, tools, sink=None):
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


def _ok(messages, tools, sink=None):
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


def test_owner_stream_shows_text_before_the_saved_reply(tmp_path):
    started = threading.Event()
    release = threading.Event()

    def complete(messages, tools, sink=None):
        if sink is not None:
            sink.delta("可以")
            started.set()
            assert release.wait(2)
            sink.delta("先举一个例子。")
        return AssistantMessage(content="可以先举一个例子。", tool_calls=[])

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client)
    conversation_id = client.post("/api/conversations").json()["conversation_id"]
    accepted = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "怎么讲通分"})
    task_id = accepted.json()["task_id"]
    assert started.wait(2)
    running = client.get(f"/api/tasks/{task_id}").json()
    assert running["status"] == "running"
    assert running["reply"] is None
    box = {"text": "", "status": None}

    def read():
        with client.stream("GET", f"/api/tasks/{task_id}/stream") as response:
            box["status"] = response.status_code
            parts = []
            for chunk in response.iter_text():
                parts.append(chunk)
                box["text"] = "".join(parts)

    reader = threading.Thread(target=read)
    reader.start()
    for _ in range(100):
        if "event: snapshot" in box["text"]:
            break
        time.sleep(0.02)
    release.set()
    reader.join(3)

    assert reader.is_alive() is False
    assert box["status"] == 200
    assert '"text":"可以"' in box["text"]
    assert "event: delta" in box["text"]
    assert "先举一个例子。" in box["text"]
    assert "event: done" in box["text"]
    assert client.get(f"/api/tasks/{task_id}").json()["reply"] == "可以先举一个例子。"


def test_stream_hides_other_teachers_and_anonymous_callers(tmp_path):
    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=_ok))
    _register(client)
    conversation_id = client.post("/api/conversations").json()["conversation_id"]
    task_id = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "你好"}).json()["task_id"]
    assert _wait(client, task_id)["status"] == "succeeded"
    other = TestClient(client.app)
    registered = other.post("/api/auth/register", json={"username": "other", "password": "correct-horse"})
    assert registered.status_code == 201
    assert other.get(f"/api/tasks/{task_id}/stream").status_code == 404
    stranger = TestClient(client.app)
    assert stranger.get(f"/api/tasks/{task_id}/stream").status_code == 401


def test_failed_stream_drops_partial_text_and_keeps_the_previous_reply(tmp_path):
    from app.llm.protocol import ModelError

    steps = [
        AssistantMessage(content="第一句记下了。", tool_calls=[]),
        ModelError(code="model_timeout", message="timeout"),
    ]

    def complete(messages, tools, sink=None):
        result = steps.pop(0)
        if sink is not None and isinstance(result, ModelError):
            sink.delta("半段")
        return result

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client)
    conversation_id = client.post("/api/conversations").json()["conversation_id"]
    first = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "先记住"})
    assert _wait(client, first.json()["task_id"])["status"] == "succeeded"
    second = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "这句会失败"})
    failed = _wait(client, second.json()["task_id"])
    assert failed["status"] == "failed"
    assert failed["reply"] is None
    with client.stream("GET", f"/api/tasks/{second.json()['task_id']}/stream") as response:
        body = "".join(response.iter_text())
    assert "event: error" in body
    assert "半段" not in body
    history = client.get(f"/api/conversations/{conversation_id}").json()["messages"]
    assert [(item["role"], item["content"]) for item in history] == [
        ("user", "先记住"),
        ("assistant", "第一句记下了。"),
        ("user", "这句会失败"),
    ]
