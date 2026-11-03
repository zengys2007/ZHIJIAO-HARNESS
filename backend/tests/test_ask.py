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

ASK_LEAD = "当前处于提问模式：只回答教师的问题，不要交付试题、评语或课件成品。"
DRAFT_LEAD = (
    "当前处于计划模式：只修订下面的计划，不要交付试题、评语或课件成品。\n"
    "这一轮不要用短标题、表格、加粗或井号。方案用 A、B、C，不要写成方案一。\n"
    "至少写两套，每套严格三行，行首不要加符号：\n"
    "方案 A：名称\n"
    "适合：一句话\n"
    "步骤：一句话\n"
    "全部写完后，最后单独一行写：推荐：方案 A\n"
    "方案正文里不要出现「推荐」。"
)


def test_ask_mode_is_injected_before_the_teacher_message(tmp_path):
    seen = []

    def complete(messages, tools, sink=None):
        seen.append([item["content"] for item in messages])
        return AssistantMessage(content="好", tool_calls=[], prompt_tokens=3, completion_tokens=1)

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client, "teacher")
    conversation_id = client.post("/api/conversations").json()["conversation_id"]

    enabled = client.put(f"/api/conversations/{conversation_id}/ask", json={"ask_mode": True})
    assert enabled.status_code == 200
    assert enabled.json()["ask_mode"] is True
    body = client.get(f"/api/conversations/{conversation_id}").json()
    assert body["ask_mode"] is True
    assert "goal" not in body
    assert next(part["tokens"] for part in body["context"]["parts"] if part["name"] == "ask") > 0

    posted = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "异分母怎么讲"})
    _wait(client, posted.json()["task_id"])
    contents = seen[0]
    assert contents[-2] == ASK_LEAD
    assert contents[-1] == "异分母怎么讲"

    again = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "再举一个例子"})
    _wait(client, again.json()["task_id"])
    follow = seen[1]
    ask_at = follow.index(ASK_LEAD)
    assert follow[ask_at + 1] == "异分母怎么讲"
    assert follow[ask_at + 2] == "好"
    assert follow[-1] == "再举一个例子"

    disabled = client.put(f"/api/conversations/{conversation_id}/ask", json={"ask_mode": False})
    assert disabled.status_code == 200
    assert disabled.json()["ask_mode"] is False
    third = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "出三道练习"})
    _wait(client, third.json()["task_id"])
    assert all(item != ASK_LEAD for item in seen[2])
    closed = client.get(f"/api/conversations/{conversation_id}").json()
    assert closed["ask_mode"] is False
    assert next(part["tokens"] for part in closed["context"]["parts"] if part["name"] == "ask") == 0

    invalid = client.put(f"/api/conversations/{conversation_id}/ask", json={"ask_mode": "yes"})
    assert invalid.status_code == 400


def test_ask_and_plan_are_mutually_exclusive(tmp_path):
    seen = []

    def complete(messages, tools, sink=None):
        seen.append([item["content"] for item in messages])
        return AssistantMessage(content="好", tool_calls=[], prompt_tokens=3, completion_tokens=1)

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client, "teacher")
    conversation_id = client.post("/api/conversations").json()["conversation_id"]
    client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": True})
    drafted = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "先写计划"})
    _wait(client, drafted.json()["task_id"])

    asked = client.put(f"/api/conversations/{conversation_id}/ask", json={"ask_mode": True})
    assert asked.status_code == 200
    assert asked.json()["ask_mode"] is True
    assert asked.json()["plan_mode"] is False
    assert asked.json()["plan_status"] == "off"
    assert asked.json()["plan_body"] == "好"

    question = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "这一步为什么"})
    _wait(client, question.json()["task_id"])
    assert ASK_LEAD in seen[1]
    assert all(not item.startswith(DRAFT_LEAD) for item in seen[1])

    planned = client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": True})
    assert planned.json()["ask_mode"] is False
    assert planned.json()["plan_mode"] is True
    follow = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "改计划"})
    _wait(client, follow.json()["task_id"])
    assert all(item != ASK_LEAD for item in seen[2])
    assert any(item.startswith(DRAFT_LEAD) for item in seen[2])


def test_another_teacher_cannot_toggle_ask_mode(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=_ok)
    owner = TestClient(app)
    other = TestClient(app)
    _register(owner, "teacher")
    _register(other, "other")
    conversation_id = owner.post("/api/conversations").json()["conversation_id"]
    owner.put(f"/api/conversations/{conversation_id}/ask", json={"ask_mode": True})
    missing = other.put(f"/api/conversations/{conversation_id}/ask", json={"ask_mode": False})
    hidden = other.get(f"/api/conversations/{conversation_id}")
    assert missing.status_code == 404
    assert hidden.status_code == 404
    assert owner.get(f"/api/conversations/{conversation_id}").json()["ask_mode"] is True


def test_ask_stays_outside_the_summary_after_compaction(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    owner = repo.create_user("teacher", "老师", hash_password("correct-horse"))
    conversation_id = repo.create_conversation(owner.id)
    assert repo.save_ask_mode(conversation_id, owner.id, True) is True
    store = FileStore(tmp_path)
    seen = []

    def complete(messages, tools, sink=None):
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

    model_calls = [items for items in seen if ASK_LEAD in items]
    last = model_calls[-1]
    summary_at = next(index for index, text in enumerate(last) if text.startswith(SUMMARY_PREFIX))
    assert last[summary_at + 1] == ASK_LEAD
    assert "甲" * 30 not in last
    assert repo.get_ask_mode(conversation_id) is True


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


def _ok(messages, tools, sink=None):
    return AssistantMessage(content="好", tool_calls=[])
