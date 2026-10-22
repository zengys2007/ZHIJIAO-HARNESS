"""密码只保存 scrypt 参数和哈希。"""

import base64
import hashlib
import hmac
import os

_N = 16384
_R = 8
_P = 1
_LENGTH = 32
_DUMMY_SALT = b"\0" * 16


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = _scrypt(password, salt)
    return f"scrypt${_N}${_R}${_P}${_encode(salt)}${_encode(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, n_text, r_text, p_text, salt_text, hash_text = stored.split("$")
        if algorithm != "scrypt" or int(n_text) != _N or int(r_text) != _R or int(p_text) != _P:
            burn_password_check(password)
            return False
        salt = _decode(salt_text)
        expected = _decode(hash_text)
    except (ValueError, TypeError):
        burn_password_check(password)
        return False
    digest = _scrypt(password, salt)
    if len(digest) != len(expected):
        return False
    return hmac.compare_digest(digest, expected)


def burn_password_check(password: str) -> None:
    _scrypt(password, _DUMMY_SALT)


def _scrypt(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=_LENGTH)


def _encode(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii").rstrip("=")


def _decode(text: str) -> bytes:
    padding = "=" * ((4 - len(text) % 4) % 4)
    return base64.b64decode(text + padding, validate=True)
