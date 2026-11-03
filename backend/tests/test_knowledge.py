"""知识点库：环检测、编辑、删除、批量导入。"""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.llm.protocol import AssistantMessage
from app.main import create_app
from app.storage.protocol import (
    AssignmentInput,
    ConflictError,
    KnowledgePoint,
    NotFoundError,
)
from app.storage.repository import SqliteRepository
from app.teaching.cycles import find_cycle


def _point(name: str, prerequisites: list[str]) -> KnowledgePoint:
    return KnowledgePoint(id=name, owner_id="u1", name=name, description="", prerequisites=prerequisites)


def test_find_cycle_returns_none_without_edges():
    points = [_point("约分", []), _point("通分", ["约分"])]

    assert find_cycle(points) is None


def test_find_cycle_detects_two_node_cycle():
    points = [_point("约分", ["通分"]), _point("通分", ["约分"])]

    cycle = find_cycle(points)

    assert cycle is not None
    assert cycle[0] == cycle[-1]
    assert set(cycle) == {"约分", "通分"}


def test_find_cycle_detects_self_loop():
    points = [_point("约分", ["约分"])]

    assert find_cycle(points) is not None
    assert find_cycle(points)[0] == "约分"


def test_find_cycle_detects_deep_chain_cycle():
    # 分数加减 -> 约分 -> 通分 -> 分数加减
    points = [
        _point("分数加减", ["通分"]),
        _point("约分", ["分数加减"]),
        _point("通分", ["约分"]),
    ]

    cycle = find_cycle(points)

    assert cycle is not None
    assert cycle[0] == cycle[-1]


def test_find_cycle_ignores_prerequisites_not_in_set():
    # 先修引用了库外的名（尚未自动补建的场景），视为无环
    points = [_point("约分", ["不存在的点"])]

    assert find_cycle(points) is None


def _repo(tmp_path) -> tuple[SqliteRepository, str, str]:
    # load_teaching 在属主没有班级时提前返回空数据，所以这里先建一个班
    repo = SqliteRepository(tmp_path / "teach.db")
    user_id = "u1"
    class_id = repo.create_class(user_id, "三年二班", ["小明"])
    repo.create_knowledge_point(user_id, "约分", "化简分数", [])
    repo.create_knowledge_point(user_id, "通分", "", ["约分"])
    return repo, user_id, class_id


def test_update_point_renames_references(tmp_path):
    repo, user_id, class_id = _repo(tmp_path)
    repo.create_assignment(
        user_id,
        AssignmentInput(
            class_id=class_id,
            title="测验",
            kind="quiz",
            records=[("小明", [("约分", 60.0)])],
        ),
    )
    points_before = repo.load_teaching(user_id).knowledge_points
    target = next(item for item in points_before if item.name == "约分")

    repo.update_knowledge_point(user_id, target.id, "约分与化简", "化简分数", ["通分"])

    data = repo.load_teaching(user_id)
    names = {item.name for item in data.knowledge_points}
    assert "约分与化简" in names and "约分" not in names
    # scores 只存 knowledge_point_id，知识点名由 load_teaching 的 join 派生，改名后自动同步
    assert data.scores[0].knowledge_point_name == "约分与化简"
    # 通分的先修引用同步更新
    tongfen = next(item for item in data.knowledge_points if item.name == "通分")
    assert tongfen.prerequisites == ["约分与化简"]


def test_update_point_rejects_unknown_and_duplicate(tmp_path):
    repo, user_id, _class_id = _repo(tmp_path)

    with pytest.raises(NotFoundError):
        repo.update_knowledge_point(user_id, "0" * 32, "新名", "", [])
    with pytest.raises(ConflictError):
        points = repo.load_teaching(user_id).knowledge_points
        yuefen = next(item for item in points if item.name == "约分")
        repo.update_knowledge_point(user_id, yuefen.id, "通分", "", [])


def test_update_point_isolated_between_owners(tmp_path):
    repo, user_id, _class_id = _repo(tmp_path)
    points = repo.load_teaching(user_id).knowledge_points
    yuefen = next(item for item in points if item.name == "约分")

    with pytest.raises(NotFoundError):
        repo.update_knowledge_point("别人", yuefen.id, "新名", "", [])


def test_delete_point_removes_prerequisite_references(tmp_path):
    repo, user_id, _class_id = _repo(tmp_path)
    points = repo.load_teaching(user_id).knowledge_points
    yuefen = next(item for item in points if item.name == "约分")

    repo.delete_knowledge_point(user_id, yuefen.id)

    data = repo.load_teaching(user_id)
    tongfen = next(item for item in data.knowledge_points)
    assert tongfen.prerequisites == []


