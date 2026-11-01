"""教学上下文：录入、隔离、学情洞察、模型摘要注入。"""

from fastapi.testclient import TestClient

from app.config import Settings
from app.graph.build import build_graph
from app.llm.protocol import AssistantMessage
from app.main import create_app
from app.storage.files import FileStore
from app.storage.protocol import (
    Assignment,
    KnowledgePoint,
    ScoreCell,
    StudentRecord,
    TeachingClass,
    TeachingData,
    TeachingDocument,
)
from app.storage.repository import SqliteRepository
from app.tasks.runner import run_turn
from app.tasks.states import SUCCEEDED
from app.teaching.digest import build_digest
from app.teaching.insights import teaching_insights
from app.tools.registry import production_registry

SECRET = "test-secret-value"
PASSWORD = "correct-horse"


# ===== 学情洞察计算 =====


def test_insights_reports_weak_points_and_student_rows():
    data = _teaching_data()

    result = teaching_insights(data)
    row = result["classes"][0]

    assert row["class_name"] == "三年二班"
    assert row["student_count"] == 2
    assert row["latest"]["title"] == "第二单元测验"
    weak = [item["name"] for item in row["weak_points"]]
    # 薄弱：约分 0.6、通分 0.625；不足 3 个，补上得分率最低的分数乘除 0.65
    assert weak == ["约分", "通分", "分数乘除"]
    points = {item["name"]: item for item in row["knowledge_points"]}
    assert points["分数加减"]["latest_rate"] == 0.9
    assert points["约分"]["previous_rate"] == 0.85
    students = {item["name"]: item for item in row["students"]}
    assert students["小明"]["overall_rate"] == 0.7
    # 学生薄弱点按近 5 次作业聚合：约分两次均值 0.7 不算薄弱
    assert students["小明"]["weak"] == ["分数乘除", "通分"]


def test_insights_without_assignments_has_no_weak_points():
    data = TeachingData(
        classes=[TeachingClass(id="c1", owner_id="u1", name="三年二班", created_at="2026-11-01T08:00:00Z")],
        students=[StudentRecord(id="s1", class_id="c1", name="小明")],
        knowledge_points=[],
        assignments=[],
        scores=[],
        documents=[],
    )

    row = teaching_insights(data)["classes"][0]

    assert row["latest"] is None
    assert row["weak_points"] == []
    assert row["knowledge_points"] == []
    assert row["students"][0]["overall_rate"] is None


# ===== 模型摘要 =====


def test_digest_contains_teaching_context_and_bounded_length():
    data = _teaching_data()

    text = build_digest(data)

    assert "三年二班" in text
    assert "小明、小红" in text
    assert "先修：分数加减" in text
    assert "第二单元测验" in text
    assert "约分" in text
    assert "先通分再比较" in text
    assert len(text) <= 6000


def test_digest_drops_document_excerpts_when_over_limit():
    documents = [
        TeachingDocument(
            id=f"d{i}",
            owner_id="u1",
            doc_type="lesson_plan",
            title=f"教案{i}",
            content="字" * 500,
            created_at="2026-11-01T08:00:00Z",
        )
        for i in range(20)
    ]
    data = TeachingData(
        classes=_teaching_data().classes,
        students=_teaching_data().students,
        knowledge_points=[],
        assignments=[],
        scores=[],
        documents=documents,
    )

    text = build_digest(data)

    assert len(text) <= 6000
    assert "教案19" not in text
    assert "三年二班" in text


def test_digest_is_empty_without_teaching_data():
    assert build_digest(TeachingData([], [], [], [], [], [])) == ""


# ===== 一轮对话注入 =====


