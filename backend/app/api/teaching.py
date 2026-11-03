"""教学上下文请求的字段校验。不引用 Web 框架。"""

import re

from app.api.messages import RequestError
from app.storage.protocol import AssignmentInput

_HEX_ID = re.compile(r"^[0-9a-f]{32}$")

NAME_MESSAGE = "名称写成 1 到 32 个字，中间不要有空格。"
CLASS_NAME_MESSAGE = "班级名写成 1 到 32 个字。"
TITLE_MESSAGE = "标题写成 1 到 64 个字。"
SCORE_MESSAGE = "得分写成 0 到 100 的数字。"
STUDENT_MESSAGE = "学生名单写成名字的列表，每个名字 1 到 32 个字。"
POINT_MESSAGE = "知识点写成 1 到 64 个字。"
DOC_TYPE_MESSAGE = "类型只支持 lesson_plan 或 rubric。"
CONTENT_MESSAGE = "正文写成 1 到 20000 个字。"
RECORD_MESSAGE = "成绩记录写成 [{student, scores}] 的列表。"
UNKNOWN_FIELD_MESSAGE = "请求里有不能识别的字段。"
CLASS_ID_MESSAGE = "班级不存在。"
KIND_MESSAGE = "类型只支持 homework 或 quiz。"

MAX_STUDENTS = 200
MAX_RECORDS = 200
MAX_POINTS = 200
MAX_PREREQUISITES = 10
MAX_CONTENT_CHARS = 20000
MAX_SCORE = 100
MAX_BATCH_CHARS = 100_000
BATCH_LINE_MESSAGE = "每行写成「名称 | 说明 | 先修1,先修2」，说明和先修可以留空。"


def parse_create_class(body: object) -> tuple[str, list[str]]:
    if not isinstance(body, dict) or not set(body) <= {"name", "students"}:
        raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
    name = _class_name(body.get("name"))
    raw_students = body.get("students", [])
    if not isinstance(raw_students, list) or len(raw_students) > MAX_STUDENTS:
        raise RequestError("students", public_message=STUDENT_MESSAGE)
    students: list[str] = []
    seen: set[str] = set()
    for item in raw_students:
        student = _person_name(item)
        if student in seen:
            raise RequestError("students", public_message=STUDENT_MESSAGE)
        seen.add(student)
        students.append(student)
    return name, students


def parse_create_point(body: object) -> tuple[str, str, list[str]]:
    if not isinstance(body, dict) or not set(body) <= {"name", "description", "prerequisites"}:
        raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
    name = _point_name(body.get("name"))
    description = body.get("description", "")
    if not isinstance(description, str) or len(description) > 500:
        raise RequestError("description", public_message="说明写成不超过 500 个字。")
    raw_prerequisites = body.get("prerequisites", [])
    if not isinstance(raw_prerequisites, list) or len(raw_prerequisites) > MAX_PREREQUISITES:
        raise RequestError("prerequisites", public_message="先修知识点写成不超过 10 个名字的列表。")
    prerequisites = [_point_name(item) for item in raw_prerequisites]
    return name, description.strip(), prerequisites


def parse_update_point(body: object) -> tuple[str, str, list[str]]:
    """与 parse_create_point 相同的结构校验。"""
    return parse_create_point(body)


def parse_batch_points(body: object) -> list[tuple[int, str, str, list[str]]]:
    """解析批量导入文本。每行「名称 | 说明 | 先修1,先修2」，行内分隔符 | 或 ｜，先修分隔 , ， 、。"""
    if not isinstance(body, dict) or not set(body) <= {"text"}:
        raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        raise RequestError("text", public_message=BATCH_LINE_MESSAGE)
    if len(text) > MAX_BATCH_CHARS:
        raise RequestError("text", public_message="批量导入文本不超过 10 万字符。")
    entries: list[tuple[int, str, str, list[str]]] = []
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        parts = [part.strip() for part in re.split(r"[|｜]", line)]
        if len(parts) > 3:
            raise RequestError("text", public_message=BATCH_LINE_MESSAGE)
        name = _point_name(parts[0])
        description = ""
        prerequisites: list[str] = []
        if len(parts) >= 2 and parts[1]:
            description = parts[1]
            if len(description) > 500:
                raise RequestError("description", public_message="说明写成不超过 500 个字。")
        if len(parts) == 3 and parts[2]:
            seen: set[str] = set()
            for item in re.split(r"[,，、]", parts[2]):
                if not item.strip():
                    continue
                point_name = _point_name(item.strip())
                if point_name not in seen:
                    seen.add(point_name)
                    prerequisites.append(point_name)
        entries.append((line_number, name, description, prerequisites))
    if not entries:
        raise RequestError("text", public_message="没有可导入的行。")
    return entries


