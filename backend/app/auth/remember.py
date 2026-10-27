"""记住此设备的长效令牌：登录时签发，切换账号时免密换取新会话。

令牌本体只出现在响应里一次；数据库里只存 SHA-256 摘要。
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

REMEMBER_DAYS = 30
REMEMBER_MESSAGE = "令牌写成 1 到 128 个字。"


def issue_remember_token() -> tuple[str, str]:
    """生成新令牌，返回 (raw, digest)。raw 发给前端，digest 入库。"""
    raw = secrets.token_urlsafe(32)
    return raw, hash_remember_token(raw)


def hash_remember_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def remember_expiry(now: datetime | None = None) -> str:
    moment = now or datetime.now(timezone.utc)
    expires = (moment + timedelta(days=REMEMBER_DAYS)).replace(microsecond=0)
    return expires.strftime("%Y-%m-%dT%H:%M:%SZ")


def remember_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
