import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.config import Settings
from app.llm.complete import make_complete
from app.llm.protocol import AssistantMessage, ModelError


def test_complete_reads_the_first_choice_and_omits_tools_when_empty():
    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            seen["body"] = body
            seen["authorization"] = self.headers.get("Authorization")
            payload = json.dumps(
                {"choices": [{"message": {"content": "可以先举一个例子。", "tool_calls": None}}]}
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
        complete = make_complete(
            Settings(
                data_dir=server.server_address and __import__("pathlib").Path("."),
                llm_base_url=f"http://127.0.0.1:{port}",
                llm_api_key="test-key",
                llm_model="fake",
                llm_timeout_seconds=5,
            )
        )
        result = complete([{"role": "user", "content": "怎么讲通分"}], None)
    finally:
        server.shutdown()

    assert isinstance(result, AssistantMessage)
    assert result.content == "可以先举一个例子。"
    assert "tools" not in seen["body"]
    assert seen["body"]["stream"] is False
    assert seen["body"]["temperature"] == 0.2
    assert seen["authorization"] == "Bearer test-key"
    assert "test-key" not in result.content


def test_upstream_http_error_is_not_retried():
    calls = {"n": 0}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            calls["n"] += 1
            length = int(self.headers.get("Content-Length", "0"))
            self.rfile.read(length)
            payload = b"no"
            self.send_response(503)
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
        complete = make_complete(
            Settings(
                data_dir=__import__("pathlib").Path("."),
                llm_base_url=f"http://127.0.0.1:{port}",
                llm_api_key="test-key",
                llm_model="fake",
                llm_timeout_seconds=5,
            )
        )
        result = complete([{"role": "user", "content": "你好"}], None)
    finally:
        server.shutdown()

    assert isinstance(result, ModelError)
    assert result.code == "model_upstream"
    assert calls["n"] == 1
    assert "no" not in result.message
