"""唯一拼接产物路径的地方。"""

import os
import shutil
from pathlib import Path


class FileStore:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def write_candidate(self, task_id: str, files: list[dict]) -> Path:
        self._check_id(task_id)
        directory = self.root / "tmp" / task_id / "candidate"
        if directory.exists():
            shutil.rmtree(directory)
        directory.mkdir(parents=True)
        for item in files:
            relative = safe_relative(item["path"])
            target = directory / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            content = item["content"]
            if isinstance(content, str):
                target.write_text(content, encoding="utf-8")
            else:
                target.write_bytes(content)
        return directory

    def publish_candidate(self, task_id: str, artifact_id: str, version: int) -> Path:
        self._check_id(task_id)
        self._check_id(artifact_id)
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            raise ValueError("bad version")
        source = self.root / "tmp" / task_id / "candidate"
        destination = self.version_dir(artifact_id, version)
        if not source.is_dir():
            raise FileNotFoundError(source)
        if destination.exists():
            raise FileExistsError(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        os.rename(source, destination)
        return destination

    def version_dir(self, artifact_id: str, version: int) -> Path:
        self._check_id(artifact_id)
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            raise ValueError("bad version")
        return self.root / "artifacts" / artifact_id / str(version)

    def published_file(self, artifact_id: str, version: int, relative_path: str) -> Path:
        root = self.version_dir(artifact_id, version)
        target = (root / safe_relative(relative_path)).resolve()
        if not target.is_relative_to(root.resolve()):
            raise ValueError("unsafe path")
        return target

    def remove_tmp(self, task_id: str) -> None:
        self._check_id(task_id)
        directory = self.root / "tmp" / task_id
        if directory.exists():
            shutil.rmtree(directory)

    def remove_version(self, artifact_id: str, version: int) -> None:
        directory = self.version_dir(artifact_id, version)
        if directory.exists():
            shutil.rmtree(directory)

    def _check_id(self, value: str) -> None:
        if not isinstance(value, str) or not value or any(char not in _ID_CHARS for char in value):
            raise ValueError("unsafe id")


_ID_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")


def safe_relative(relative: str) -> Path:
    if not isinstance(relative, str) or relative == "" or "\\" in relative or relative.startswith("/"):
        raise ValueError("unsafe path")
    parts = relative.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("unsafe path")
    return Path(*parts)
