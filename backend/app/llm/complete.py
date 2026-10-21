"""Chat Completions 兼容适配。业务代码不引用供应商 SDK。"""

import json
import urllib.error
import urllib.request

from app.llm.protocol import AssistantMessage, ModelError, ToolCall


def make_complete(settings):
    def complete(messages, tools):
        body = {
            "model": settings.llm_model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 2000,
            "stream": False,
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
        for _attempt in range(2):
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
                    raw = response.read()
                return _assistant_from_body(raw)
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
    return AssistantMessage(content=content, tool_calls=calls)
