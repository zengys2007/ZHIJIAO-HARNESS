"""知识库 HTTP 接口。"""

import os
import urllib.request

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, default_env_path
from app.llm.protocol import AssistantMessage
from app.main import create_app

SECRET = "test-secret-value"
PASSWORD = "correct-horse"
ENV_TEXT = "LLM_BASE_URL=http://127.0.0.1:9\nLLM_API_KEY=test-key\nLLM_MODEL=test-model\n"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _blocked_urlopen(*_args, **_kwargs):
    raise AssertionError("embeddings endpoint must not be called")


@pytest.fixture(autouse=True)
def _no_embedding_network(monkeypatch):
    monkeypatch.delenv("LLM_EMBEDDING_MODEL", raising=False)
    monkeypatch.setattr(urllib.request, "urlopen", _blocked_urlopen)


def _write_env(tmp_path, extra=""):
    env_file = tmp_path / ".env"
    env_file.write_text(ENV_TEXT + extra, encoding="utf-8")
    return env_file


def _app(tmp_path, jobs, env_file):
    return create_app(
        Settings(data_dir=tmp_path, auth_secret=SECRET),
        complete=_ok,
        env_file=env_file,
        schedule=jobs.append,
    )


def _register(client, username, display_name):
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": PASSWORD, "display_name": display_name},
    )
    assert response.status_code == 201
    return response


def _two_teachers(tmp_path, jobs, env_file=None):
    if env_file is None:
        env_file = _write_env(tmp_path)
    app = _app(tmp_path, jobs, env_file)
    alice = TestClient(app)
    bob = TestClient(app)
    _register(alice, "alice", "甲老师")
    _register(bob, "bob", "乙老师")
    return app, alice, bob


def _ok(messages, tools, sink=None):
    return AssistantMessage(content="好", tool_calls=[])


def test_knowledge_documents_require_login(tmp_path):
    jobs = []
    client = TestClient(_app(tmp_path, jobs, _write_env(tmp_path)))

    response = client.get("/api/knowledge/documents")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"
    assert jobs == []


def test_paste_is_hidden_from_the_other_teacher(tmp_path):
    jobs = []
    _app_obj, alice, bob = _two_teachers(tmp_path, jobs)

    created = alice.post(
        "/api/knowledge/documents",
        json={"title": "课堂笔记", "content": "分数先通分再比较。"},
    )
    assert created.status_code == 201
    document = created.json()
    assert document["title"] == "课堂笔记"
    assert document["source"] == "paste"
    assert set(document) == {
        "document_id",
        "title",
        "source",
        "filename",
        "extension",
        "status",
        "message",
        "created_at",
    }

    bob_list = bob.get("/api/knowledge/documents")
    assert bob_list.status_code == 200
    assert bob_list.json()["documents"] == []

    missing = bob.delete(f"/api/knowledge/documents/{document['document_id']}")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"

    alice_list = alice.get("/api/knowledge/documents").json()
    assert [item["document_id"] for item in alice_list["documents"]] == [document["document_id"]]
    assert "embedding_model" in alice_list

    extra = alice.post(
        "/api/knowledge/documents",
        json={"title": "课堂笔记", "content": "正文", "note": "多余"},
    )
    assert extra.status_code == 400
    assert extra.json()["error"]["code"] == "invalid_input"
    assert len(alice.get("/api/knowledge/documents").json()["documents"]) == 1
    assert jobs == []


def test_unknown_extension_is_rejected_and_not_listed(tmp_path):
    jobs = []
    _app_obj, alice, _bob = _two_teachers(tmp_path, jobs)

    rejected = alice.post(
        "/api/knowledge/documents",
        files={"file": ("notes.exe", b"MZ", "application/octet-stream")},
    )
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "invalid_input"
    assert rejected.json()["error"]["message"] == "扩展名不在登记表里。"
    assert alice.get("/api/knowledge/documents").json()["documents"] == []
    assert not (_app_obj.state.files.root / "knowledge").exists()
    assert jobs == []


def test_upload_over_10mb_is_rejected(tmp_path):
    jobs = []
    _app_obj, alice, _bob = _two_teachers(tmp_path, jobs)

    rejected = alice.post(
        "/api/knowledge/documents",
        files={"file": ("notes.txt", b"x" * (MAX_UPLOAD_BYTES + 1), "text/plain")},
    )

    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "invalid_input"
    assert rejected.json()["error"]["message"] == "文件不能超过 10 MB。"
    assert alice.get("/api/knowledge/documents").json()["documents"] == []
    assert jobs == []


def test_owner_delete_removes_file_and_clears_the_list(tmp_path):
    jobs = []
    app, alice, _bob = _two_teachers(tmp_path, jobs)
    payload = "课堂原文".encode()

    created = alice.post(
        "/api/knowledge/documents",
        data={"title": "课堂原文"},
        files={"file": ("notes.txt", payload, "text/plain")},
    )
    assert created.status_code == 201
    assert created.json()["title"] == "课堂原文"
    assert created.json()["filename"] == "notes.txt"
    assert created.json()["extension"] == ".txt"
    document_id = created.json()["document_id"]
    stored = list(app.state.files.root.joinpath("knowledge").rglob("original"))
    assert stored == [app.state.files.root / "knowledge" / stored[0].parent.parent.name / document_id / "original"]
    assert stored[0].read_bytes() == payload

    deleted = alice.delete(f"/api/knowledge/documents/{document_id}")
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert alice.get("/api/knowledge/documents").json()["documents"] == []
    assert not stored[0].exists()
    assert jobs == []


