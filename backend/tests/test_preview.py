from pathlib import Path

from fastapi.testclient import TestClient

from app.artifacts.publish import publish_candidate
from app.config import Settings
from app.main import create_app
from app.preview.serve import load_preview
from app.storage.files import FileStore
from app.storage.repository import Repository
from app.tasks.states import RUNNING
from tests.support import PLAIN_PAGE

CSP = (
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
    "img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"
)


def test_published_preview_is_isolated_from_the_workbench(tmp_path):
    published = _publish_plain_page(tmp_path)
    client = TestClient(create_app(Settings(data_dir=tmp_path), complete=_idle_complete))

    preview = client.get(f"/api/artifacts/{published.artifact_id}/versions/1/preview/")
    shell = client.get(f"/?artifact_id={published.artifact_id}&version=1")
    missing = client.get("/api/artifacts/missingid/versions/1/preview/")
    routes = {
        (method, route.path)
        for route in client.app.routes
        if hasattr(route, "methods")
        for method in route.methods
    }

    assert preview.status_code == 200
    assert preview.headers["content-security-policy"] == CSP
    assert preview.headers["x-content-type-options"] == "nosniff"
    assert preview.headers["content-type"].startswith("text/html")
    assert "课堂页面" in preview.text
    assert "发送" in shell.text
    assert "课堂页面" not in shell.text
    assert "allow-same-origin" not in shell.text
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"
    assert ("POST", "/api/tasks") not in routes


def test_preview_rejects_an_unsafe_path(tmp_path):
    published = _publish_plain_page(tmp_path)
    result = load_preview(FileStore(tmp_path), published.artifact_id, 1, "../app.sqlite")

    assert result.status == 404


def test_web_framework_and_sqlite_stay_in_their_modules():
    root = Path(__file__).resolve().parents[1] / "app"
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8").lower()
        if path.name != "main.py":
            assert "fastapi" not in text
            assert "starlette" not in text
            assert "uvicorn" not in text
        if "storage" not in path.parts:
            assert "sqlite3" not in text
    build = (root / "graph" / "build.py").read_text(encoding="utf-8")
    assert "RetryPolicy" not in build
    assert "create_react_agent" not in build
    assert "ToolNode" not in build
    assert "checkpointer" not in build


def _idle_complete(messages, tools):
    from app.llm.protocol import AssistantMessage

    return AssistantMessage(content="好", tool_calls=[])


def _publish_plain_page(tmp_path):
    repository = Repository(tmp_path / "app.sqlite")
    store = FileStore(tmp_path)
    task = repository.create_task("做一个页面", None)
    repository.transition(task.id, RUNNING)
    store.write_candidate(task.id, [{"path": "index.html", "content": PLAIN_PAGE}])
    return publish_candidate(
        repository,
        store,
        task_id=task.id,
        candidate={
            "title": "课堂页面",
            "tool_name": "page_fixture",
            "preset": None,
            "files": [{"path": "index.html", "media_type": "text/html", "role": "entry"}],
            "arguments": {"title": "课堂页面"},
        },
    )
