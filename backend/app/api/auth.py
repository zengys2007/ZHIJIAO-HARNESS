"""注册和登录正文的字段校验。不引用 Web 框架。"""

from app.api.messages import RequestError

USERNAME_MESSAGE = "用户名写成 1 到 32 个字，中间不要有空格。"
PASSWORD_MESSAGE = "密码写成 8 到 128 个字。"
DISPLAY_NAME_MESSAGE = "显示名写成 1 到 32 个字。"
UNKNOWN_FIELD_MESSAGE = "请求里有不能识别的字段。"
CREDENTIALS_MESSAGE = "用户名或密码不正确。"
RESERVED_USERNAME = "local-admin"


def parse_register(body: object) -> tuple[str, str, str]:
    record = _object(body, {"username", "password", "display_name"})
    username = _username(record.get("username", None))
    password = _password(record.get("password", None))
    if "display_name" in record:
        display_name = _display_name(record["display_name"])
    else:
        display_name = username
    return username, password, display_name


def parse_login(body: object) -> tuple[str, str]:
    record = _object(body, {"username", "password"})
    if "username" not in record or not isinstance(record["username"], str):
        raise RequestError("username", public_message=USERNAME_MESSAGE)
    if "password" not in record or not isinstance(record["password"], str):
        raise RequestError("password", public_message=PASSWORD_MESSAGE)
    return record["username"].strip(), record["password"]


def _object(body: object, allowed: set[str]) -> dict:
    if not isinstance(body, dict):
        raise RequestError("body", public_message=UNKNOWN_FIELD_MESSAGE)
    if not set(body) <= allowed:
        raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
    return body


def _username(value: object) -> str:
    if not isinstance(value, str):
        raise RequestError("username", public_message=USERNAME_MESSAGE)
    text = value.strip()
    if text == "" or len(text) > 32 or any(character.isspace() for character in text):
        raise RequestError("username", public_message=USERNAME_MESSAGE)
    return text


def _password(value: object) -> str:
    if not isinstance(value, str) or not 8 <= len(value) <= 128:
        raise RequestError("password", public_message=PASSWORD_MESSAGE)
    return value


def _display_name(value: object) -> str:
    if not isinstance(value, str):
        raise RequestError("display_name", public_message=DISPLAY_NAME_MESSAGE)
    text = value.strip()
    if text == "" or len(text) > 32:
        raise RequestError("display_name", public_message=DISPLAY_NAME_MESSAGE)
    return text
