import sqlite3

from fastapi.testclient import TestClient

from app.auth.passwords import hash_password, verify_password
from app.auth.sessions import resolve_user, sign_cookie
from app.config import Settings
from app.llm.protocol import AssistantMessage
from app.main import create_app
from app.storage import open_repository
from app.storage.repository import SqliteRepository

SECRET = "test-secret-value"
PASSWORD = "correct-horse"


def test_password_hash_stores_scrypt_parameters_without_the_password():
    stored = hash_password(PASSWORD)

    assert stored.startswith("scrypt$16384$8$1$")
    assert PASSWORD not in stored
    assert verify_password(PASSWORD, stored) is True
    assert verify_password("wrong-password", stored) is False
    assert verify_password(PASSWORD, "scrypt$16384$8$1$aaaa$bbbb") is False


def test_register_sets_a_signed_cookie_and_hides_the_password(tmp_path):
    client = _client(tmp_path)

    created = client.post(
        "/api/auth/register",
        json={"username": "teacher", "password": PASSWORD, "display_name": "王 老师"},
    )

    assert created.status_code == 201
    body = created.json()
    assert body["username"] == "teacher"
    assert body["display_name"] == "王 老师"
    assert len(body["user_id"]) == 32
    assert PASSWORD not in created.text
    cookie = created.headers["set-cookie"].lower()
    assert "zhijiao_session=" in cookie
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["display_name"] == "王 老师"
    stored = _password_hash(tmp_path)
    assert stored.startswith("scrypt$16384$8$1$")
    assert PASSWORD not in stored


def test_register_uses_the_username_when_display_name_is_omitted(tmp_path):
    client = _client(tmp_path)

    created = client.post("/api/auth/register", json={"username": " teacher ", "password": PASSWORD})

    assert created.status_code == 201
    assert created.json()["username"] == "teacher"
    assert created.json()["display_name"] == "teacher"


def test_register_rejects_bad_fields_and_reserved_or_duplicate_names(tmp_path):
    client = _client(tmp_path)
    reserved = client.post("/api/auth/register", json={"username": "local-admin", "password": PASSWORD})
    short = client.post("/api/auth/register", json={"username": "teacher", "password": "short"})
    spaced = client.post("/api/auth/register", json={"username": "tea cher", "password": PASSWORD})
    extra = client.post(
        "/api/auth/register",
        json={"username": "teacher", "password": PASSWORD, "extra": 1},
    )
    client.post("/api/auth/register", json={"username": "teacher", "password": PASSWORD})
    duplicate = client.post("/api/auth/register", json={"username": "teacher", "password": PASSWORD})

    assert reserved.status_code == 409
    assert reserved.json()["error"] == {
        "code": "conflict",
        "message": "这个用户名已经有人使用。",
        "retryable": False,
    }
    assert short.status_code == 400
    assert short.json()["error"]["message"] == "密码写成 8 到 128 个字。"
    assert spaced.json()["error"]["message"] == "用户名写成 1 到 32 个字，中间不要有空格。"
    assert extra.status_code == 400
    assert extra.json()["error"]["message"] == "请求里有不能识别的字段。"
    assert duplicate.status_code == 409


def test_login_failure_uses_one_sentence_and_logout_revokes_only_that_session(tmp_path):
    client = _client(tmp_path)
    client.post("/api/auth/register", json={"username": "teacher", "password": PASSWORD})
    first = client.cookies.get("zhijiao_session")
    logged = client.post("/api/auth/login", json={"username": "teacher", "password": PASSWORD})
    second = client.cookies.get("zhijiao_session")
    missing = client.post("/api/auth/login", json={"username": "missing", "password": PASSWORD})
    wrong = client.post("/api/auth/login", json={"username": "teacher", "password": "wrong-password"})

    assert logged.status_code == 200
    assert first != second
    assert missing.status_code == 400
    assert wrong.status_code == 400
    assert missing.json()["error"]["message"] == "用户名或密码不正确。"
    assert wrong.json()["error"]["message"] == missing.json()["error"]["message"]

    client.cookies.set("zhijiao_session", second)
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.set("zhijiao_session", first)
    assert client.get("/api/auth/me").status_code == 200
    anonymous = TestClient(client.app).post("/api/auth/logout")
    assert anonymous.status_code == 401
    assert anonymous.json()["error"]["code"] == "unauthenticated"


