from fastapi.testclient import TestClient

from app.auth.passwords import hash_password
from app.config import Settings
from app.context.compact import SUMMARY_PREFIX
from app.graph.build import build_graph
from app.llm.protocol import AssistantMessage
from app.main import create_app
from app.storage.files import FileStore
from app.storage.repository import SqliteRepository
from app.tasks.runner import TurnContext, run_turn
from app.tools.registry import production_registry

PLAN_MESSAGE = (
    "当前处于计划模式：先写出可审阅的计划，等教师确认后再生成具体成品；不要跳过计划直接交付。"
)


def test_plan_mode_is_injected_after_goal_and_before_the_teacher_message(tmp_path):
    seen = []

    def complete(messages, tools):
        seen.append([item["content"] for item in messages])
        return AssistantMessage(content="好", tool_calls=[], prompt_tokens=3, completion_tokens=1)

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client, "teacher")
    conversation_id = client.post("/api/conversations").json()["conversation_id"]

    client.put(f"/api/conversations/{conversation_id}/goal", json={"goal": "把异分母加减讲通"})
    enabled = client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": True})
    assert enabled.status_code == 200
    assert enabled.json()["plan_mode"] is True
    body = client.get(f"/api/conversations/{conversation_id}").json()
    assert body["plan_mode"] is True
    assert next(part["tokens"] for part in body["context"]["parts"] if part["name"] == "plan") > 0

    posted = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "出三道练习"})
    _wait(client, posted.json()["task_id"])
    contents = seen[0]
    assert contents[-3] == "当前会话目标：把异分母加减讲通"
    assert contents[-2] == PLAN_MESSAGE
    assert contents[-1] == "出三道练习"

    disabled = client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": False})
    assert disabled.status_code == 200
    assert disabled.json()["plan_mode"] is False
    again = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "再出一道"})
    _wait(client, again.json()["task_id"])
    assert PLAN_MESSAGE not in seen[1]
    assert client.get(f"/api/conversations/{conversation_id}").json()["plan_mode"] is False
    parts = client.get(f"/api/conversations/{conversation_id}").json()["context"]["parts"]
    assert next(part["tokens"] for part in parts if part["name"] == "plan") == 0


def test_another_teacher_cannot_toggle_plan_mode(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=_ok)
    owner = TestClient(app)
    other = TestClient(app)
    _register(owner, "teacher")
    _register(other, "other")
    conversation_id = owner.post("/api/conversations").json()["conversation_id"]
    owner.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": True})
    missing = other.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": False})
    hidden = other.get(f"/api/conversations/{conversation_id}")
    assert missing.status_code == 404
    assert hidden.status_code == 404
    assert owner.get(f"/api/conversations/{conversation_id}").json()["plan_mode"] is True


def test_plan_mode_stays_outside_the_summary_after_compaction(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    owner = repo.create_user("teacher", "老师", hash_password("correct-horse"))
    conversation_id = repo.create_conversation(owner.id)
    assert repo.save_plan_mode(conversation_id, owner.id, True) is True
    store = FileStore(tmp_path)
    seen = []

    def complete(messages, tools):
        seen.append([item["content"] for item in messages])
        if messages and "CONTEXT CHECKPOINT" in messages[0]["content"]:
            return AssistantMessage(content="摘要：旧课已讲完。", tool_calls=[])
        return AssistantMessage(content="好", tool_calls=[], prompt_tokens=3, completion_tokens=1)

    graph = build_graph(production_registry(), complete, system="系统")
    context = TurnContext(
        system="系统",
        limit_tokens=80,
        limit_source="fallback",
        count_tokens=lambda messages: sum(len(message.get("content") or "") for message in messages),
        summarize=lambda prompt: "摘要：旧课已讲完。" if "CONTEXT CHECKPOINT" in prompt else None,
        keep_recent=12,
        output_reserve=10,
    )
    for text in ("甲" * 30, "乙" * 30, "丙" * 8):
        task = repo.submit_message(conversation_id, text, owner.id)
        run_turn(repo, store, graph, task.id, context)

    model_calls = [items for items in seen if PLAN_MESSAGE in items]
    last = model_calls[-1]
    summary_at = next(index for index, text in enumerate(last) if text.startswith(SUMMARY_PREFIX))
    assert last[summary_at + 1] == PLAN_MESSAGE
    assert "甲" * 30 not in last
    assert repo.get_plan_mode(conversation_id) is True


def _register(client: TestClient, username: str):
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": "correct-horse", "display_name": username},
    )
    assert response.status_code == 201


def _wait(client: TestClient, task_id: str):
    import threading

    for _ in range(50):
        body = client.get(f"/api/tasks/{task_id}").json()
        if body["status"] in {"succeeded", "failed"}:
            return body
        threading.Event().wait(0.02)
    raise AssertionError("timed out")


def _ok(messages, tools):
    return AssistantMessage(content="好", tool_calls=[])
