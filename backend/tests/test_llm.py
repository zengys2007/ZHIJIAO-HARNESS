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


class _Sink:
    def __init__(self):
        self.deltas = []
        self.resets = 0

    def delta(self, text):
        self.deltas.append(text)

    def reset(self):
        self.resets += 1
        self.deltas.clear()


def test_stream_forwards_content_and_keeps_tool_arguments_on_the_message(tmp_path):
    seen = {}

    def respond(_body):
        chunks = [
            {"choices": [{"delta": {"content": "好"}}]},
            {"choices": [{"delta": {"content": ""}}]},
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {"index": 0, "id": "call-1", "function": {"name": "page", "arguments": ""}}
                            ]
                        }
                    }
                ]
            },
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": '{"a":'}}]}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "1}"}}]}}]},
            {"choices": [], "usage": {"prompt_tokens": 4, "completion_tokens": 3}},
        ]
        lines = "".join(f"data: {json.dumps(item, ensure_ascii=False)}\n\n" for item in chunks)
        return 200, (lines + "data: [DONE]\n\n").encode("utf-8")

    sink = _Sink()
    result, seen = _serve(respond, sink)
    assert isinstance(result, AssistantMessage)
    assert result.content == "好"
    assert sink.deltas == ["好"]
    assert result.tool_calls[0].name == "page"
    assert result.tool_calls[0].arguments == {"a": 1}
    assert result.prompt_tokens == 4
    assert result.completion_tokens == 3
    assert seen["body"]["stream"] is True
    assert "page" not in "".join(sink.deltas)


def test_http_error_while_streaming_is_not_retried():
    calls = {"n": 0}

    def respond(_body):
        calls["n"] += 1
        return 503, b"no"

    sink = _Sink()
    result, _seen = _serve(respond, sink)
    assert isinstance(result, ModelError)
    assert result.code == "model_upstream"
    assert calls["n"] == 1
    assert sink.deltas == []
    assert sink.resets == 0


def test_incomplete_stream_retries_once_and_returns_the_second_text():
    calls = {"n": 0}

    def respond(_body):
        calls["n"] += 1
        if calls["n"] == 1:
            return 200, 'data: {"choices":[{"delta":{"content":"旧"}}]}\n\n'.encode("utf-8")
        done = 'data: {"choices":[{"delta":{"content":"新回复"}}]}\n\ndata: [DONE]\n\n'
        return 200, done.encode("utf-8")

    sink = _Sink()
    result, _seen = _serve(respond, sink)
    assert isinstance(result, AssistantMessage)
    assert result.content == "新回复"
    assert calls["n"] == 2
    assert sink.resets == 1
    assert sink.deltas == ["新回复"]


def test_blank_stream_is_an_assistant_message_of_blank_text():
    def respond(_body):
        raw = 'data: {"choices":[{"delta":{"content":"   "}}]}\n\ndata: [DONE]\n\n'
        return 200, raw.encode("utf-8")

    result, _seen = _serve(respond, _Sink())
    assert isinstance(result, AssistantMessage)
    assert result.content == "   "
    assert result.tool_calls == []


def _serve(respond, sink):
    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            seen["body"] = json.loads(self.rfile.read(length).decode("utf-8"))
            status, payload = respond(seen["body"])
            self.send_response(status)
            self.send_header("Content-Type", "text/event-stream")
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
        result = complete(
            [{"role": "user", "content": "你好"}],
            [{"name": "page", "description": "页面", "parameters": {"type": "object"}}],
            sink,
        )
    finally:
        server.shutdown()
    return result, seen
