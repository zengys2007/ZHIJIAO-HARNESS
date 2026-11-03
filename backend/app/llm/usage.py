"""供应商窗口、发送前计数，以及本地 tiktoken 退路。"""

import json
import urllib.error
import urllib.request

WINDOW_FIELDS = ("max_model_len", "context_length", "context_window")
OUTPUT_FIELDS = ("max_completion_tokens", "max_output_tokens", "output_token_limit")
DEFAULT_LIMIT = 1_000_000
DEFAULT_OUTPUT_LIMIT = 128_000


def parse_context_limit(payload: object, model: str) -> int | None:
    chosen = _matching_model(payload, model)
    if chosen is None:
        return None
    return _positive_field(chosen, WINDOW_FIELDS)


def parse_output_limit(payload: object, model: str) -> int | None:
    chosen = _matching_model(payload, model)
    if chosen is None:
        return None
    return _positive_field(chosen, OUTPUT_FIELDS)


def parse_input_tokens(payload: object) -> int | None:
    if not isinstance(payload, dict):
        return None
    value = payload.get("input_tokens")
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None


def parse_usage(payload: object) -> tuple[int | None, int | None]:
    if not isinstance(payload, dict):
        return None, None
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return None, None
    return _nonnegative(usage.get("prompt_tokens"), usage.get("input_tokens")), _nonnegative(
        usage.get("completion_tokens"), usage.get("output_tokens")
    )


def fetch_model_payload(settings, opener=None):
    url = settings.llm_base_url.rstrip("/") + "/models"
    return _request_json(url, settings.llm_api_key, None, settings.llm_timeout_seconds, opener)


def fetch_context_limit(settings, opener=None) -> int | None:
    data = fetch_model_payload(settings, opener)
    if data is None:
        return None
    return parse_context_limit(data, settings.llm_model)


def fetch_output_limit(settings, opener=None) -> int | None:
    data = fetch_model_payload(settings, opener)
    if data is None:
        return None
    return parse_output_limit(data, settings.llm_model)


def fetch_input_tokens(settings, messages: list[dict], opener=None) -> int | None:
    url = settings.llm_base_url.rstrip("/") + "/responses/input_tokens"
    body = {"model": settings.llm_model, "input": messages}
    data = _request_json(url, settings.llm_api_key, body, settings.llm_timeout_seconds, opener)
    if data is None:
        return None
    return parse_input_tokens(data)


def count_messages_locally(messages: list[dict]) -> int:
    encoding = _encoding()
    total = 3
    for message in messages:
        total += 4
        content = message.get("content") or ""
        if isinstance(content, str) and content:
            total += len(encoding.encode(content))
        tool_calls = message.get("tool_calls")
        if tool_calls:
            total += len(encoding.encode(json.dumps(tool_calls, ensure_ascii=False)))
    return total


def _positive_field(record: dict, keys: tuple[str, ...]) -> int | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return value
    return None


def _matching_model(payload: object, model: str) -> dict | None:
    models: list[dict] = []
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            models = [item for item in data if isinstance(item, dict)]
        elif isinstance(payload.get("id"), str):
            models = [payload]
    elif isinstance(payload, list):
        models = [item for item in payload if isinstance(item, dict)]
    for item in models:
        if item.get("id") == model:
            return item
    return None


def _nonnegative(*values) -> int | None:
    for value in values:
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
    return None


def _request_json(url: str, api_key: str, body: dict | None, timeout: int, opener):
    open_url = opener or urllib.request.urlopen
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
        method="GET" if body is None else "POST",
    )
    try:
        with open_url(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, UnicodeError, TypeError, ValueError):
        return None


def _encoding():
    import tiktoken

    return tiktoken.get_encoding("o200k_base")
