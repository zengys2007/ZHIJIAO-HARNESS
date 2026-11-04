"""调用 embeddings 接口，并把向量打成小端 float32。"""

import json
import math
import struct
import urllib.error
import urllib.request

from app.config import embedding_model_name

_BATCH_SIZE = 16


def pack_vector(values: list[float]) -> bytes:
    return struct.pack("<{}f".format(len(values)), *values)


def unpack_vector(blob: bytes) -> list[float]:
    count = len(blob) // 4
    return list(struct.unpack("<{}f".format(count), blob))


def cosine(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return -1.0
    dot = 0.0
    left_sq = 0.0
    right_sq = 0.0
    for a, b in zip(left, right):
        dot += a * b
        left_sq += a * a
        right_sq += b * b
    if left_sq == 0.0 or right_sq == 0.0:
        return -1.0
    return dot / math.sqrt(left_sq * right_sq)


def embed_texts(settings, texts: list[str], opener=None) -> list[list[float]] | None:
    model = embedding_model_name()
    if model == "":
        return None
    open_url = opener or urllib.request.urlopen
    vectors: list[list[float]] = []
    for start in range(0, len(texts), _BATCH_SIZE):
        embedded = _embed_batch(settings, model, texts[start : start + _BATCH_SIZE], open_url)
        if embedded is None:
            return None
        vectors.extend(embedded)
    return vectors


def _embed_batch(settings, model: str, batch: list[str], open_url) -> list[list[float]] | None:
    url = settings.llm_base_url.rstrip("/") + "/embeddings"
    body = {"model": model, "input": batch}
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + settings.llm_api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with open_url(request, timeout=settings.llm_timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, UnicodeError, TypeError, ValueError):
        return None
    return _vectors(payload, len(batch))


def _vectors(payload: object, expected: int) -> list[list[float]] | None:
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if not isinstance(data, list) or len(data) != expected:
        return None
    vectors: list[list[float]] = []
    for item in data:
        parsed = _as_floats(item.get("embedding") if isinstance(item, dict) else None)
        if parsed is None:
            return None
        vectors.append(parsed)
    return vectors


def _as_floats(embedding: object) -> list[float] | None:
    if not isinstance(embedding, list):
        return None
    values: list[float] = []
    for value in embedding:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        values.append(float(value))
    return values
