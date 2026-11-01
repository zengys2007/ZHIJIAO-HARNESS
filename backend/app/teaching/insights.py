"""学情洞察：按班级聚合近期作业与测验，算出知识点得分率与薄弱点。

纯计算，不访问数据库，不依赖 Web 框架。输入是 TeachingData，输出是
可直接序列化为 JSON 的结构（供 API 返回和模型摘要共同使用）。
"""

from app.storage.protocol import TeachingData

RECENT_LIMIT = 5
WEAK_THRESHOLD = 0.7
MIN_WEAK_POINTS = 3
DOC_TYPES = {"lesson_plan", "rubric"}
ASSIGNMENT_KINDS = {"homework", "quiz"}


def teaching_insights(data: TeachingData) -> dict:
    """全部班级的洞察总览。"""
    return {
        "classes": [_class_insights(data, item.id, item.name) for item in data.classes],
    }


def _class_insights(data: TeachingData, class_id: str, class_name: str) -> dict:
    assignments = [item for item in data.assignments if item.class_id == class_id]
    recent = assignments[-RECENT_LIMIT:]
    students = [item.name for item in data.students if item.class_id == class_id]
    by_assignment: dict[str, dict[str, list[float]]] = {}
    for cell in data.scores:
        if cell.assignment_id not in {item.id for item in recent}:
            continue
        by_assignment.setdefault(cell.assignment_id, {}).setdefault(cell.knowledge_point_name, []).append(cell.score)
    recent_ids = {item.id for item in recent}
    latest = recent[-1] if recent else None
    previous = recent[-2] if len(recent) >= 2 else None
    point_names = sorted({cell.knowledge_point_name for cell in data.scores if cell.assignment_id in recent_ids})
    points = []
    for name in point_names:
        latest_scores = by_assignment.get(latest.id, {}).get(name, []) if latest else []
        previous_scores = by_assignment.get(previous.id, {}).get(name, []) if previous else []
        recent_scores = _flatten_recent(by_assignment, recent, name)
        points.append(
            {
                "name": name,
                "latest_rate": _rate(latest_scores),
                "previous_rate": _rate(previous_scores),
                "recent_rate": _rate(recent_scores),
                "covered": len(latest_scores),
            }
        )
    weak = _weak_points(points)
    student_rows = _student_rows(data, recent_ids, students, point_names)
    return {
        "class_id": class_id,
        "class_name": class_name,
        "student_count": len(students),
        "recent_assignments": [
            {"id": item.id, "title": item.title, "kind": item.kind, "created_at": item.created_at}
            for item in recent
        ],
        "latest": _assignment_brief(latest),
        "knowledge_points": points,
        "weak_points": weak,
        "students": student_rows,
    }


def _assignment_brief(assignment) -> dict | None:
    if assignment is None:
        return None
    return {"id": assignment.id, "title": assignment.title, "kind": assignment.kind, "created_at": assignment.created_at}


def _flatten_recent(by_assignment: dict, recent: list, point_name: str) -> list[float]:
    collected: list[float] = []
    for item in recent:
        collected.extend(by_assignment.get(item.id, {}).get(point_name, []))
    return collected


def _weak_points(points: list[dict]) -> list[dict]:
    assessed = [item for item in points if item["latest_rate"] is not None]
    ranked = sorted(assessed, key=lambda item: (item["latest_rate"], item["name"]))
    weak = [item for item in ranked if item["latest_rate"] < WEAK_THRESHOLD]
    for item in ranked:
        if len(weak) >= MIN_WEAK_POINTS:
            break
        if item not in weak:
            weak.append(item)
    weak.sort(key=lambda item: (item["latest_rate"], item["name"]))
    return [{"name": item["name"], "rate": item["latest_rate"]} for item in weak]


def _student_rows(data: TeachingData, recent_ids: set[str], students: list[str], point_names: list[str]) -> list[dict]:
    collected: dict[str, dict[str, list[float]]] = {}
    for cell in data.scores:
        if cell.assignment_id not in recent_ids:
            continue
        collected.setdefault(cell.student_name, {}).setdefault(cell.knowledge_point_name, []).append(cell.score)
    rows = []
    for name in students:
        by_point = collected.get(name, {})
        rates = {point: _rate(by_point.get(point, [])) for point in point_names if by_point.get(point)}
        overall = _rate([score for scores in by_point.values() for score in scores])
        weak = sorted(point for point, rate in rates.items() if rate < WEAK_THRESHOLD)
        rows.append({"name": name, "overall_rate": overall, "by_point": rates, "weak": weak})
    return rows


def _rate(scores: list[float]) -> float | None:
    if not scores:
        return None
    return round(sum(scores) / len(scores) / 100, 3)
