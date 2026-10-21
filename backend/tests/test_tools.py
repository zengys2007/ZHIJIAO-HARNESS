import pytest

from app.tools.protocol import Tool
from app.tools.registry import Registry, assert_projection_budget, production_registry
from app.tools.schema import argument_errors


def test_production_registry_has_no_preset_tools():
    registry = production_registry()

    assert registry.project() == []
    assert registry.get("use_preset") is None
    assert_projection_budget(registry)


def test_registry_rejects_duplicate_names():
    tool = _note_tool()
    with pytest.raises(ValueError):
        Registry([tool, tool])


def test_argument_schema_reports_missing_and_unknown_fields():
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["title"],
        "properties": {"title": {"type": "string", "minLength": 1}},
    }

    assert argument_errors(schema, {})
    assert argument_errors(schema, {"title": "页面", "extra": 1})
    assert argument_errors(schema, {"title": "页面"}) == []


def _note_tool() -> Tool:
    return Tool(
        name="note",
        description="记一笔。",
        parameters={"type": "object", "additionalProperties": False, "properties": {}},
        execute=lambda arguments, turn: "ok",
    )
