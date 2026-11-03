import threading

from fastapi.testclient import TestClient

from app.auth.passwords import hash_password
from app.config import Settings
from app.llm.protocol import AssistantMessage
from app.main import create_app
from app.storage.files import FileStore
from app.storage.repository import ConflictError, NotFoundError, SqliteRepository
from app.tasks.states import RUNNING, SUCCEEDED


def test_pinned_conversations_sort_ahead_of_newer_ones(tmp_path):
    repo, owner_id, older, newer = _two_conversations(tmp_path)
    assert [item.conversation_id for item in repo.list_conversations(owner_id)] == [newer, older]
    assert repo.list_conversations(owner_id)[0].pinned is False

    assert repo.set_pinned(older, owner_id, True) is True
    listed = repo.list_conversations(owner_id)
    assert [item.conversation_id for item in listed] == [older, newer]
    assert listed[0].pinned is True
    assert listed[1].pinned is False

    assert repo.set_pinned(newer, owner_id, True) is True
    assert [item.conversation_id for item in repo.list_conversations(owner_id)] == [newer, older]

    assert repo.set_pinned(newer, owner_id, False) is False
    assert [item.conversation_id for item in repo.list_conversations(owner_id)] == [older, newer]
    assert repo.set_pinned("b" * 32, owner_id, True) is None


def test_delete_removes_turns_events_and_artifacts_but_keeps_teaching_data(tmp_path):
    repo, store, conversation_id, owner_id = _conversation(tmp_path)
    other = repo.create_conversation(owner_id)
    class_id = repo.create_class(owner_id, "三班", ["林晓"])
    task = repo.submit_message(conversation_id, "怎么讲通分", owner_id)
    try:
        repo.delete_conversation(conversation_id, owner_id)
        raise AssertionError("expected conflict")
    except ConflictError:
        pass
    assert repo.get_task(task.id) is not None

    artifact_id = "c" * 32
    repo.transition(task.id, RUNNING)
    repo.append_event(task.id, "user_message", {"content": "怎么讲通分"})
    repo.transition(task.id, SUCCEEDED, reply="先画一块饼。", artifact_id=artifact_id, version=1)
    repo.insert_published_version(
        artifact_id=artifact_id,
        version=1,
        task_id=task.id,
        title="通分",
        tool_name="page",
        preset=None,
        files=[{"path": "index.html"}],
        metadata={},
        arguments={},
    )
    published = store.version_dir(artifact_id, 1)
    published.mkdir(parents=True)
    (published / "index.html").write_text("<p>通分</p>", encoding="utf-8")

    removed = repo.delete_conversation(conversation_id, owner_id)
    assert removed == [artifact_id]
    assert repo.list_conversation_tasks(conversation_id, owner_id) is None
    assert repo.get_task(task.id) is None
    assert repo.list_events(task.id) == []
    assert repo.get_version(artifact_id, 1) is None
    assert [item.conversation_id for item in repo.list_conversations(owner_id)] == [other]
    assert repo.load_teaching(owner_id).classes[0].id == class_id
    try:
        repo.delete_conversation(conversation_id, owner_id)
        raise AssertionError("expected not found")
    except NotFoundError:
        pass


def test_pin_and_delete_http_keep_owner_isolation(tmp_path):
    gate = threading.Event()

    def complete(messages, tools, sink=None):
        gate.wait(2)
        return AssistantMessage(content="好", tool_calls=[])

    app = create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=complete)
    client = TestClient(app)
    other = TestClient(app)
    _register(client, "teacher")
    _register(other, "other-teacher")
    older = client.post("/api/conversations").json()["conversation_id"]
    newer = client.post("/api/conversations").json()["conversation_id"]
    _stamp(app.state.repository, older, "2026-11-03T01:00:00Z")
    _stamp(app.state.repository, newer, "2026-11-03T02:00:00Z")

    listed = client.get("/api/conversations")
    assert listed.status_code == 200
    assert [item["conversation_id"] for item in listed.json()["conversations"]] == [newer, older]
    assert listed.json()["conversations"][0]["pinned"] is False

    pinned = client.put(f"/api/conversations/{older}/pin", json={"pinned": True})
    assert pinned.status_code == 200
    assert pinned.json() == {"conversation_id": older, "pinned": True}
    again = client.get("/api/conversations").json()["conversations"]
    assert [item["conversation_id"] for item in again] == [older, newer]
    assert again[0]["pinned"] is True

    invalid = client.put(f"/api/conversations/{older}/pin", json={"pinned": "yes"})
    assert invalid.status_code == 400
    hidden = other.put(f"/api/conversations/{older}/pin", json={"pinned": False})
    assert hidden.status_code == 404

    posted = client.post(f"/api/conversations/{older}/messages", json={"content": "还在回复"})
    assert posted.status_code == 202
    try:
        busy = client.delete(f"/api/conversations/{older}")
        assert busy.status_code == 409
        assert busy.json()["error"]["message"] == "这条会话还在回复，等它结束再删除。"
        assert client.get(f"/api/conversations/{older}").status_code == 200
    finally:
        gate.set()

    artifact_id = "c" * 32
    owner_id = app.state.repository.get_conversation_owner(newer)
    task = app.state.repository.submit_message(newer, "做成一页", owner_id)
    app.state.repository.transition(task.id, RUNNING)
    app.state.repository.transition(task.id, SUCCEEDED, reply="好", artifact_id=artifact_id, version=1)
    app.state.repository.insert_published_version(
        artifact_id=artifact_id,
        version=1,
        task_id=task.id,
        title="通分",
        tool_name="page",
        preset=None,
        files=[{"path": "index.html"}],
        metadata={},
        arguments={},
    )
    published = app.state.files.version_dir(artifact_id, 1)
    published.mkdir(parents=True)
    (published / "index.html").write_text("<p>通分</p>", encoding="utf-8")

    removed = client.delete(f"/api/conversations/{newer}")
    assert removed.status_code == 204
    assert removed.content == b""
    assert not published.exists()
    assert [item["conversation_id"] for item in client.get("/api/conversations").json()["conversations"]] == [older]
    assert other.delete(f"/api/conversations/{older}").status_code == 404
    assert client.get(f"/api/conversations/{older}").status_code == 200


def _two_conversations(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    owner = repo.create_user("teacher", "老师", hash_password("correct-horse"))
    older = repo.create_conversation(owner.id)
    newer = repo.create_conversation(owner.id)
    _stamp(repo, older, "2026-11-03T01:00:00Z")
    _stamp(repo, newer, "2026-11-03T02:00:00Z")
    return repo, owner.id, older, newer


def _stamp(repo: SqliteRepository, conversation_id: str, created_at: str) -> None:
    repo._conn.execute(
        "UPDATE conversations SET created_at = ? WHERE id = ?",
        (created_at, conversation_id),
    )


def _conversation(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    owner = repo.create_user("teacher", "老师", hash_password("correct-horse"))
    store = FileStore(tmp_path)
    return repo, store, repo.create_conversation(owner.id), owner.id


def _register(client: TestClient, username: str):
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": "correct-horse", "display_name": username},
    )
    assert response.status_code == 201

