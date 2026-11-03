"""Chat Completions 兼容适配。业务代码不引用供应商 SDK。"""

import json
import urllib.error
import urllib.request

from app.llm.protocol import AssistantMessage, ModelError, ToolCall
from app.llm.usage import DEFAULT_OUTPUT_LIMIT, parse_usage


def make_complete(settings, max_tokens: int = DEFAULT_OUTPUT_LIMIT):
    def complete(messages, tools, sink=None):
        body = {
            "model": settings.llm_model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "stream": sink is not None,
        }
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool["description"],
                        "parameters": tool["parameters"],
                    },
                }
                for tool in tools
            ]
        url = settings.llm_base_url.rstrip("/") + "/chat/completions"
        payload = json.dumps(body).encode("utf-8")
        timeout_error = None
        invalid_error = None
        for attempt in range(2):
            if attempt == 1 and sink is not None:
                sink.reset()
            request = urllib.request.Request(
                url,
                data=payload,
                headers={
                    "Authorization": "Bearer " + settings.llm_api_key,
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=settings.llm_timeout_seconds) as response:
                    if sink is None:
                        return _assistant_from_body(response.read())
                    return _assistant_from_stream(response, sink)
            except urllib.error.HTTPError:
                return ModelError(code="model_upstream", message="upstream")
            except (TimeoutError, urllib.error.URLError):
                timeout_error = ModelError(code="model_timeout", message="timeout")
            except (json.JSONDecodeError, KeyError, TypeError, ValueError, UnicodeError):
                invalid_error = ModelError(code="model_invalid_output", message="invalid")
        return timeout_error or invalid_error or ModelError(code="model_invalid_output", message="invalid")

    return complete


def _assistant_from_body(raw: bytes) -> AssistantMessage:
    data = json.loads(raw.decode("utf-8"))
    message = data["choices"][0]["message"]
    content = message.get("content") or ""
    if not isinstance(content, str):
        raise TypeError("content")
    calls = []
    for item in message.get("tool_calls") or []:
        function = item.get("function") or {}
        arguments = function.get("arguments", {})
        if isinstance(arguments, str):
            arguments = json.loads(arguments) if arguments else {}
        if not isinstance(arguments, dict):
            raise TypeError("arguments")
        name = function.get("name")
        if not isinstance(name, str) or name == "":
            raise ValueError("name")
        calls.append(ToolCall(id=str(item.get("id") or ""), name=name, arguments=arguments))
    prompt_tokens, completion_tokens = parse_usage(data)
    return AssistantMessage(
        content=content,
        tool_calls=calls,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )


def _assistant_from_stream(response, sink) -> AssistantMessage:
    content_parts: list[str] = []
    tool_slots: dict[int, dict] = {}
    usage_payload = None
    finished = False
    while True:
        raw = response.readline()
        if raw == b"":
            break
        line = raw.decode("utf-8").strip()
        if line == "" or line.startswith(":"):
            continue
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            finished = True
            break
        payload = json.loads(data)
        if isinstance(payload, dict) and payload.get("usage"):
            usage_payload = payload
        choices = payload.get("choices") if isinstance(payload, dict) else None
        if not choices:
            continue
        delta = choices[0].get("delta") or {}
        piece = delta.get("content")
        if piece is None or piece == "":
            pass
        elif not isinstance(piece, str):
            raise TypeError("content")
        else:
            content_parts.append(piece)
            sink.delta(piece)
        for item in delta.get("tool_calls") or []:
            index = item.get("index", 0)
            if not isinstance(index, int):
                raise TypeError("index")
            slot = tool_slots.setdefault(index, {"id": "", "name": "", "arguments": ""})
            if item.get("id"):
                slot["id"] = str(item["id"])
            function = item.get("function") or {}
            name = function.get("name")
            if isinstance(name, str) and name != "":
                slot["name"] += name
            arguments = function.get("arguments")
            if isinstance(arguments, str) and arguments != "":
                slot["arguments"] += arguments
    if not finished:
        raise ValueError("incomplete stream")
    calls = []
    for index in sorted(tool_slots):
        slot = tool_slots[index]
        if slot["name"] == "":
            raise ValueError("name")
        raw_arguments = slot["arguments"]
        arguments = json.loads(raw_arguments) if raw_arguments else {}
        if not isinstance(arguments, dict):
            raise TypeError("arguments")
        calls.append(ToolCall(id=slot["id"], name=slot["name"], arguments=arguments))
    prompt_tokens, completion_tokens = parse_usage(usage_payload)
    return AssistantMessage(
        content="".join(content_parts),
        tool_calls=calls,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )
