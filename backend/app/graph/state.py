"""一轮的图状态。消息只追加，候选和停机原因整段替换。"""

import operator
from typing import Annotated, TypedDict

from app.storage.files import FileStore


class GraphState(TypedDict):
    messages: Annotated[list, operator.add]
    prior: list
    current_user: str
    candidate: dict | None
    step_count: int
    stop: str
    task_id: str
    store: FileStore
