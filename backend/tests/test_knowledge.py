"""知识点库：环检测、编辑、删除、批量导入。"""

import pytest

from app.storage.protocol import KnowledgePoint
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