def test_delete_point_with_scores_conflicts(tmp_path):
    repo, user_id, class_id = _repo(tmp_path)
    repo.create_assignment(
        user_id,
        AssignmentInput(
            class_id=class_id,
            title="测验",
            kind="quiz",
            records=[("小明", [("约分", 60.0)])],
        ),
    )
    points = repo.load_teaching(user_id).knowledge_points
    yuefen = next(item for item in points if item.name == "约分")

    with pytest.raises(ConflictError):
        repo.delete_knowledge_point(user_id, yuefen.id)


def test_delete_point_rejects_unknown(tmp_path):
    repo, user_id, _class_id = _repo(tmp_path)

    with pytest.raises(NotFoundError):
        repo.delete_knowledge_point(user_id, "0" * 32)


def test_batch_import_creates_and_skips_duplicates(tmp_path):
    repo, user_id, _class_id = _repo(tmp_path)  # 已有 约分、通分

    created, skipped, ensured = repo.batch_create_knowledge_points(
        user_id,
        [
            (1, "分数乘除", "乘除混合", ["约分"]),
            (2, "约分", "重复", []),
            (3, "分数比较", "", ["分数乘除", "不存在的先修"]),
        ],
    )

    assert created == 2
    assert skipped == [{"line": 2, "name": "约分", "reason": "重名"}]
    assert ensured == ["不存在的先修"]
    names = {item.name: item for item in repo.load_teaching(user_id).knowledge_points}
    assert names["分数比较"].prerequisites == ["分数乘除", "不存在的先修"]
    assert names["不存在的先修"].description == ""


def test_batch_import_rolls_back_on_cycle(tmp_path):
    repo, user_id, _class_id = _repo(tmp_path)

    with pytest.raises(ValueError) as exc_info:
        repo.batch_create_knowledge_points(
            user_id,
            [
                (1, "甲", "", ["乙"]),
                (2, "乙", "", ["甲"]),
            ],
        )

    assert "甲" in str(exc_info.value)
    names = {item.name for item in repo.load_teaching(user_id).knowledge_points}
    assert "甲" not in names and "乙" not in names


# ===== API：编辑 / 删除 / 批量导入 =====


def _client_pair(tmp_path):
    # create_app 要求 auth_secret 至少 16 个字符
    app = create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=_stub_complete)
    alice = TestClient(app)
    alice.post("/api/auth/register", json={"username": "alice", "password": "correct-horse", "display_name": "甲"})
    # load_teaching 在属主没有班级时提前返回空数据，先建一个班让 overview 看得到知识点
    created = alice.post("/api/teaching/classes", json={"name": "一年一班", "students": ["小明"]})
    assert created.status_code == 201
    return alice


def _stub_complete(messages, tools):
    return AssistantMessage(content="好", tool_calls=[])


def _create_point(client, name="约分", prerequisites=None) -> str:
    response = client.post(
        "/api/teaching/points",
        json={"name": name, "description": "", "prerequisites": prerequisites or []},
    )
    assert response.status_code == 201
    return response.json()["point_id"]


def test_api_update_point_rejects_cycle(tmp_path):
    alice = _client_pair(tmp_path)
    _create_point(alice, "约分", [])
    tongfen = _create_point(alice, "通分", ["约分"])

    # 把约分的先修改成通分 -> 约分->通分->约分 成环
    points = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    yuefen_id = points["约分"]["point_id"]

    response = alice.put(
        f"/api/teaching/points/{yuefen_id}",
        json={"name": "约分", "description": "", "prerequisites": ["通分"]},
    )

    assert response.status_code == 400
    assert "约分" in response.json()["error"]["message"]
    # 原数据未被破坏
    points_after = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    assert points_after["约分"]["prerequisites"] == []
    assert points_after["通分"]["prerequisites"] == ["约分"]
    # 未用到的 tongfen 变量消除告警
    assert tongfen