def test_teachers_cannot_read_each_others_conversations_or_tasks(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, auth_secret=SECRET), complete=_ok)
    teacher_a = TestClient(app)
    teacher_b = TestClient(app)
    teacher_a.post("/api/auth/register", json={"username": "teacher-a", "password": PASSWORD})
    teacher_b.post("/api/auth/register", json={"username": "teacher-b", "password": PASSWORD})
    created = teacher_a.post("/api/conversations")
    conversation_id = created.json()["conversation_id"]
    sent = teacher_a.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"content": "这节课怎么讲通分\n第二行"},
    )
    task_id = sent.json()["task_id"]

    assert teacher_b.get(f"/api/conversations/{conversation_id}").status_code == 404
    assert teacher_b.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"content": "我也看看"},
    ).status_code == 404
    assert teacher_b.get(f"/api/tasks/{task_id}").status_code == 404
    listed = teacher_a.get("/api/conversations").json()["conversations"]
    assert listed[0]["title"] == "这节课怎么讲通分"
    assert conversation_id not in {
        item["conversation_id"] for item in teacher_b.get("/api/conversations").json()["conversations"]
    }
    long = teacher_a.post("/api/conversations")
    teacher_a.post(
        f"/api/conversations/{long.json()['conversation_id']}/messages",
        json={"content": "一二三四五六七八九十一二三四五六七八九"},
    )
    titles = [item["title"] for item in teacher_a.get("/api/conversations").json()["conversations"]]
    assert "一二三四五六七八九十一二三四五六七八…" in titles


def test_anonymous_requests_do_not_create_conversations(tmp_path):
    client = _client(tmp_path)
    health = client.get("/health")
    created = client.post("/api/conversations")
    probe = client.post("/api/llm/probe", json={"source": "local"})

    assert health.status_code == 200
    assert created.status_code == 401
    assert created.json()["error"]["message"] == "请先登录。"
    assert probe.status_code == 401
    repo = SqliteRepository(tmp_path / "app.sqlite")
    assert repo.list_conversations("a" * 32) == []
    assert repo.get_user_by_username("local-admin") is None


def test_existing_conversations_go_to_the_local_admin_without_keeping_the_password(tmp_path):
    path = tmp_path / "app.sqlite"
    _insert_unowned(path, "abc" * 10 + "ab")
    try:
        SqliteRepository(path, admin_password="short")
        raise AssertionError("expected startup failure")
    except RuntimeError as exc:
        assert "short" not in str(exc)

    repo = SqliteRepository(path, admin_password=PASSWORD)
    admin = repo.get_user_by_username("local-admin")
    assert admin is not None
    assert admin.display_name == "本地管理员"
    assert PASSWORD not in admin.password_hash
    assert repo.list_conversations(admin.id)[0].conversation_id == "abc" * 10 + "ab"
    original_hash = admin.password_hash
    again = SqliteRepository(path, admin_password="another-password")
    assert again.get_user_by_username("local-admin").password_hash == original_hash


def test_empty_database_does_not_create_a_local_admin(tmp_path):
    repo = open_repository(Settings(data_dir=tmp_path, auth_secret=SECRET))

    assert isinstance(repo, SqliteRepository)
    assert repo.get_user_by_username("local-admin") is None


def test_expired_cookie_is_rejected_and_the_session_row_is_removed(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    user = repo.create_user("teacher", "老师", hash_password(PASSWORD))
    session = repo.create_session(user.id, "2020-01-01T00:00:00Z")
    cookie = sign_cookie(session.id, 1577836800, SECRET)

    assert resolve_user(repo, cookie, SECRET) is None
    assert repo.get_session(session.id) is None


def test_short_auth_secret_refuses_to_start_without_echoing_it(tmp_path):
    try:
        create_app(Settings(data_dir=tmp_path, auth_secret="too-short"), complete=_ok)
        raise AssertionError("expected startup failure")
    except RuntimeError as exc:
        assert "too-short" not in str(exc)


def _client(tmp_path):
    return TestClient(create_app(Settings(data_dir=tmp_path, auth_secret=SECRET), complete=_ok))


def _ok(messages, tools):
    return AssistantMessage(content="好", tool_calls=[])


def _password_hash(tmp_path):
    connection = sqlite3.connect(tmp_path / "app.sqlite")
    try:
        return connection.execute("SELECT password_hash FROM users").fetchone()[0]
    finally:
        connection.close()


def _insert_unowned(path, conversation_id):
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE conversations (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)")
    connection.execute(
        "INSERT INTO conversations (id, created_at) VALUES (?, ?)",
        (conversation_id, "2026-10-21T00:00:00Z"),
    )
    connection.commit()
    connection.close()
