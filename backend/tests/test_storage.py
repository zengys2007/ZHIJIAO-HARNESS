import pytest

from app.artifacts.publish import PublishError, publish_candidate
from app.storage.files import FileStore
from app.storage.repository import InputError, SqliteRepository
from app.tasks.states import FAILED, PENDING, RUNNING, SUCCEEDED


def test_new_task_is_pending_and_round_trips(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    task = repo.create_task("做一个页面", None)

    assert task.status == PENDING
    assert task.step_count == 0
    assert task.artifact_id is None
    loaded = repo.get_task(task.id)
    assert loaded.raw_request == "做一个页面"
    assert loaded.preset_hint is None
    assert repo.get_task("missing") is None


@pytest.mark.parametrize(
    ("raw_request", "preset_hint"),
    [
        ("", None),
        ("   ", None),
        ("点" * 4001, None),
        ("做一个页面", "roll-call"),
        ("做一个页面", "timer"),
        ("做一个页面", "poll"),
        ("做一个页面", "spinner"),
    ],
)
def test_new_task_rejects_illegal_input(tmp_path, raw_request, preset_hint):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    with pytest.raises(InputError):
        repo.create_task(raw_request, preset_hint)


def test_status_transition_is_persisted_and_guarded(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    task = repo.create_task("随机点名", None)
    repo.transition(task.id, RUNNING, step_count=2)

    updated = repo.get_task(task.id)
    assert updated.status == RUNNING
    assert updated.step_count == 2
    with pytest.raises(ValueError):
        repo.transition(task.id, PENDING)


def test_events_append_in_order_and_reject_unknown_types(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    task = repo.create_task("随机点名", None)
    first = repo.append_event(task.id, "user_message", {"content": "随机点名"})
    second = repo.append_event(
        task.id,
        "tool_result",
        {"name": "page_fixture", "content": "校验通过，本轮结束且没有新的工具调用时会发布"},
    )

    events = repo.list_events(task.id)
    assert [event.type for event in events] == ["user_message", "tool_result"]
    assert [event.seq for event in events] == [1, 2]
    assert first.payload["content"] == "随机点名"
    assert repo.last_event(task.id).type == "tool_result"
    with pytest.raises(ValueError):
        repo.append_event(task.id, "planning", {})


def test_candidate_files_stay_under_the_data_root(tmp_path):
    store = FileStore(tmp_path)
    directory = store.write_candidate(
        "task-1",
        [{"path": "index.html", "content": "<p>林晓</p>"}],
    )

    assert directory == (tmp_path / "tmp" / "task-1" / "candidate").resolve()
    assert (directory / "index.html").read_text(encoding="utf-8") == "<p>林晓</p>"


@pytest.mark.parametrize(
    ("task_id", "relative_path"),
    [
        ("task-1", "../index.html"),
        ("task-1", "css\\app.css"),
        ("task-1", "/index.html"),
        ("task-1", "a/../index.html"),
        ("../task", "index.html"),
        ("task-1", ""),
    ],
)
def test_file_store_rejects_unsafe_paths(tmp_path, task_id, relative_path):
    store = FileStore(tmp_path)
    with pytest.raises(ValueError):
        store.write_candidate(task_id, [{"path": relative_path, "content": "x"}])


def test_publish_moves_candidate_into_the_version_directory(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    store = FileStore(tmp_path)
    task = repo.create_task("做一个页面", None)
    repo.transition(task.id, RUNNING)
    store.write_candidate(task.id, [{"path": "index.html", "content": "<p>林晓</p>"}])

    published = publish_candidate(
        repo,
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

    saved = repo.get_task(task.id)
    version_file = tmp_path / "artifacts" / published.artifact_id / "1" / "index.html"
    view = repo.artifact_view(published.artifact_id)
    assert published.version == 1
    assert saved.status == SUCCEEDED
    assert saved.artifact_id == published.artifact_id
    assert saved.version == 1
    assert version_file.read_text(encoding="utf-8") == "<p>林晓</p>"
    assert not (tmp_path / "tmp" / task.id / "candidate").exists()
    assert view["tool_name"] == "page_fixture"
    assert view["preset"] is None
    assert view["files"][0]["role"] == "entry"
    assert "names" not in view
    assert repo.last_event(task.id).type == "artifact_published"
    stored = repo.get_version(published.artifact_id, 1)
    assert stored.arguments["title"] == "课堂页面"


def test_publish_from_a_non_running_task_writes_nothing(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    store = FileStore(tmp_path)
    task = repo.create_task("随机点名", None)
    store.write_candidate(task.id, [{"path": "index.html", "content": "<p>林晓</p>"}])

    with pytest.raises(PublishError):
        publish_candidate(
            repo,
            store,
            task_id=task.id,
            candidate=_candidate(),
        )

    assert repo.get_task(task.id).status == PENDING
    assert list((tmp_path / "artifacts").glob("*")) == []


def test_failed_file_move_rolls_back_the_version_row(tmp_path, monkeypatch):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    store = FileStore(tmp_path)
    task = repo.create_task("随机点名", None)
    repo.transition(task.id, RUNNING)
    store.write_candidate(task.id, [{"path": "index.html", "content": "<p>林晓</p>"}])

    def explode(*_args, **_kwargs):
        raise OSError("disk")

    monkeypatch.setattr(store, "publish_candidate", explode)

    with pytest.raises(OSError):
        publish_candidate(repo, store, task_id=task.id, candidate=_candidate())

    assert repo.get_task(task.id).status == RUNNING
    assert repo.artifact_view("missing") is None
    assert list(tmp_path.glob("artifacts/**/*")) == []


def test_remove_tmp_discards_a_failed_round(tmp_path):
    store = FileStore(tmp_path)
    store.write_candidate("task-1", [{"path": "index.html", "content": "x"}])
    store.remove_tmp("task-1")
    assert not (tmp_path / "tmp" / "task-1").exists()


def test_terminal_failure_records_error_without_a_version(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    task = repo.create_task("随机点名", None)
    repo.transition(task.id, RUNNING)
    repo.transition(task.id, FAILED, error_code="no_artifact", error_message="这次没有生成可预览的页面，可以换种说法再试。")

    saved = repo.get_task(task.id)
    assert saved.status == FAILED
    assert saved.error_code == "no_artifact"
    assert saved.artifact_id is None


def _candidate():
    return {
        "title": "课堂页面",
        "tool_name": "page_fixture",
        "preset": None,
        "files": [{"path": "index.html", "media_type": "text/html", "role": "entry"}],
        "arguments": {"title": "课堂页面"},
    }
