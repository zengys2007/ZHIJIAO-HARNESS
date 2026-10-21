"""按已发布版本读文件。"""

from dataclasses import dataclass

from app.preview.headers import PREVIEW_HEADERS
from app.storage.files import FileStore
from app.validation.page import MEDIA_BY_SUFFIX


@dataclass
class PreviewResult:
    status: int
    body: bytes
    headers: dict


def load_preview(store: FileStore, artifact_id: str, version: int, relative_path: str) -> PreviewResult:
    relative = relative_path or "index.html"
    try:
        path = store.published_file(artifact_id, version, relative)
    except (ValueError, OSError):
        return PreviewResult(404, b"", {})
    if not path.is_file():
        return PreviewResult(404, b"", {})
    media_type = MEDIA_BY_SUFFIX.get(path.suffix.lower())
    if media_type is None:
        return PreviewResult(404, b"", {})
    headers = dict(PREVIEW_HEADERS)
    if media_type == "text/html":
        headers["Content-Type"] = "text/html; charset=utf-8"
    elif media_type.startswith("text/"):
        headers["Content-Type"] = f"{media_type}; charset=utf-8"
    else:
        headers["Content-Type"] = media_type
    return PreviewResult(200, path.read_bytes(), headers)
