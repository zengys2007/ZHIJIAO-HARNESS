"""知识点库：环检测、编辑、删除、批量导入。"""

import pytest

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
