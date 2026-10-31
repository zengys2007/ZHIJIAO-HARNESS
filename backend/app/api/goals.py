"""目标树的请求解析与响应组装。不引入 Web 框架。"""

from app.goals.templates import SUBJECT_NAMES
from app.storage.protocol import GoalNode, GoalTree

GOAL_GRADES = (7, 8, 9)
GOAL_TERMS = ("上", "下")
MAX_TITLE_CHARS = 100
MAX_TEXT_CHARS = 2000
MAX_REFS = 20


class GoalRequestError(ValueError):
    """请求体不合法。public_message 直接进错误正文。"""

    def __init__(self, public_message: str):
        super().__init__(public_message)
        self.public_message = public_message


def _text(body: dict, key: str, *, required: bool = True, limit: int = MAX_TEXT_CHARS) -> str:
    value = body.get(key)
    if value is None:
        if required:
            raise GoalRequestError(f"请填写{key}。")
        return ""
    if not isinstance(value, str):
        raise GoalRequestError(f"{key} 需要是文本。")
    stripped = value.strip()
    if required and stripped == "":
        raise GoalRequestError(f"请填写{key}。")
    if len(stripped) > limit:
        raise GoalRequestError(f"{key} 超过 {limit} 字。")
    return stripped


def parse_create_tree(body) -> tuple[str, int, str, str, bool]:
    if not isinstance(body, dict):
        raise GoalRequestError("请求体需要是对象。")
    subject = body.get("subject")
    if subject not in SUBJECT_NAMES:
        raise GoalRequestError("请选择初中九科之一。")
    grade = body.get("grade")
    if grade not in GOAL_GRADES:
        raise GoalRequestError("年级需是 7、8 或 9。")
    term = body.get("term")
    if term not in GOAL_TERMS:
        raise GoalRequestError("学期需是「上」或「下」。")
    title = _text(body, "title", limit=MAX_TITLE_CHARS)
    template_init = body.get("template_init") is True
    return subject, grade, term, title, template_init


def parse_update_tree(body) -> str:
    if not isinstance(body, dict):
        raise GoalRequestError("请求体需要是对象。")
    return _text(body, "title", limit=MAX_TITLE_CHARS)


def parse_create_node(body) -> dict:
    if not isinstance(body, dict):
        raise GoalRequestError("请求体需要是对象。")
    parent_id = body.get("parent_id")
    if parent_id is not None and (not isinstance(parent_id, str) or parent_id == ""):
        raise GoalRequestError("parent_id 需要是合法 id 或 null。")
    level = body.get("level")
    if level not in ("semester", "unit", "lesson"):
        raise GoalRequestError("目标层级需是 semester、unit 或 lesson。")
    return {
        "parent_id": parent_id,
        "level": level,
        "title": _text(body, "title", limit=MAX_TITLE_CHARS),
        "description": _text(body, "description", required=False),
        "verify_criteria": _text(body, "verify_criteria", required=False),
        "standard_refs": _refs(body),
    }


def parse_update_node(body) -> dict:
    if not isinstance(body, dict):
        raise GoalRequestError("请求体需要是对象。")
    return {
        "title": _text(body, "title", limit=MAX_TITLE_CHARS),
        "description": _text(body, "description", required=False),
        "verify_criteria": _text(body, "verify_criteria", required=False),
        "standard_refs": _refs(body),
    }


def parse_reorder(body) -> str:
    if not isinstance(body, dict):
        raise GoalRequestError("请求体需要是对象。")
    direction = body.get("direction")
    if direction not in ("up", "down"):
        raise GoalRequestError("direction 需是 up 或 down。")
    return direction


def parse_grade_filter(raw: str | None) -> int | None:
    """列表接口的 grade 查询参数：None 不过滤，其余必须能安全转成整数。"""
    if raw is None:
        return None
    try:
        return int(raw.strip())
    except ValueError:
        raise GoalRequestError("年级必须是整数。")


def _refs(body: dict) -> list[str]:
    value = body.get("standard_refs")
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_REFS:
        raise GoalRequestError(f"standard_refs 最多 {MAX_REFS} 项。")
    refs: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip() or len(item) > 100:
            raise GoalRequestError("standard_refs 里每一项需是 100 字以内的文本。")
        refs.append(item.strip())
    return refs


def tree_view(tree: GoalTree) -> dict:
    return {
        "tree_id": tree.id,
        "subject": tree.subject,
        "grade": tree.grade,
        "term": tree.term,
        "title": tree.title,
        "created_at": tree.created_at,
        "updated_at": tree.updated_at,
    }


def node_view(node: GoalNode) -> dict:
    return {
        "node_id": node.id,
        "tree_id": node.tree_id,
        "parent_id": node.parent_id,
        "level": node.level,
        "title": node.title,
        "description": node.description,
        "standard_refs": node.standard_refs,
        "verify_criteria": node.verify_criteria,
        "sort_order": node.sort_order,
        "created_at": node.created_at,
        "updated_at": node.updated_at,
    }
