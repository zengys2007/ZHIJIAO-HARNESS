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


def parse_goal(body: object) -> str:
    if not isinstance(body, dict) or set(body) != {"goal"}:
        raise RequestError("invalid goal")
    goal = body["goal"]
    if not isinstance(goal, str):
        raise RequestError("invalid goal")
    return goal.strip()


def parse_plan_mode(body: object) -> bool:
    if not isinstance(body, dict) or set(body) != {"plan_mode"}:
        raise RequestError("invalid plan")
    value = body["plan_mode"]
    if not isinstance(value, bool):
        raise RequestError("invalid plan")
    return value


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