def parse_create_assignment(body: object) -> AssignmentInput:
    if not isinstance(body, dict) or not set(body) <= {"class_id", "title", "kind", "records"}:
        raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
    class_id = body.get("class_id")
    if not isinstance(class_id, str) or _HEX_ID.fullmatch(class_id) is None:
        raise RequestError("class_id", public_message=CLASS_ID_MESSAGE)
    title = body.get("title")
    if not isinstance(title, str):
        raise RequestError("title", public_message=TITLE_MESSAGE)
    title = title.strip()
    if title == "" or len(title) > 64:
        raise RequestError("title", public_message=TITLE_MESSAGE)
    kind = body.get("kind")
    if kind not in {"homework", "quiz"}:
        raise RequestError("kind", public_message=KIND_MESSAGE)
    raw_records = body.get("records")
    if not isinstance(raw_records, list) or len(raw_records) > MAX_RECORDS:
        raise RequestError("records", public_message=RECORD_MESSAGE)
    records: list[tuple[str, list[tuple[str, float]]]] = []
    seen_students: set[str] = set()
    for item in raw_records:
        if not isinstance(item, dict) or not set(item) <= {"student", "scores"}:
            raise RequestError("records", public_message=RECORD_MESSAGE)
        student = _person_name(item.get("student"))
        if student in seen_students:
            raise RequestError("records", public_message=RECORD_MESSAGE)
        seen_students.add(student)
        raw_scores = item.get("scores")
        if not isinstance(raw_scores, dict) or not raw_scores:
            raise RequestError("records", public_message=RECORD_MESSAGE)
        cells: list[tuple[str, float]] = []
        for knowledge_name, score in raw_scores.items():
            _point_name(knowledge_name)
            if isinstance(score, bool) or not isinstance(score, (int, float)):
                raise RequestError("scores", public_message=SCORE_MESSAGE)
            value = float(score)
            if not 0 <= value <= MAX_SCORE:
                raise RequestError("scores", public_message=SCORE_MESSAGE)
            cells.append((knowledge_name, value))
        records.append((student, cells))
    return AssignmentInput(class_id=class_id, title=title, kind=kind, records=records)


def parse_create_document(body: object) -> tuple[str, str, str]:
    if not isinstance(body, dict) or not set(body) <= {"doc_type", "title", "content"}:
        raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
    doc_type = body.get("doc_type")
    if doc_type not in {"lesson_plan", "rubric"}:
        raise RequestError("doc_type", public_message=DOC_TYPE_MESSAGE)
    title = body.get("title")
    if not isinstance(title, str):
        raise RequestError("title", public_message=TITLE_MESSAGE)
    title = title.strip()
    if title == "" or len(title) > 64:
        raise RequestError("title", public_message=TITLE_MESSAGE)
    content = body.get("content")
    if not isinstance(content, str):
        raise RequestError("content", public_message=CONTENT_MESSAGE)
    content = content.strip()
    if content == "" or len(content) > MAX_CONTENT_CHARS:
        raise RequestError("content", public_message=CONTENT_MESSAGE)
    return doc_type, title, content


def _class_name(value: object) -> str:
    if not isinstance(value, str):
        raise RequestError("name", public_message=CLASS_NAME_MESSAGE)
    text = value.strip()
    if text == "" or len(text) > 32:
        raise RequestError("name", public_message=CLASS_NAME_MESSAGE)
    return text


def _person_name(value: object) -> str:
    if not isinstance(value, str):
        raise RequestError("student", public_message=STUDENT_MESSAGE)
    text = value.strip()
    if text == "" or len(text) > 32 or any(character.isspace() for character in text):
        raise RequestError("student", public_message=STUDENT_MESSAGE)
    return text


def _point_name(value: object) -> str:
    if not isinstance(value, str):
        raise RequestError("point", public_message=POINT_MESSAGE)
    text = value.strip()
    if text == "" or len(text) > 64:
        raise RequestError("point", public_message=POINT_MESSAGE)
    return text
