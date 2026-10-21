"""启动时固定的工具表，并投影给模型。"""

import json

from app.tools.protocol import Tool

PROJECTION_LIMIT = 4000


class Registry:
    def __init__(self, tools: list[Tool]):
        names = [tool.name for tool in tools]
        if len(names) != len(set(names)):
            raise ValueError("duplicate tool name")
        self._tools = {tool.name: tool for tool in tools}

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def project(self) -> list[dict]:
        return [
            {"name": tool.name, "description": tool.description, "parameters": tool.parameters}
            for tool in self._tools.values()
        ]


def production_registry() -> Registry:
    return Registry([])


def assert_projection_budget(registry: Registry) -> None:
    text = json.dumps(registry.project(), ensure_ascii=False)
    if len(text) > PROJECTION_LIMIT:
        raise ValueError("tool schema exceeds 4000 characters")
