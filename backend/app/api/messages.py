"""对话请求的字段校验。不引用 Web 框架。"""


class RequestError(ValueError):
    code = "invalid_input"


def parse_create_conversation(body: object) -> None:
    if body in (None, {}):
        return
    raise RequestError("invalid conversation body")


def parse_message(body: object) -> str:
    if not isinstance(body, dict) or set(body) != {"content"}:
        raise RequestError("invalid message")
    content = body["content"]
    if not isinstance(content, str):
        raise RequestError("invalid message")
    text = content.strip()
    if text == "" or len(text) > 4000:
        raise RequestError("invalid message")
    return text
