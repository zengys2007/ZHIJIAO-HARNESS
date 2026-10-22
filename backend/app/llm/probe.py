"""试连模型。不改进程里正在使用的配置，也不把密钥写进返回值。"""

import json
import urllib.error
import urllib.request


def probe_chat(base_url: str, api_key: str, model: str, timeout: int, opener=None) -> bool:
    open_url = opener or urllib.request.urlopen
    url = base_url.rstrip("/") + "/chat/completions"
    payload = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": "ping"}],
            "temperature": 0,
            "max_tokens": 1,
            "stream": False,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with open_url(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
        choices = data.get("choices")
        return isinstance(choices, list) and len(choices) > 0
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, UnicodeError, TypeError):
        return False