def test_api_update_point_rename_rejects_cycle(tmp_path):
    alice = _client_pair(tmp_path)
    _create_point(alice, "甲", [])
    _create_point(alice, "乙", ["甲"])
    points = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    jia_id = points["甲"]["point_id"]

    # 甲改名丙且先修乙：存储层会把乙先修里的甲同步替换为丙，形成 丙→乙→丙，
    # 假想点集必须做同样的替换才能测出环（否则旧名引用悬空、find_cycle 丢边漏环）
    rejected = alice.put(
        f"/api/teaching/points/{jia_id}",
        json={"name": "丙", "description": "", "prerequisites": ["乙"]},
    )

    assert rejected.status_code == 400
    message = rejected.json()["error"]["message"]
    assert "丙" in message and "乙" in message
    # 被拒后原数据未被破坏
    points_after = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    assert points_after["甲"]["prerequisites"] == []
    assert points_after["乙"]["prerequisites"] == ["甲"]

    # 正向场景不误伤：合法改名（先修为空）应成功，乙的先修由存储层同步为丙
    ok = alice.put(
        f"/api/teaching/points/{jia_id}",
        json={"name": "丙", "description": "", "prerequisites": []},
    )

    assert ok.status_code == 200
    final = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    assert "丙" in final and "甲" not in final
    assert final["乙"]["prerequisites"] == ["丙"]


def test_api_update_point_ok_and_not_found(tmp_path):
    alice = _client_pair(tmp_path)
    point_id = _create_point(alice, "约分", [])

    ok = alice.put(
        f"/api/teaching/points/{point_id}",
        json={"name": "约分与化简", "description": "新说明", "prerequisites": []},
    )
    assert ok.status_code == 200
    # 回读 overview 验证改名与新说明已持久化
    points = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    assert points["约分与化简"]["point_id"] == point_id
    assert points["约分与化简"]["description"] == "新说明"
    missing = alice.put(
        "/api/teaching/points/" + "0" * 32,
        json={"name": "新名", "description": "", "prerequisites": []},
    )
    assert missing.status_code == 404


def test_api_delete_point(tmp_path):
    alice = _client_pair(tmp_path)
    point_id = _create_point(alice, "约分", [])
    _create_point(alice, "通分", ["约分"])

    ok = alice.delete(f"/api/teaching/points/{point_id}")
    assert ok.status_code == 204
    points = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    assert "约分" not in points
    assert points["通分"]["prerequisites"] == []

    missing = alice.delete(f"/api/teaching/points/{point_id}")
    assert missing.status_code == 404


def test_api_delete_point_with_scores_conflicts(tmp_path):
    alice = _client_pair(tmp_path)
    class_response = alice.post(
        "/api/teaching/classes", json={"name": "三年二班", "students": ["小明"]}
    )
    class_id = class_response.json()["class_id"]
    alice.post(
        "/api/teaching/assignments",
        json={
            "class_id": class_id,
            "title": "测验",
            "kind": "quiz",
            "records": [{"student": "小明", "scores": {"约分": 60}}],
        },
    )
    points = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}

    response = alice.delete(f"/api/teaching/points/{points['约分']['point_id']}")

    assert response.status_code == 409
    assert response.json()["error"]["message"] == "该知识点已有成绩记录，不能删除。"


def test_api_batch_import(tmp_path):
    alice = _client_pair(tmp_path)

    response = alice.post(
        "/api/teaching/points/batch",
        json={"text": "分数加减 | 同分母加减 | \n约分 | 化简分数 | 分数加减\n\n通分｜｜约分,约分"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["created"] == 3
    assert body["skipped"] == []
    assert body["ensured_prereqs"] == []
    points = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    assert points["通分"]["prerequisites"] == ["约分"]


def test_api_batch_import_skips_existing(tmp_path):
    alice = _client_pair(tmp_path)
    _create_point(alice, "约分", [])

    response = alice.post(
        "/api/teaching/points/batch",
        json={"text": "约分 | 重复 | \n通分 | | 约分"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["created"] == 1
    assert body["skipped"] == [{"line": 1, "name": "约分", "reason": "重名"}]
    assert body["ensured_prereqs"] == []


def test_api_batch_import_rejects_oversize(tmp_path):
    alice = _client_pair(tmp_path)

    response = alice.post(
        "/api/teaching/points/batch",
        json={"text": "甲 | | \n" * 20000},
    )

    assert response.status_code == 400


def test_api_batch_import_rolls_back_cycle(tmp_path):
    alice = _client_pair(tmp_path)

    response = alice.post(
        "/api/teaching/points/batch",
        json={"text": "甲 | | 乙\n乙 | | 甲"},
    )

    assert response.status_code == 400
    overview = alice.get("/api/teaching/overview").json()
    assert overview["knowledge_points"] == []
