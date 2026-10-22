"""版本事务。只由执行器调用。"""

from dataclasses import dataclass
from uuid import uuid4

from app.storage.files import FileStore
from app.storage.protocol import Repository
from app.tasks.states import RUNNING, SUCCEEDED


class PublishError(RuntimeError):
    pass


@dataclass(frozen=True)
class Published:
    artifact_id: str
    version: int


def publish_candidate(repo: Repository, store: FileStore, *, task_id: str, candidate: dict) -> Published:
    task = repo.get_task(task_id)
    if task is None or task.status != RUNNING:
        raise PublishError("只有进行中的任务可以发布")
    proposed = candidate.get("artifact_id")
    if proposed:
        store.version_dir(proposed, 1)
        artifact_id = proposed
    else:
        artifact_id = uuid4().hex
    version = 1
    metadata = {"task_id": task_id, "title": candidate["title"]}
    moved = False
    try:
        with repo.transaction():
            repo.insert_published_version(
                artifact_id=artifact_id,
                version=version,
                task_id=task_id,
                title=candidate["title"],
                tool_name=candidate["tool_name"],
                preset=candidate["preset"],
                files=candidate["files"],
                metadata=metadata,
                arguments=candidate["arguments"],
            )
            store.publish_candidate(task_id, artifact_id, version)
            moved = True
            repo.transition(task_id, SUCCEEDED, artifact_id=artifact_id, version=version)
            repo.append_event(
                task_id,
                "artifact_published",
                {"artifact_id": artifact_id, "version": version},
            )
    except Exception:
        if moved:
            store.remove_version(artifact_id, version)
        raise
    return Published(artifact_id=artifact_id, version=version)
