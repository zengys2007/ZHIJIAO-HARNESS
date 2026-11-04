import io
import json
import os
import struct
import urllib.error
from pathlib import Path

from app.config import Settings
from app.knowledge.embed import cosine, embed_texts, pack_vector, unpack_vector

_MODEL = "embed-unit"
_API_KEY = "test-embed-key"


def _settings() -> Settings:
    return Settings(
        data_dir=Path("."),
        llm_base_url="http://llm.example/v1/",
        llm_api_key=_API_KEY,
        llm_timeout_seconds=11,
        llm_embedding_model="from-settings",
    )


class _Response:
    def __init__(self, payload: dict):
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _Opener:
    def __init__(self, payload: dict | None = None, error: BaseException | None = None):
        self.payload = payload
        self.error = error
        self.calls: list[dict] = []

    def __call__(self, request, timeout):
        body = json.loads(request.data.decode("utf-8"))
        self.calls.append(
            {
                "url": request.full_url,
                "body": body,
                "timeout": timeout,
                "method": request.get_method(),
                "authorization": request.get_header("Authorization"),
                "content_type": request.get_header("Content-type"),
            }
        )
        if self.error is not None:
            raise self.error
        assert self.payload is not None
        return _Response(self.payload)


def _expect_request(call: dict) -> None:
    assert call["url"] == "http://llm.example/v1/embeddings"
    assert call["url"].endswith("/embeddings")
    assert call["method"] == "POST"
    assert call["timeout"] == 11
    assert call["authorization"] == "Bearer " + _API_KEY
    assert call["content_type"] == "application/json"
    assert set(call["body"]) == {"model", "input"}
    assert call["body"]["model"] == _MODEL
    assert call["body"]["model"] == os.environ["LLM_EMBEDDING_MODEL"]
    assert len(call["body"]["input"]) <= 16


def test_two_texts_share_one_batch_and_keep_response_order(monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", _MODEL)
    opener = _Opener(
        {
            "data": [
                {"index": 0, "embedding": [0.25, 0.5]},
                {"index": 1, "embedding": [-1.0, 2.0]},
            ]
        }
    )

    result = embed_texts(_settings(), ["第一段", "第二段"], opener)

    assert result == [[0.25, 0.5], [-1.0, 2.0]]
    assert len(opener.calls) == 1
    _expect_request(opener.calls[0])
    assert opener.calls[0]["body"]["input"] == ["第一段", "第二段"]


def test_batches_hold_at_most_sixteen_texts(monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", _MODEL)
    texts = [str(index) for index in range(17)]
    calls: list[dict] = []

    def opener(request, timeout):
        body = json.loads(request.data.decode("utf-8"))
        calls.append(
            {
                "url": request.full_url,
                "body": body,
                "timeout": timeout,
                "method": request.get_method(),
                "authorization": request.get_header("Authorization"),
                "content_type": request.get_header("Content-type"),
            }
        )
        data = [{"embedding": [float(text), 0.0]} for text in body["input"]]
        return _Response({"data": data})

    result = embed_texts(_settings(), texts, opener)

    assert [len(call["body"]["input"]) for call in calls] == [16, 1]
    for call in calls:
        _expect_request(call)
    assert result == [[float(index), 0.0] for index in range(17)]


def test_empty_model_name_returns_none_without_request(monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "   ")
    opener = _Opener({"data": [{"embedding": [1.0, 0.0]}]})

    assert embed_texts(_settings(), ["第一段"], opener) is None
    assert opener.calls == []


def test_http_error_returns_none_and_calls_opener_once(monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", _MODEL)
    error = urllib.error.HTTPError(
        "http://llm.example/v1/embeddings",
        502,
        "bad gateway",
        None,
        io.BytesIO(b""),
    )
    opener = _Opener(error=error)

    assert embed_texts(_settings(), ["第一段", "第二段"], opener) is None
    assert len(opener.calls) == 1


def test_timeout_returns_none_and_calls_opener_once(monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", _MODEL)
    opener = _Opener(error=TimeoutError("timed out"))

    assert embed_texts(_settings(), ["第一段", "第二段"], opener) is None
    assert len(opener.calls) == 1


def test_missing_embedding_returns_none_and_calls_opener_once(monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", _MODEL)
    opener = _Opener({"data": [{"embedding": [1.0, 0.0]}, {"index": 1}]})

    assert embed_texts(_settings(), ["第一段", "第二段"], opener) is None
    assert len(opener.calls) == 1


def test_length_mismatch_returns_none_and_calls_opener_once(monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", _MODEL)
    opener = _Opener({"data": [{"embedding": [1.0, 0.0]}]})

    assert embed_texts(_settings(), ["第一段", "第二段"], opener) is None
    assert len(opener.calls) == 1


def test_cosine_of_identical_axes_is_one():
    assert cosine([1, 0], [1, 0]) == 1


def test_cosine_of_zero_vector_is_minus_one():
    assert cosine([0, 0], [1, 0]) == -1
    assert cosine([1, 0], [0, 0]) == -1


def test_pack_vector_round_trips_within_1e_6():
    values = [0.1, -2.5, 3.14159265]
    blob = pack_vector(values)

    assert blob == struct.pack("<{}f".format(len(values)), *values)
    restored = unpack_vector(blob)
    assert all(abs(left - right) < 1e-6 for left, right in zip(values, restored, strict=True))
