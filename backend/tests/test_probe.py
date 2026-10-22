from fastapi.testclient import TestClient

from app.config import Settings
from app.llm.protocol import AssistantMessage
from app.main import create_app


def test_local_probe_reads_process_environment_not_the_dotenv_file(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "LLM_BASE_URL=http://file.test/v1\nLLM_API_KEY=file-key\nLLM_MODEL=file-model\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LLM_BASE_URL", "http://env.test/v1")
    monkeypatch.setenv("LLM_API_KEY", "env-key")
    monkeypatch.setenv("LLM_MODEL", "env-model")
    seen = {}

    def probe(base_url, api_key, model, timeout):
        seen.update(base_url=base_url, api_key=api_key, model=model)
        return True

    client = TestClient(create_app(Settings(data_dir=tmp_path), complete=_ok, probe=probe, env_file=env_file))
    response = client.post("/api/llm/probe", json={"source": "local"})
    assert response.status_code == 200
    assert response.json() == {"reachable": True}
    assert seen == {"base_url": "http://env.test/v1", "api_key": "env-key", "model": "env-model"}
    assert "env-key" not in response.text
    assert "file-key" not in response.text


def test_dotenv_probe_reads_the_file_and_keeps_a_blank_key_from_the_file(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "LLM_BASE_URL=http://file.test/v1\nLLM_API_KEY=file-key\nLLM_MODEL=file-model\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LLM_BASE_URL", "http://env.test/v1")
    monkeypatch.setenv("LLM_API_KEY", "env-key")
    monkeypatch.setenv("LLM_MODEL", "env-model")
    calls = []

    def probe(base_url, api_key, model, timeout):
        calls.append((base_url, api_key, model))
        return True

    client = TestClient(create_app(Settings(data_dir=tmp_path), complete=_ok, probe=probe, env_file=env_file))
    edited = client.post(
        "/api/llm/probe",
        json={"source": "dotenv", "base_url": "https://example.com/v1", "model": "other"},
    )
    untouched = client.post("/api/llm/probe", json={"source": "dotenv"})
    assert edited.json() == {"reachable": True}
    assert untouched.json() == {"reachable": True}
    assert calls == [
        ("https://example.com/v1", "file-key", "other"),
        ("http://file.test/v1", "file-key", "file-model"),
    ]
    assert "file-key" not in edited.text


def test_llm_config_hides_keys(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("LLM_BASE_URL=http://file.test/v1\nLLM_API_KEY=file-key\nLLM_MODEL=file-model\n", encoding="utf-8")
    monkeypatch.setenv("LLM_BASE_URL", "http://env.test/v1")
    monkeypatch.setenv("LLM_API_KEY", "env-key")
    monkeypatch.setenv("LLM_MODEL", "env-model")
    client = TestClient(create_app(Settings(data_dir=tmp_path), complete=_ok, probe=lambda *args: True, env_file=env_file))
    body = client.get("/api/llm/config").json()
    assert body == {
        "environment": {"base_url": "http://env.test/v1", "model": "env-model", "has_api_key": True},
        "dotenv": {"base_url": "http://file.test/v1", "model": "file-model", "has_api_key": True},
    }
    assert "env-key" not in client.get("/api/llm/config").text
    assert "file-key" not in client.get("/api/llm/config").text


def test_local_probe_ignores_values_copied_from_the_dotenv_file(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "LLM_BASE_URL=http://file.test/v1\nLLM_API_KEY=file-key\nLLM_MODEL=file-model\n",
        encoding="utf-8",
    )
    for name in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"):
        monkeypatch.delenv(name, raising=False)
    from app.config import load_env_file

    load_env_file(env_file)
    called = False

    def probe(base_url, api_key, model, timeout):
        nonlocal called
        called = True
        return True

    client = TestClient(create_app(Settings(data_dir=tmp_path), complete=_ok, probe=probe, env_file=env_file))
    response = client.post("/api/llm/probe", json={"source": "local"})
    config = client.get("/api/llm/config").json()
    assert response.json() == {"reachable": False}
    assert called is False
    assert config["environment"] == {"base_url": "", "model": "", "has_api_key": False}
    assert config["dotenv"]["has_api_key"] is True


def test_probe_rejects_extra_fields(tmp_path):
    client = TestClient(create_app(Settings(data_dir=tmp_path), complete=_ok, probe=lambda *args: True, env_file=tmp_path / "missing.env"))
    response = client.post("/api/llm/probe", json={"source": "local", "extra": 1})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_input"


def _ok(messages, tools):
    return AssistantMessage(content="好", tool_calls=[])