def test_turn_injects_teaching_digest_for_conversation_owner(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    store = FileStore(tmp_path)
    user = repo.create_user("teacher", "王老师", "hash")
    repo.create_class(user.id, "三年二班", ["小明", "小红"])
    conversation_id = repo.create_conversation(user.id)
    task = repo.submit_message(conversation_id, "帮我分析这次单元测验", user.id)
    seen = {}

    def complete(messages, tools):
        seen["messages"] = messages
        return AssistantMessage(content="分析如下。", tool_calls=[])

    graph = build_graph(production_registry(), complete, system="你是教师的备课助手。")
    run_turn(repo, store, graph, task.id)

    system_messages = [message for message in seen["messages"] if message["role"] == "system"]
    assert len(system_messages) == 2
    assert "三年二班" in system_messages[1]["content"]
    assert repo.get_task(task.id).status == SUCCEEDED


def test_turn_without_teaching_data_keeps_single_system_message(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    store = FileStore(tmp_path)
    user = repo.create_user("teacher", "王老师", "hash")
    conversation_id = repo.create_conversation(user.id)
    task = repo.submit_message(conversation_id, "你好", user.id)
    seen = {}

    def complete(messages, tools):
        seen["messages"] = messages
        return AssistantMessage(content="你好。", tool_calls=[])

    graph = build_graph(production_registry(), complete, system="你是教师的备课助手。")
    run_turn(repo, store, graph, task.id)

    system_messages = [message for message in seen["messages"] if message["role"] == "system"]
    assert len(system_messages) == 1
    assert repo.get_task(task.id).status == SUCCEEDED


# ===== API：录入与隔离 =====


def test_teaching_api_creates_records_and_reads_overview(tmp_path):
    alice, _bob = _two_teachers(tmp_path)

    created = alice.post(
        "/api/teaching/classes",
        json={"name": "三年二班", "students": ["小明", "小红"]},
    )
    assert created.status_code == 201
    class_id = created.json()["class_id"]

    point = alice.post(
        "/api/teaching/points",
        json={"name": "约分", "description": "化简分数", "prerequisites": ["分数加减"]},
    )
    assert point.status_code == 201

    assignment = alice.post(
        "/api/teaching/assignments",
        json={
            "class_id": class_id,
            "title": "第二单元测验",
            "kind": "quiz",
            "records": [
                {"student": "小明", "scores": {"约分": 60, "通分": 62.5}},
                {"student": "小红", "scores": {"约分": 60, "通分": 63}},
            ],
        },
    )
    assert assignment.status_code == 201

    document = alice.post(
        "/api/teaching/documents",
        json={"doc_type": "lesson_plan", "title": "分数单元教案", "content": "先通分再比较。"},
    )
    assert document.status_code == 201

    overview = alice.get("/api/teaching/overview").json()
    assert overview["classes"][0]["name"] == "三年二班"
    assert overview["classes"][0]["students"] == ["小明", "小红"]
    points = {item["name"]: item for item in overview["knowledge_points"]}
    assert points["约分"]["prerequisites"] == ["分数加减"]
    assert overview["assignments"][0]["title"] == "第二单元测验"
    assert overview["documents"][0]["title"] == "分数单元教案"

    insights = alice.get("/api/teaching/insights").json()
    assert insights["classes"][0]["weak_points"][0]["name"] == "约分"


def test_teaching_data_is_isolated_between_teachers(tmp_path):
    alice, bob = _two_teachers(tmp_path)

    created = alice.post("/api/teaching/classes", json={"name": "三年二班", "students": ["小明"]})
    class_id = created.json()["class_id"]
    alice.post(
        "/api/teaching/assignments",
        json={
            "class_id": class_id,
            "title": "测验",
            "kind": "quiz",
            "records": [{"student": "小明", "scores": {"约分": 50}}],
        },
    )

    bob_overview = bob.get("/api/teaching/overview").json()
    assert bob_overview == {"classes": [], "knowledge_points": [], "assignments": [], "documents": []}
    bob_insights = bob.get("/api/teaching/insights").json()
    assert bob_insights == {"classes": []}
    # B 不能把作业录进 A 的班级
    intruder = bob.post(
        "/api/teaching/assignments",
        json={
            "class_id": class_id,
            "title": "测验",
            "kind": "quiz",
            "records": [{"student": "小明", "scores": {"约分": 50}}],
        },
    )
    assert intruder.status_code == 404


def test_teaching_api_rejects_bad_input(tmp_path):
    alice, _bob = _two_teachers(tmp_path)

    unauthenticated = TestClient(create_app(Settings(data_dir=tmp_path / "anon", auth_secret=SECRET), complete=_ok))
    assert unauthenticated.get("/api/teaching/overview").status_code == 401

    bad_score = alice.post(
        "/api/teaching/classes", json={"name": "三年二班", "students": ["小明"]}
    )
    assert bad_score.status_code == 201
    class_id = bad_score.json()["class_id"]
    invalid = alice.post(
        "/api/teaching/assignments",
        json={
            "class_id": class_id,
            "title": "测验",
            "kind": "quiz",
            "records": [{"student": "小明", "scores": {"约分": 150}}],
        },
    )
    assert invalid.status_code == 400
    unknown_kind = alice.post(
        "/api/teaching/assignments",
        json={
            "class_id": class_id,
            "title": "测验",
            "kind": "exam",
            "records": [{"student": "小明", "scores": {"约分": 50}}],
        },
    )
    assert unknown_kind.status_code == 400
    missing_class = alice.post(
        "/api/teaching/assignments",
        json={
            "class_id": "0" * 32,
            "title": "测验",
            "kind": "quiz",
            "records": [{"student": "小明", "scores": {"约分": 50}}],
        },
    )
    assert missing_class.status_code == 404
    duplicate_class = alice.post(
        "/api/teaching/classes", json={"name": "三年二班", "students": ["小明"]}
    )
    assert duplicate_class.status_code == 409
    bad_doc = alice.post(
        "/api/teaching/documents", json={"doc_type": "ppt", "title": "课件", "content": "内容"}
    )
    assert bad_doc.status_code == 400


# ===== 工具函数 =====


def _teaching_data() -> TeachingData:
    class_id = "c1"
    owner = "u1"
    a1 = "a1"
    a2 = "a2"
    return TeachingData(
        classes=[TeachingClass(id=class_id, owner_id=owner, name="三年二班", created_at="2026-10-01T08:00:00Z")],
        students=[
            StudentRecord(id="s1", class_id=class_id, name="小明"),
            StudentRecord(id="s2", class_id=class_id, name="小红"),
        ],
        knowledge_points=[
            KnowledgePoint(id="p1", owner_id=owner, name="分数加减", description="同分母加减", prerequisites=[]),
            KnowledgePoint(
                id="p2", owner_id=owner, name="分数乘除", description="乘除运算", prerequisites=["分数加减"]
            ),
            KnowledgePoint(id="p3", owner_id=owner, name="约分", description="化简分数", prerequisites=["分数加减"]),
            KnowledgePoint(id="p4", owner_id=owner, name="通分", description="", prerequisites=["约分"]),
        ],
        assignments=[
            Assignment(id=a1, owner_id=owner, class_id=class_id, title="第一单元测验", kind="quiz", created_at="2026-10-05T08:00:00Z"),
            Assignment(id=a2, owner_id=owner, class_id=class_id, title="第二单元测验", kind="quiz", created_at="2026-10-20T08:00:00Z"),
        ],
        scores=[
            # 第一次：约分 0.85
            ScoreCell(assignment_id=a1, student_name="小明", knowledge_point_id="p3", knowledge_point_name="约分", score=85),
            ScoreCell(assignment_id=a1, student_name="小红", knowledge_point_id="p3", knowledge_point_name="约分", score=85),
            # 第二次：分数加减 0.9，分数乘除 0.65，约分 0.6，通分 0.625
            ScoreCell(assignment_id=a2, student_name="小明", knowledge_point_id="p1", knowledge_point_name="分数加减", score=90),
            ScoreCell(assignment_id=a2, student_name="小红", knowledge_point_id="p1", knowledge_point_name="分数加减", score=90),
            ScoreCell(assignment_id=a2, student_name="小明", knowledge_point_id="p2", knowledge_point_name="分数乘除", score=60),
            ScoreCell(assignment_id=a2, student_name="小红", knowledge_point_id="p2", knowledge_point_name="分数乘除", score=70),
            ScoreCell(assignment_id=a2, student_name="小明", knowledge_point_id="p3", knowledge_point_name="约分", score=55),
            ScoreCell(assignment_id=a2, student_name="小红", knowledge_point_id="p3", knowledge_point_name="约分", score=65),
            ScoreCell(assignment_id=a2, student_name="小明", knowledge_point_id="p4", knowledge_point_name="通分", score=60),
            ScoreCell(assignment_id=a2, student_name="小红", knowledge_point_id="p4", knowledge_point_name="通分", score=65),
        ],
        documents=[
            TeachingDocument(
                id="d1",
                owner_id=owner,
                doc_type="lesson_plan",
                title="分数单元教案",
                content="先通分再比较。",
                created_at="2026-10-01T08:00:00Z",
            )
        ],
    )


def _two_teachers(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, auth_secret=SECRET), complete=_ok)
    alice = TestClient(app)
    bob = TestClient(app)
    alice.post("/api/auth/register", json={"username": "alice", "password": PASSWORD, "display_name": "甲老师"})
    bob.post("/api/auth/register", json={"username": "bob", "password": PASSWORD, "display_name": "乙老师"})
    return alice, bob


def _ok(messages, tools):
    return AssistantMessage(content="好", tool_calls=[])
