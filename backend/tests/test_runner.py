from datetime import datetime, timedelta, timezone

from app.graph.build import build_graph
from app.llm.protocol import AssistantMessage, ModelError, ToolCall
from app.storage.files import FileStore
from app.storage.repository import SqliteRepository
from app.tasks.runner import fail_stale_tasks, run_turn
from app.tasks.states import FAILED, RUNNING, SUCCEEDED
from app.tools.registry import Registry, production_registry
from tests.support import make_page_tool


class Scripted:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def __call__(self, messages, tools):
        self.calls += 1
        return self._responses.pop(0)


def test_page_turn_publishes_one_version(tmp_path):
    repo, store, task = _task(tmp_path)
    complete = Scripted(
        [
            AssistantMessage(
                content="",
                tool_calls=[ToolCall(id="call-1", name="page_fixture", arguments={"title": "课堂页面"})],
            ),
            AssistantMessage(content="页面已准备好。", tool_calls=[]),
        ]
    )
    run_turn(repo, store, _graph(complete, [make_page_tool()]), task.id)

    saved = repo.get_task(task.id)
    events = repo.list_events(task.id)
    assert saved.status == SUCCEEDED
    assert saved.reply == "页面已准备好。"
    assert saved.step_count == 2
    assert [event.type for event in events] == [
        "user_message",
        "assistant_message",
        "tool_result",
        "assistant_message",
    ]
    assert events[0].payload["content"] == "做一个页面"
    assert events[2].payload["content"].startswith("校验通过")


def test_failed_validation_does_not_publish(tmp_path):
    repo = SqliteRepository(tmp_path / "data" / "app.sqlite")
    store = FileStore(tmp_path / "data")
    task = repo.create_task("做一个页面", None)
    complete = Scripted(
        [
            AssistantMessage(
                content="",
                tool_calls=[ToolCall(id="call-1", name="page_fixture", arguments={"title": "课堂页面"})],
            ),
            AssistantMessage(content="", tool_calls=[]),
        ]
    )
    graph = build_graph(Registry([make_page_tool(valid=False)]), complete, system="你是课堂工具助手。")
    run_turn(repo, store, graph, task.id)

    saved = repo.get_task(task.id)
    assert saved.status == FAILED
    assert saved.error_code == "model_invalid_output"
    assert saved.artifact_id is None
    assert repo.list_events(task.id)[2].type == "tool_result"
    assert list((tmp_path / "data" / "artifacts").glob("*")) == []


def test_model_error_discards_a_candidate(tmp_path):
    repo, store, task = _task(tmp_path)
    complete = Scripted(
        [
            AssistantMessage(
                content="",
                tool_calls=[ToolCall(id="call-1", name="page_fixture", arguments={"title": "课堂页面"})],
            ),
            ModelError(code="model_timeout", message="timeout"),
        ]
    )
    run_turn(repo, store, _graph(complete, [make_page_tool()]), task.id)

    saved = repo.get_task(task.id)
    assert saved.status == FAILED
    assert saved.error_code == "model_timeout"
    assert saved.artifact_id is None
    assert not (tmp_path / "tmp" / task.id).exists()


def test_step_limit_without_a_candidate_fails(tmp_path):
    from app.tools.protocol import Tool

    def execute(arguments, turn):
        return "echo:" + arguments["text"]

    echo = Tool(
        name="echo_note",
        description="记一笔。",
        parameters={
            "type": "object",
            "additionalProperties": False,
            "required": ["text"],
            "properties": {"text": {"type": "string"}},
        },
        execute=execute,
    )

    class Always:
        def __init__(self):
            self.calls = 0

        def __call__(self, messages, tools):
            self.calls += 1
            return AssistantMessage(
                content="",
                tool_calls=[ToolCall(id=f"call-{self.calls}", name="echo_note", arguments={"text": "继续"})],
            )

    repo, store, task = _task(tmp_path)
    complete = Always()
    graph = build_graph(Registry([echo]), complete, system="你是课堂工具助手。")
    run_turn(repo, store, graph, task.id)

    saved = repo.get_task(task.id)
    assert complete.calls == 6
    assert saved.status == FAILED
    assert saved.error_code == "step_limit"


def test_crashed_invoke_is_internal(tmp_path):
    repo, store, task = _task(tmp_path)

    def explode(messages, tools):
        raise RuntimeError("boom")

    run_turn(repo, store, _graph(explode), task.id)
    saved = repo.get_task(task.id)
    assert saved.status == FAILED
    assert saved.error_code == "internal"
    assert "boom" not in (saved.error_message or "")
    assert not (tmp_path / "tmp" / task.id).exists()


def test_running_task_without_events_becomes_interrupted(tmp_path):
    repo, store, task = _task(tmp_path)
    repo.transition(task.id, RUNNING)
    fail_stale_tasks(repo, store, datetime.now(timezone.utc))
    assert repo.get_task(task.id).status == RUNNING

    fail_stale_tasks(repo, store, datetime.now(timezone.utc) + timedelta(minutes=11))
    saved = repo.get_task(task.id)
    assert saved.status == FAILED
    assert saved.error_code == "interrupted"


def _task(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    store = FileStore(tmp_path)
    task = repo.create_task("做一个页面", None)
    return repo, store, task


def _graph(complete, tools=None):
    registry = production_registry() if tools is None else Registry(tools)
    return build_graph(registry, complete, system="你是课堂工具助手。")
