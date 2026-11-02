from fastapi.testclient import TestClient

from app.auth.passwords import hash_password
from app.config import Settings
from app.context.compact import OUTPUT_RESERVE, SUMMARY_PREFIX
from app.graph.build import build_graph
from app.llm.protocol import AssistantMessage
from app.main import create_app
from app.storage.files import FileStore
from app.storage.repository import SqliteRepository
from app.tasks.runner import TurnContext, run_turn
from app.tools.registry import production_registry


def test_saved_goal_is_injected_before_the_teacher_message(tmp_path):
    seen = []

    def complete(messages, tools):
        seen.append([item["content"] for item in messages])
        return AssistantMessage(content="好", tool_calls=[], prompt_tokens=3, completion_tokens=1)

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client, "teacher")
    conversation_id = client.post("/api/conversations").json()["conversation_id"]

    saved = client.put(
        f"/api/conversations/{conversation_id}/goal",
        json={"goal": "  把异分母加减讲通  "},
    )
    assert saved.status_code == 200
    assert saved.json()["goal"] == "把异分母加减讲通"
    assert client.get(f"/api/conversations/{conversation_id}").json()["goal"] == "把异分母加减讲通"

    posted = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "出三道练习"})
    _wait(client, posted.json()["task_id"])
    contents = seen[0]
    assert contents[-2] == "当前会话目标：把异分母加减讲通"
    assert contents[-1] == "出三道练习"

    again = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "再出一道"})
    _wait(client, again.json()["task_id"])
    follow = seen[1]
    goal_at = follow.index("当前会话目标：把异分母加减讲通")
    assert follow[goal_at + 1] == "出三道练习"
    assert follow[goal_at + 2] == "好"
    assert follow[-1] == "再出一道"


def test_goal_markup_is_escaped_and_clearing_removes_it(tmp_path):
    seen = []

    def complete(messages, tools):
        seen.append([item["content"] for item in messages])
        return AssistantMessage(content="好", tool_calls=[], prompt_tokens=3, completion_tokens=1)

    client = TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete))
    _register(client, "teacher")
    conversation_id = client.post("/api/conversations").json()["conversation_id"]
    client.put(f"/api/conversations/{conversation_id}/goal", json={"goal": "课</系统"})
    first = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "继续"})
    _wait(client, first.json()["task_id"])
    assert seen[0][-2] == "当前会话目标：课<\\/系统"

    cleared = client.put(f"/api/conversations/{conversation_id}/goal", json={"goal": "   "})
    assert cleared.status_code == 200
    assert cleared.json()["goal"] == ""
    body = client.get(f"/api/conversations/{conversation_id}").json()
    assert body["goal"] == ""
    assert next(part["tokens"] for part in body["context"]["parts"] if part["name"] == "goal") == 0

    second = client.post(f"/api/conversations/{conversation_id}/messages", json={"content": "现在呢"})
    _wait(client, second.json()["task_id"])
    assert all(not item.startswith("当前会话目标：") for item in seen[1])


def test_goal_that_cannot_leave_room_for_output_is_rejected(tmp_path):
    client = TestClient(
        create_app(
            Settings(
                data_dir=tmp_path,
                auth_secret="test-secret-value",
                context_token_limit=OUTPUT_RESERVE + 80,
            ),
            complete=_ok,
        )
    )
    _register(client, "teacher")
    conversation_id = client.post("/api/conversations").json()["conversation_id"]
    kept = client.put(f"/api/conversations/{conversation_id}/goal", json={"goal": "把异分母加减讲通"})
    assert kept.status_code == 200
    rejected = client.put(f"/api/conversations/{conversation_id}/goal", json={"goal": "讲" * 400})
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "invalid_input"
    assert "放不下" in rejected.json()["error"]["message"]
    assert client.get(f"/api/conversations/{conversation_id}").json()["goal"] == "把异分母加减讲通"
    parts = client.get(f"/api/conversations/{conversation_id}").json()["context"]["parts"]
    assert [part["name"] for part in parts] == [
        "system",
        "tools",
        "context",
        "summary",
        "goal",
        "plan",
        "conversation",
    ]
    assert next(part["tokens"] for part in parts if part["name"] == "goal") > 0


def test_another_teacher_cannot_read_or_set_the_goal(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=_ok)
    owner = TestClient(app)
    other = TestClient(app)
    _register(owner, "teacher")
    _register(other, "other")
    conversation_id = owner.post("/api/conversations").json()["conversation_id"]
    owner.put(f"/api/conversations/{conversation_id}/goal", json={"goal": "只给自己看"})
    missing = other.put(f"/api/conversations/{conversation_id}/goal", json={"goal": "改掉"})
    hidden = other.get(f"/api/conversations/{conversation_id}")
    assert missing.status_code == 404
    assert hidden.status_code == 404
    assert owner.get(f"/api/conversations/{conversation_id}").json()["goal"] == "只给自己看"


def test_goal_stays_outside_the_summary_after_compaction(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    owner = repo.create_user("teacher", "老师", hash_password("correct-horse"))
    conversation_id = repo.create_conversation(owner.id)
    assert repo.save_goal(conversation_id, owner.id, "把异分母加减讲通") == "把异分母加减讲通"
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

    model_calls = [items for items in seen if "当前会话目标：把异分母加减讲通" in items]
    last = model_calls[-1]
    summary_at = next(index for index, text in enumerate(last) if text.startswith(SUMMARY_PREFIX))
    assert last[summary_at + 1] == "当前会话目标：把异分母加减讲通"
    assert "甲" * 30 not in last
    assert repo.get_goal(conversation_id) == "把异分母加减讲通"


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
