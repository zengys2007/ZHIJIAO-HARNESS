"""知识点先修关系的环检测。纯函数，不依赖存储。"""

from app.storage.protocol import KnowledgePoint


def find_cycle(points: list[KnowledgePoint]) -> list[str] | None:
    """检测先修图里的环。返回成环链（首尾同名，如 [约分, 通分, 约分]），无环返回 None。

    先修引用了点集之外的名时忽略该边——调用方负责先补建缺失点再检测。
    """
    names = {point.name for point in points}
    adjacency: dict[str, list[str]] = {
        point.name: [name for name in point.prerequisites if name in names]
        for point in points
    }

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {name: WHITE for name in names}
    stack: list[str] = []

    def visit(name: str) -> list[str] | None:
        color[name] = GRAY
        stack.append(name)
        for next_name in adjacency[name]:
            if color[next_name] == GRAY:
                index = stack.index(next_name)
                return [*stack[index:], next_name]
            if color[next_name] == WHITE:
                found = visit(next_name)
                if found is not None:
                    return found
        stack.pop()
        color[name] = BLACK
        return None

    for name in names:
        if color[name] == WHITE:
            found = visit(name)
            if found is not None:
                return found
    return None
