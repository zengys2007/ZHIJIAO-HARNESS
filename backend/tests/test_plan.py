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
DELIVER_LEAD = "教师已选定下面这一套方案。只按这一套生成可直接使用的成品，不要混用其他方案，也不要再改写成新计划。"
GENERATE_MESSAGE = "请按已确认的计划生成成品。"


def test_plan_mode_is_injected_before_the_teacher_message(tmp_path):
    seen = []

    def complete(messages, tools, sink=None):
        seen.append([item["content"] for item in messages])
        return AssistantMessage(content="好", tool_calls=[], prompt_tokens=3, completion_tokens=1)

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client, "teacher")
    conversation_id = client.post("/api/conversations").json()["conversation_id"]

    enabled = client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": True})
    assert enabled.status_code == 200
    assert enabled.json()["plan_mode"] is True
    assert enabled.json()["plan_status"] == "draft"
    assert enabled.json()["plan_body"] == ""
    body = client.get(f"/api/conversations/{conversation_id}").json()
    assert body["plan_mode"] is True
    assert body["plan_status"] == "draft"
    assert next(part["tokens"] for part in body["context"]["parts"] if part["name"] == "plan") > 0
    assert client.get("/api/conversations").json()["conversations"][0]["title"] == "新对话"

    posted = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "出三道练习"})
    _wait(client, posted.json()["task_id"])
    contents = seen[0]
    assert contents[-2] == DRAFT_LEAD
    assert contents[-1] == "出三道练习"
    drafted = client.get(f"/api/conversations/{conversation_id}").json()
    assert drafted["plan_body"] == "好"
    assert drafted["plan_status"] == "draft"
    assert client.get("/api/conversations").json()["conversations"][0]["title"] == "出三道练习"

    disabled = client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": False})
    assert disabled.status_code == 200
    assert disabled.json()["plan_mode"] is False
    assert disabled.json()["plan_status"] == "off"
    assert disabled.json()["plan_body"] == "好"
    again = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "再出一道"})
    _wait(client, again.json()["task_id"])
    assert all(not item.startswith(DRAFT_LEAD) for item in seen[1])
    assert all(not item.startswith(DELIVER_LEAD) for item in seen[1])
    closed = client.get(f"/api/conversations/{conversation_id}").json()
    assert closed["plan_mode"] is False
    assert closed["plan_body"] == "好"
    assert client.get("/api/conversations").json()["conversations"][0]["title"] == "出三道练习"
    parts = closed["context"]["parts"]
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

    model_calls = [items for items in seen if any(item.startswith(DRAFT_LEAD) for item in items)]
    last = model_calls[-1]
    summary_at = next(index for index, text in enumerate(last) if text.startswith(SUMMARY_PREFIX))
    assert last[summary_at + 1].startswith(DRAFT_LEAD)
    assert "甲" * 30 not in last
    assert repo.get_plan_mode(conversation_id) is True
    assert repo.get_plan_state(conversation_id)[0] == "draft"


def test_draft_reply_becomes_the_plan_and_a_failure_keeps_the_previous_draft(tmp_path):
    seen = []

    def complete(messages, tools, sink=None):
        seen.append([item["content"] for item in messages])
        if len(seen) == 2:
            from app.llm.protocol import ModelError

            return ModelError(code="model_timeout", message="timeout")
        return AssistantMessage(content="新计划：先讲通分。", tool_calls=[], prompt_tokens=3, completion_tokens=1)

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client, "teacher")
    conversation_id = client.post("/api/conversations").json()["conversation_id"]
    client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": True})
    rejected = client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_body": "旧计划"})
    assert rejected.status_code == 200
    assert rejected.json()["plan_body"] == "旧计划"

    closed = client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": False})
    assert closed.status_code == 200
    blocked = client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_body": "不该写上"})
    assert blocked.status_code == 400
    client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": True})

    first = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "改计划"})
    assert _wait(client, first.json()["task_id"])["status"] == "succeeded"
    assert "旧计划" in seen[0][-2]
    assert client.get(f"/api/conversations/{conversation_id}").json()["plan_body"] == "新计划：先讲通分。"

    second = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "再改一次"})
    assert _wait(client, second.json()["task_id"])["status"] == "failed"
    assert client.get(f"/api/conversations/{conversation_id}").json()["plan_body"] == "新计划：先讲通分。"
    assert "新计划：先讲通分。" in seen[1][-2]


def test_confirmed_plan_is_injected_once_and_then_plan_mode_closes(tmp_path):
    seen = []

    def complete(messages, tools, sink=None):
        seen.append([item["content"] for item in messages])
        if len(seen) == 1:
            from app.llm.protocol import ModelError

            return ModelError(code="model_timeout", message="timeout")
        return AssistantMessage(content="三道练习。", tool_calls=[], prompt_tokens=3, completion_tokens=1)

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client, "teacher")
    conversation_id = client.post("/api/conversations").json()["conversation_id"]
    client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": True})
    empty = client.put(f"/api/conversations/{conversation_id}/plan", json={"action": "generate"})
    assert empty.status_code == 400
    assert "计划" in empty.json()["error"]["message"]

    client.put(f"/api/conversations/{conversation_id}/plan", json={"plan_body": "先讲通分，再出三题"})
    approved = client.put(f"/api/conversations/{conversation_id}/plan", json={"action": "generate"})
    assert approved.status_code == 200
    assert approved.json()["plan_status"] == "approved"
    assert approved.json()["plan_mode"] is False
    assert approved.json()["plan_body"] == "先讲通分，再出三题"

    failed = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": GENERATE_MESSAGE})
    assert _wait(client, failed.json()["task_id"])["status"] == "failed"
    held = client.get(f"/api/conversations/{conversation_id}").json()
    assert held["plan_status"] == "approved"
    assert DELIVER_LEAD in seen[0][-2]
    assert "先讲通分，再出三题" in seen[0][-2]

    posted = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": GENERATE_MESSAGE})
    assert _wait(client, posted.json()["task_id"])["status"] == "succeeded"
    done = client.get(f"/api/conversations/{conversation_id}").json()
    assert done["plan_status"] == "off"
    assert done["plan_mode"] is False
    assert done["plan_body"] == "先讲通分，再出三题"
    assert next(part["tokens"] for part in done["context"]["parts"] if part["name"] == "plan") == 0

    follow = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "再出一道"})
    _wait(client, follow.json()["task_id"])
    assert all(not item.startswith(DELIVER_LEAD) for item in seen[2])


def test_another_teacher_cannot_edit_or_confirm_the_plan(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=_ok)
    owner = TestClient(app)
    other = TestClient(app)
    _register(owner, "teacher")
    _register(other, "other")
    conversation_id = owner.post("/api/conversations").json()["conversation_id"]
    owner.put(f"/api/conversations/{conversation_id}/plan", json={"plan_mode": True})
    owner.put(f"/api/conversations/{conversation_id}/plan", json={"plan_body": "只给自己看"})
    assert other.put(f"/api/conversations/{conversation_id}/plan", json={"plan_body": "改掉"}).status_code == 404
    assert other.put(f"/api/conversations/{conversation_id}/plan", json={"action": "generate"}).status_code == 404
    body = owner.get(f"/api/conversations/{conversation_id}").json()
    assert body["plan_body"] == "只给自己看"
    assert body["plan_status"] == "draft"


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
