"""签发和校验登录 Cookie。密钥只由调用方传入。"""

import hmac
import hashlib
import re
from datetime import datetime, timedelta, timezone

from app.storage.protocol import User

COOKIE_NAME = "zhijiao_session"
COOKIE_MAX_AGE = 7 * 24 * 60 * 60
_SESSION_ID = re.compile(r"^[0-9a-f]{32}$")


def session_expiry(now: datetime | None = None) -> tuple[str, int]:
    moment = now or datetime.now(timezone.utc)
    expires = (moment + timedelta(days=7)).replace(microsecond=0)
    return expires.strftime("%Y-%m-%dT%H:%M:%SZ"), int(expires.timestamp())


def sign_cookie(session_id: str, expires_unix: int, secret: str) -> str:
    payload = f"{session_id}.{expires_unix}"
    signature = hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def parse_cookie(value: str, secret: str) -> tuple[str, int] | None:
    session_id, separator, rest = value.partition(".")
    expires_text, separator2, signature = rest.partition(".")
    if not separator or not separator2 or separator2 != ".":
        return None
    if _SESSION_ID.fullmatch(session_id) is None or not expires_text.isdigit():
        return None
    if len(signature) != 64:
        return None
    payload = f"{session_id}.{expires_text}"
    expected = hmac.new(secret.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return None
    return session_id, int(expires_text)


def resolve_user(repo, cookie_value: str | None, secret: str) -> User | None:
    if not cookie_value:
        return None
    parsed = parse_cookie(cookie_value, secret)
    if parsed is None:
        return None
    session_id, expires_unix = parsed
    session = repo.get_session(session_id)
    if session is None or _iso_to_unix(session.expires_at) != expires_unix:
        return None
    if expires_unix <= int(datetime.now(timezone.utc).timestamp()):
        repo.delete_session(session_id)
        return None
    return repo.get_user(session.user_id)


def _iso_to_unix(value: str) -> int:
    moment = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return int(moment.timestamp())
