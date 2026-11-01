"""把教师的教学上下文变成一段有界的文字，作为附加 system 消息交给模型。

无教学数据时返回空字符串，模型输入与改造前完全一致。
"""

from app.storage.protocol import TeachingData
from app.teaching.insights import teaching_insights

DIGEST_LIMIT = 6000
DOC_EXCERPT_CHARS = 500
STUDENT_LIST_LIMIT = 30

KIND_LABELS = {"homework": "作业", "quiz": "测验"}
DOC_LABELS = {"lesson_plan": "教案", "rubric": "评分标准"}


def build_digest(data: TeachingData) -> str:
    if not data.classes:
        return ""
    header = (
        "以下是这位教师的教学上下文（班级名单、知识点图谱、近期作业与测验、薄弱点分布、教案与评分标准）。"
        "教师提问涉及班级、学生表现、测验分析、备课、出题、评语或课件时，直接使用这些数据回答，"
        "不要要求教师上传或重述这些数据；引用时写明班级与知识点名称。数据中没有的内容再向教师询问。\n"
    )
    sections = [
        _classes_section(data),
        _points_section(data),
        _assignments_section(data),
        _weak_section(data),
        _documents_section(data),
    ]
    body = "\n".join(section for section in sections if section)
    if not body:
        return ""
    text = header + body
    if len(text) > DIGEST_LIMIT:
        # 超限时先丢教案/评分标准摘录，再丢学生名单明细，仍超则硬截断。
        kept = [section for section in sections[:4] if section]
        text = header + "\n".join(kept)
    if len(text) > DIGEST_LIMIT:
        kept = [sections[1], sections[2], sections[3]]
        text = header + "\n".join(section for section in kept if section)
    if len(text) > DIGEST_LIMIT:
        text = text[:DIGEST_LIMIT]
    return text


def _classes_section(data: TeachingData) -> str:
    lines = ["班级（含班级名单）："]
    for class_item in data.classes:
        students = [item.name for item in data.students if item.class_id == class_item.id]
        names = "、".join(students[:STUDENT_LIST_LIMIT])
        suffix = "等" if len(students) > STUDENT_LIST_LIMIT else ""
        lines.append(f"- {class_item.name}（{len(students)}人）：{names}{suffix}")
    return "\n".join(lines)


def _points_section(data: TeachingData) -> str:
    if not data.knowledge_points:
        return ""
    lines = ["知识点图谱（先修关系在括号里）："]
    for point in data.knowledge_points:
        brief = f"- {point.name}"
        if point.description:
            brief += f"：{point.description}"
        if point.prerequisites:
            brief += f"（先修：{'、'.join(point.prerequisites)}）"
        lines.append(brief)
    return "\n".join(lines)


def _assignments_section(data: TeachingData) -> str:
    if not data.assignments:
        return ""
    lines = ["近期作业与测验记录："]
    for class_item in data.classes:
        items = [item for item in data.assignments if item.class_id == class_item.id][-5:]
        if not items:
            continue
        brief = "、".join(
            f"{KIND_LABELS.get(item.kind, item.kind)}「{item.title}」（{item.created_at[:10]}）" for item in items
        )
        lines.append(f"- {class_item.name}：{brief}")
    return "\n".join(lines)


def _weak_section(data: TeachingData) -> str:
    insights = teaching_insights(data)
    lines = ["薄弱点分布（按班级，最近一次作业/测验）："]
    for row in insights["classes"]:
        latest = row.get("latest")
        if latest is None or not row["weak_points"]:
            continue
        weak_brief = "、".join(f"{item['name']}（得分率{item['rate']:.0%}）" for item in row["weak_points"])
        lines.append(
            f"- {row['class_name']}：{KIND_LABELS.get(latest['kind'], latest['kind'])}「{latest['title']}」中薄弱：{weak_brief}"
        )
    if len(lines) == 1:
        return ""
    return "\n".join(lines)


def _documents_section(data: TeachingData) -> str:
    if not data.documents:
        return ""
    lines = ["教师已有的教案与评分标准（摘录）："]
    for document in data.documents:
        label = DOC_LABELS.get(document.doc_type, document.doc_type)
        excerpt = document.content[:DOC_EXCERPT_CHARS]
        lines.append(f"- {label}「{document.title}」：{excerpt}")
    return "\n".join(lines)
