"""goal_trees / goal_nodes 仓储行为。"""

import pytest

from app.storage.protocol import ConflictError, InputError, NotFoundError
from app.storage.repository import SqliteRepository


@pytest.fixture()
def repo(tmp_path):
    return SqliteRepository(tmp_path / "app.sqlite")


def _tree(repo, **overrides):
    params = {"subject": "数学", "grade": 7, "term": "上", "title": "七上数学"}
    params.update(overrides)
    return repo.create_goal_tree("owner-1", **params)


def test_create_and_list_goal_trees_filters_by_dimensions(repo):
    _tree(repo)
    _tree(repo, subject="语文", title="七上语文")
    _tree(repo, grade=8, title="八上数学")

    all_trees = repo.list_goal_trees("owner-1")
    assert len(all_trees) == 3  # 同学期多份并存，无唯一约束

    math = repo.list_goal_trees("owner-1", subject="数学", grade=7, term="上")
    assert [t.title for t in math] == ["七上数学"]
    assert repo.list_goal_trees("owner-1", subject="英语") == []


def test_goal_trees_are_isolated_by_owner(repo):
    tree = _tree(repo)
    assert repo.get_goal_tree_for_owner(tree.id, "owner-2") is None
    assert repo.list_goal_trees("owner-2") == []
    assert repo.delete_goal_tree(tree.id, "owner-2") is False
    assert repo.rename_goal_tree(tree.id, "owner-2", "x") is None
    assert repo.list_goal_nodes(tree.id, "owner-2") is None


def test_goal_node_hierarchy_rules(repo):
    tree = _tree(repo)
    root = repo.create_goal_node(
        tree.id, "owner-1", None, "semester", "总目标一", "描述", [], "标准"
    )
    unit = repo.create_goal_node(
        tree.id, "owner-1", None, "unit", "第一单元", "描述", [], "标准"
    )
    lesson = repo.create_goal_node(
        tree.id, "owner-1", unit.id, "lesson", "第 1 课时", "描述", [], "标准"
    )
    nodes = repo.list_goal_nodes(tree.id, "owner-1")
    assert {n.id for n in nodes} == {root.id, unit.id, lesson.id}
    assert lesson.parent_id == unit.id

    # lesson 不能挂根；semester/unit 不能挂别的节点
    with pytest.raises(InputError):
        repo.create_goal_node(tree.id, "owner-1", None, "lesson", "x", "x", [], "x")
    with pytest.raises(InputError):
        repo.create_goal_node(tree.id, "owner-1", root.id, "unit", "x", "x", [], "x")
    # lesson 只能挂 unit
    with pytest.raises(InputError):
        repo.create_goal_node(tree.id, "owner-1", root.id, "lesson", "x", "x", [], "x")
    with pytest.raises(NotFoundError):
        repo.create_goal_node(tree.id, "owner-1", "missing", "lesson", "x", "x", [], "x")


def test_goal_node_limits(repo):
    tree = _tree(repo)
    for i in range(20):
        repo.create_goal_node(tree.id, "owner-1", None, "semester", f"总{i}", "", [], "")
    with pytest.raises(ConflictError):
        repo.create_goal_node(tree.id, "owner-1", None, "semester", "超", "", [], "")

    unit = repo.create_goal_node(tree.id, "owner-1", None, "unit", "单元", "", [], "")
    for i in range(40):
        repo.create_goal_node(tree.id, "owner-1", unit.id, "lesson", f"课{i}", "", [], "")
    with pytest.raises(ConflictError):
        repo.create_goal_node(tree.id, "owner-1", unit.id, "lesson", "超", "", [], "")


def test_update_delete_and_reorder_goal_nodes(repo):
    tree = _tree(repo)
    unit = repo.create_goal_node(tree.id, "owner-1", None, "unit", "单元", "d", ["A"], "c")
    a = repo.create_goal_node(tree.id, "owner-1", unit.id, "lesson", "甲", "", [], "")
    b = repo.create_goal_node(tree.id, "owner-1", unit.id, "lesson", "乙", "", [], "")

    updated = repo.update_goal_node(unit.id, "owner-1", "第一单元", "新描述", ["A", "B"], "新标准")
    assert (updated.title, updated.description, updated.standard_refs, updated.verify_criteria) == (
        "第一单元", "新描述", ["A", "B"], "新标准"
    )
    assert repo.update_goal_node(unit.id, "owner-2", "x", "x", [], "x") is None

    # 有子节点时删除被拒
    with pytest.raises(ConflictError):
        repo.delete_goal_node(unit.id, "owner-1")

    # 重排：甲乙互换
    repo.reorder_goal_node(b.id, "owner-1", "up")
    nodes = {n.id: n for n in repo.list_goal_nodes(tree.id, "owner-1")}
    assert nodes[b.id].sort_order < nodes[a.id].sort_order

    repo.delete_goal_node(a.id, "owner-1")
    repo.delete_goal_node(b.id, "owner-1")
    repo.delete_goal_node(unit.id, "owner-1")  # 子节点清空后可删
    assert repo.list_goal_nodes(tree.id, "owner-1") == []


def test_delete_goal_tree_cascades(repo):
    tree = _tree(repo)
    repo.create_goal_node(tree.id, "owner-1", None, "unit", "单元", "", [], "")
    assert repo.delete_goal_tree(tree.id, "owner-1") is True
    assert repo.get_goal_tree_for_owner(tree.id, "owner-1") is None
    assert repo.list_goal_nodes(tree.id, "owner-1") is None


def test_rename_goal_tree(repo):
    tree = _tree(repo)
    renamed = repo.rename_goal_tree(tree.id, "owner-1", "七上数学-草稿")
    assert renamed.title == "七上数学-草稿"