def test_embedding_model_is_written_to_the_env_file(tmp_path):
    jobs = []
    env_file = _write_env(tmp_path)
    _app_obj, alice, _bob = _two_teachers(tmp_path, jobs, env_file)

    saved = alice.put("/api/knowledge/embedding-model", json={"model": "embed-small"})
    assert saved.status_code == 200
    assert saved.json() == {"embedding_model": "embed-small"}
    lines = env_file.read_text(encoding="utf-8").splitlines()
    assert "LLM_BASE_URL=http://127.0.0.1:9" in lines
    assert "LLM_API_KEY=test-key" in lines
    assert "LLM_MODEL=test-model" in lines
    assert "LLM_EMBEDDING_MODEL=embed-small" in lines
    assert os.environ["LLM_EMBEDDING_MODEL"] == "embed-small"
    assert "test-key" not in saved.text

    rejected = alice.put("/api/knowledge/embedding-model", json={"model": "embed small"})
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "invalid_input"
    assert "LLM_EMBEDDING_MODEL=embed-small" in env_file.read_text(encoding="utf-8").splitlines()

    extra = alice.put("/api/knowledge/embedding-model", json={"model": "embed-small", "api_key": "secret"})
    assert extra.status_code == 400
    assert "secret" not in env_file.read_text(encoding="utf-8")

    too_long = alice.put("/api/knowledge/embedding-model", json={"model": "m" * 201})
    not_text = alice.put("/api/knowledge/embedding-model", json={"model": 1})
    assert too_long.status_code == 400
    assert not_text.status_code == 400
    assert "LLM_EMBEDDING_MODEL=embed-small" in env_file.read_text(encoding="utf-8").splitlines()

    cleared = alice.put("/api/knowledge/embedding-model", json={"model": ""})
    assert cleared.status_code == 200
    assert cleared.json() == {"embedding_model": ""}
    assert "LLM_EMBEDDING_MODEL=" in env_file.read_text(encoding="utf-8").splitlines()
    assert jobs == []


def test_missing_env_file_rejects_embedding_model(tmp_path):
    jobs = []
    missing = tmp_path / ".env"
    client = TestClient(_app(tmp_path, jobs, missing))
    _register(client, "alice", "甲老师")

    response = client.put("/api/knowledge/embedding-model", json={"model": "embed-small"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_input"
    assert missing.exists() is False
    assert jobs == []


def test_embed_without_chunks_is_rejected(tmp_path):
    jobs = []
    _app_obj, alice, _bob = _two_teachers(tmp_path, jobs)

    created = alice.post(
        "/api/knowledge/documents",
        files={"file": ("blank.txt", b"  \n", "text/plain")},
    )
    assert created.status_code == 201
    assert created.json()["status"] == "failed"
    document_id = created.json()["document_id"]

    rejected = alice.post(f"/api/knowledge/documents/{document_id}/embed")
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "invalid_input"
    assert "重新上传或粘贴" in rejected.json()["error"]["message"]
    assert alice.get("/api/knowledge/documents").json()["documents"][0]["status"] == "failed"
    assert jobs == []


def test_embed_returns_pending_and_schedules_without_network(tmp_path, monkeypatch):
    jobs = []
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-unit")
    _app_obj, alice, bob = _two_teachers(tmp_path, jobs)

    created = alice.post(
        "/api/knowledge/documents",
        json={"title": "课堂笔记", "content": "分数先通分再比较。"},
    )
    assert created.status_code == 201
    document_id = created.json()["document_id"]
    assert len(jobs) == 1
    assert callable(jobs[0])

    accepted = alice.post(f"/api/knowledge/documents/{document_id}/embed")
    assert accepted.status_code == 202
    body = accepted.json()
    assert body["document_id"] == document_id
    assert body["status"] == "pending"
    assert len(jobs) == 2
    assert all(callable(job) for job in jobs)

    foreign = bob.post(f"/api/knowledge/documents/{document_id}/embed")
    assert foreign.status_code == 404
    assert len(jobs) == 2

    malformed = alice.post("/api/knowledge/documents/not-an-id/embed")
    assert malformed.status_code == 404
    assert len(jobs) == 2


def test_llm_config_includes_embedding_model(tmp_path, monkeypatch):
    jobs = []
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-env")
    env_file = _write_env(tmp_path, "LLM_EMBEDDING_MODEL=embed-file\n")
    _app_obj, alice, _bob = _two_teachers(tmp_path, jobs, env_file)

    response = alice.get("/api/llm/config")
    assert response.status_code == 200
    body = response.json()
    assert body["environment"]["embedding_model"] == "embed-env"
    assert body["dotenv"]["embedding_model"] == "embed-file"
    assert "test-key" not in response.text
    assert "embed-env" in response.text
    assert jobs == []


def test_create_app_stores_env_file_or_the_default(tmp_path):
    env_file = _write_env(tmp_path)
    app = create_app(
        Settings(data_dir=tmp_path, auth_secret=SECRET),
        complete=_ok,
        env_file=env_file,
    )
    assert app.state.env_file == env_file

    defaulted = create_app(
        Settings(data_dir=tmp_path / "other", auth_secret=SECRET),
        complete=_ok,
    )
    assert defaulted.state.env_file == default_env_path()
