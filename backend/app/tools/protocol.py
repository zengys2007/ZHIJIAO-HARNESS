"""工具定义。模型只能看见 name、description 和参数 schema。"""

from dataclasses import dataclass
from typing import Callable

from app.storage.files import FileStore


@dataclass
class Turn:
    task_id: str
    candidate: dict | None
    store: FileStore


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    execute: Callable[[dict, Turn], str]
    stop_after: str | None = None
