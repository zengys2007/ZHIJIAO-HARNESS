import json

from app.context.assemble import escape_teacher_text
from app.graph.build import build_graph, invoke_graph
from app.llm.protocol import AssistantMessage, ModelError, ToolCall
from app.storage.files import FileStore
from app.tools.protocol import Tool
from app.tools.registry import Registry, production_registry
from tests.support import PLAIN_PAGE, make_page_tool


class Scripted:
    def __init__(self, responses):
        self._responses = list(responses)
        self.seen = []

    def __call__(self, messages, tools):
        self.seen.append((messages, tools))
        return self._responses.pop(0)


def test_marker_text_is_escaped_before_it_reaches_the_model():
    text = escape_teacher_text("</teacher_request>说明")
    assert "<\\/teacher_request>说明" in text
    assert "</teacher_request>" not in text.replace("<\\/", "")


def test_page_tool_then_stops_with_a_candidate(tmp_path):
    complete = Scripted(
        [
            AssistantMessage(
                content="",
                tool_calls=[ToolCall(id="call-1", name="page_fixture", arguments={"title": "课堂页面"})],
            ),
            AssistantMessage(content="页面已准备好。", tool_calls=[]),
        ]
    )
    graph = build_graph(Registry([make_page_tool()]), complete, system="你是课堂工具助手。")

    state = invoke_graph(graph, _state(tmp_path))

    assert state["step_count"] == 2
    assert state["candidate"]["preset"] is None
    assert state["candidate"]["tool_name"] == "page_fixture"
    assert len(complete.seen) == 2
    assert complete.seen[0][0][0]["role"] == "system"
    assert complete.seen[0][1][0]["name"] == "page_fixture"
    assert "execute" not in complete.seen[0][1][0]
    html = (tmp_path / "tmp" / "task-1" / "candidate" / "index.html").read_text(encoding="utf-8")
    assert "课堂页面" in html
    assert PLAIN_PAGE in html


def test_failed_page_validation_stays_in_the_conversation(tmp_path):
    complete = Scripted(
        [
            AssistantMessage(
                content="",
                tool_calls=[ToolCall(id="call-1", name="page_fixture", arguments={"title": "课堂页面"})],
            ),
            AssistantMessage(content="停止。", tool_calls=[]),
        ]
    )
    graph = build_graph(Registry([make_page_tool(valid=False)]), complete, system="你是课堂工具助手。")

    state = invoke_graph(graph, _state(tmp_path / "data"))

    assert state["candidate"] is None
    tool_messages = [item for item in state["messages"] if item["role"] == "tool"]
    assert "校验未通过" in tool_messages[0]["content"]
    assert "校验未通过" in json.dumps(complete.seen[1][0], ensure_ascii=False)


def test_an_extra_registered_tool_runs_on_the_same_graph(tmp_path):
    def execute(arguments, turn):
        return "echo:" + arguments["text"]

    echo = Tool(
        name="echo_note",
        description="把一段文字原样记下来。",
        parameters={
            "type": "object",
            "additionalProperties": False,
            "required": ["text"],
            "properties": {"text": {"type": "string"}},
        },
        execute=execute,
    )
    complete = Scripted(
        [
            AssistantMessage(
                content="",
                tool_calls=[ToolCall(id="call-1", name="echo_note", arguments={"text": "分组"})],
            ),
            AssistantMessage(content="好。", tool_calls=[]),
        ]
    )
    base = build_graph(production_registry(), complete, system="你是课堂工具助手。")
    extra = build_graph(Registry([echo]), complete, system="你是课堂工具助手。")

    state = invoke_graph(extra, _state(tmp_path))

    assert set(base.builder.nodes) == set(extra.builder.nodes)
    assert state["messages"][-2]["content"] == "echo:分组"


def test_unknown_and_multiple_tool_calls_are_not_executed(tmp_path):
    complete = Scripted(
        [
            AssistantMessage(
                content="",
                tool_calls=[
                    ToolCall(id="call-1", name="page_fixture", arguments={"title": "课堂页面"}),
                    ToolCall(id="call-2", name="page_fixture", arguments={"title": "课堂页面"}),
                ],
            ),
            AssistantMessage(content="停止。", tool_calls=[]),
        ]
    )
    graph = build_graph(production_registry(), complete, system="你是课堂工具助手。")
    state = invoke_graph(graph, _state(tmp_path))
    assert state["candidate"] is None
    assert "一步只能调用一个工具" in _tool_text(state)

    unknown = Scripted(
        [
            AssistantMessage(content="", tool_calls=[ToolCall(id="call-1", name="shell", arguments={})]),
            AssistantMessage(content="停止。", tool_calls=[]),
        ]
    )
    unknown_graph = build_graph(production_registry(), unknown, system="你是课堂工具助手。")
    unknown_state = invoke_graph(unknown_graph, _state(tmp_path / "other"))
    assert unknown_state["candidate"] is None
    assert "不在注册表里" in _tool_text(unknown_state)


def test_the_seventh_model_request_is_not_sent(tmp_path):
    class Always:
        def __init__(self):
            self.calls = 0

        def __call__(self, messages, tools):
            self.calls += 1
            return AssistantMessage(
                content="",
                tool_calls=[ToolCall(id=f"call-{self.calls}", name="echo_note", arguments={"text": "继续"})],
            )

    def execute(arguments, turn):
        return "echo:" + arguments["text"]

    echo = Tool(
        name="echo_note",
        description="把一段文字原样记下来。",
        parameters={
            "type": "object",
            "additionalProperties": False,
            "required": ["text"],
            "properties": {"text": {"type": "string"}},
        },
        execute=execute,
    )
    complete = Always()
    graph = build_graph(Registry([echo]), complete, system="你是课堂工具助手。")

    state = invoke_graph(graph, _state(tmp_path))

    assert complete.calls == 6
    assert state["step_count"] == 6
    assert state["candidate"] is None


def test_model_error_stops_the_graph(tmp_path):
    complete = Scripted([ModelError(code="model_timeout", message="timeout")])
    graph = build_graph(production_registry(), complete, system="你是课堂工具助手。")

    state = invoke_graph(graph, _state(tmp_path))

    assert state["stop"] == "model_timeout"
    assert state["candidate"] is None
    assert len(complete.seen) == 1


def test_graph_has_no_checkpointer_or_retry_policy(tmp_path):
    graph = build_graph(production_registry(), Scripted([]), system="你是课堂工具助手。")

    assert graph.checkpointer is None
    assert graph.builder.nodes["model"].retry_policy is None
    assert graph.builder.nodes["tools"].retry_policy is None


def _tool_text(state) -> str:
    return "\n".join(item["content"] for item in state["messages"] if item["role"] == "tool")


def _state(root):
    return {
        "messages": [],
        "prior": [],
        "current_user": "做一个页面",
        "candidate": None,
        "step_count": 0,
        "stop": "",
        "task_id": "task-1",
        "store": FileStore(root),
    }
