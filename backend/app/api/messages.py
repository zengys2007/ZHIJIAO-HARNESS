"""对话请求的字段校验。不引用 Web 框架。"""


class RequestError(ValueError):
    code = "invalid_input"

    def __init__(self, detail: str = "invalid", public_message: str | None = None):
        super().__init__(detail)
        self.public_message = public_message


def parse_create_conversation(body: object) -> None:
    if body in (None, {}):
        return
    raise RequestError("invalid conversation body")


def parse_pin(body: object) -> bool:
    if not isinstance(body, dict) or set(body) != {"pinned"}:
        raise RequestError("invalid pin")
    pinned = body["pinned"]
    if not isinstance(pinned, bool):
        raise RequestError("invalid pin")
    return pinned


def parse_ask(body: object) -> bool:
    if not isinstance(body, dict) or set(body) != {"ask_mode"}:
        raise RequestError("invalid ask")
    enabled = body["ask_mode"]
    if not isinstance(enabled, bool):
        raise RequestError("invalid ask")
    return enabled


def parse_plan(body: object) -> dict:
    if not isinstance(body, dict):
        raise RequestError("invalid plan")
    keys = set(body)
    if keys == {"plan_mode"}:
        value = body["plan_mode"]
        if not isinstance(value, bool):
            raise RequestError("invalid plan")
        return {"kind": "mode", "enabled": value}
    if keys == {"plan_body"}:
        value = body["plan_body"]
        if not isinstance(value, str):
            raise RequestError("invalid plan")
        return {"kind": "body", "body": value.strip()}
    if keys == {"action"} and body["action"] == "generate":
        return {"kind": "generate"}
    raise RequestError("invalid plan")


def parse_message(body: object) -> tuple[str, str | None]:
    if not isinstance(body, dict):
        raise RequestError("invalid message")
    keys = set(body)
    if "content" not in keys or not keys <= {"content", "llm_source"}:
        raise RequestError("invalid message")
    content = body["content"]
    if not isinstance(content, str):
        raise RequestError("invalid message")
    text = content.strip()
    if text == "":
        raise RequestError("invalid message")
    if "llm_source" not in body:
        return text, None
    source = body["llm_source"]
    if source not in ("local", "dotenv"):
        raise RequestError("invalid message")
    return text, source
