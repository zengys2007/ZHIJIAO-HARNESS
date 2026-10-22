"""选择存储实现。现在只返回本机 SQLite。"""

from app.config import Settings
from app.storage.repository import SqliteRepository


def open_repository(settings: Settings) -> SqliteRepository:
    password = settings.auth_admin_password or None
    return SqliteRepository(settings.data_dir / "app.sqlite", admin_password=password)
