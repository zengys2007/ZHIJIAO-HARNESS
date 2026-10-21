import pytest

from app.api.errors import error_body
from app.artifacts.contract import CAPABILITIES, ARTIFACT_TYPE, artifact_view
from app.config import load_settings
from app.tasks.states import FAILED, PENDING, RUNNING, SUCCEEDED, transition


def test_task_status_allows_only_the_documented_transitions():
    assert transition(PENDING, RUNNING) == RUNNING
    assert transition(RUNNING, SUCCEEDED) == SUCCEEDED
    assert transition(RUNNING, FAILED) == FAILED
    assert transition(PENDING, FAILED) == FAILED


@pytest.mark.parametrize(
    ("current", "new"),
    [
        (PENDING, SUCCEEDED),
        (RUNNING, PENDING),
        (SUCCEEDED, FAILED),
        (SUCCEEDED, RUNNING),
        (FAILED, RUNNING),
        (FAILED, PENDING),
    ],
)
def test_task_status_rejects_other_transitions(current, new):
    with pytest.raises(ValueError):
        transition(current, new)


def test_error_body_uses_one_shape_and_known_retry_flags():
    refused = error_body("invalid_input")
    retryable = error_body("model_timeout")

    assert set(refused) == {"code", "message", "retryable"}
    assert refused == {
        "code": "invalid_input",
        "message": "请把这句话写成 1 到 4000 字后再发送。",
        "retryable": False,
    }
    assert retryable["code"] == "model_timeout"
    assert retryable["retryable"] is True
    assert "\\" not in retryable["message"]


@pytest.mark.parametrize(
    ("code", "retryable"),
    [
        ("invalid_input", False),
        ("not_found", False),
        ("conflict", False),
        ("step_limit", True),
        ("model_timeout", True),
        ("model_invalid_output", True),
        ("model_upstream", True),
        ("interrupted", True),
        ("storage_failed", True),
        ("internal", True),
    ],
)
def test_every_error_code_is_defined_once(code, retryable):
    body = error_body(code)
    assert body["code"] == code
    assert body["retryable"] is retryable
    assert body["message"]


def test_unknown_error_code_is_rejected():
    with pytest.raises(KeyError):
        error_body("parsing")


def test_artifact_view_uses_the_single_contract():
    view = artifact_view(
        artifact_id="art-1",
        title="课堂页面",
        version=1,
        tool_name="write_page",
        preset=None,
        files=[{"path": "index.html", "media_type": "text/html", "role": "entry"}],
        metadata={"task_id": "task-1", "title": "课堂页面"},
    )

    assert view["artifact_type"] == ARTIFACT_TYPE == "interactive-page"
    assert view["capabilities"] == CAPABILITIES == ["preview", "revise", "export"]
    assert view["version"] == 1
    assert view["preset"] is None
    assert "names" not in view
    assert "task_id" in view["metadata"]


def test_settings_read_data_dir_from_the_environment(monkeypatch, tmp_path):
    _llm_env(monkeypatch)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    settings = load_settings()

    assert settings.data_dir == tmp_path.resolve()
    assert settings.llm_model == "fake"


def test_settings_default_data_dir_is_data(monkeypatch, tmp_path):
    _llm_env(monkeypatch)
    monkeypatch.delenv("DATA_DIR", raising=False)
    monkeypatch.chdir(tmp_path)

    settings = load_settings()

    assert settings.data_dir == (tmp_path / "data").resolve()


def test_settings_refuse_to_start_without_a_model_key(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("LLM_MODEL", "fake")
    with pytest.raises(RuntimeError):
        load_settings()


def _llm_env(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "fake")
