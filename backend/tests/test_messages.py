"""消息体解析与可选 llm_source。"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import pytest
from fastapi.testclient import TestClient

from app.api.messages import RequestError, parse_message
from app.config import Settings
from app.llm.protocol import AssistantMessage
from app.main import create_app


def test_parse_message_allows_optional_llm_source():
    assert parse_message({"content": "你好"}) == ("你好", None)
    assert parse_message({"content": "你好", "llm_source": "local"}) == ("你好", "local")
    assert parse_message({"content": "你好", "llm_source": "dotenv"}) == ("你好", "dotenv")


def test_parse_message_rejects_invalid_source_and_extra_keys():
    with pytest.raises(RequestError):
        parse_message({"content": "你好", "llm_source": "other"})
    with pytest.raises(RequestError):
        parse_message({"content": "你好", "extra": 1})
    with pytest.raises(RequestError):
        parse_message({"content": "你好", "llm_source": None})


def test_message_with_incomplete_local_source_is_rejected(monkeypatch, tmp_path):
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=_ok))
    _register(client)
    conversation_id = client.post("/api/conversations").json()["conversation_id"]
    response = client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"content": "你好", "llm_source": "local"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_input"


def test_dotenv_llm_source_uses_file_credentials(monkeypatch, tmp_path):
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            seen["model"] = body.get("model")
            seen["authorization"] = self.headers.get("Authorization")
            payload = json.dumps(
                {"choices": [{"message": {"content": "来自文件配置", "tool_calls": None}}]}
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        env_file = tmp_path / ".env"
        env_file.write_text(
            f"LLM_BASE_URL=http://127.0.0.1:{port}\nLLM_API_KEY=file-key\nLLM_MODEL=file-model\n",
            encoding="utf-8",
        )
        client = TestClient(
            create_app(
                Settings(data_dir=tmp_path, auth_secret="test-secret-value"),
                complete=_ok,
                env_file=env_file,
            )
        )
        _register(client)
        conversation_id = client.post("/api/conversations").json()["conversation_id"]
        accepted = client.post(
            f"/api/conversations/{conversation_id}/messages",
            json={"content": "用文件模型", "llm_source": "dotenv"},
        )
        assert accepted.status_code == 202
        task = _wait(client, accepted.json()["task_id"])
        assert task["status"] == "succeeded"
        assert task["reply"] == "来自文件配置"
        assert seen["model"] == "file-model"
        assert seen["authorization"] == "Bearer file-key"
    finally:
        server.shutdown()


def _register(client):
    response = client.post("/api/auth/register", json={"username": "teacher", "password": "correct-horse"})
    assert response.status_code == 201


def _ok(messages, tools):
    return AssistantMessage(content="默认回复", tool_calls=[])


def _wait(client, task_id):
    import time

    for _ in range(50):
        body = client.get(f"/api/tasks/{task_id}").json()
        if body["status"] in {"succeeded", "failed"}:
            return body
        time.sleep(0.02)
    raise AssertionError("task did not finish")
