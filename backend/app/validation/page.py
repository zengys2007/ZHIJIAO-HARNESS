"""结构、路径、大小和安全校验。不改文件来凑合通过。"""

from dataclasses import dataclass
from html.parser import HTMLParser

MAX_FILE_BYTES = 500 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024

MEDIA_BY_SUFFIX = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str]


def validate_page(files: list[dict]) -> ValidationResult:
    errors: list[str] = []
    if not files:
        return ValidationResult(False, ["文件清单是空的。"])

    total = 0
    entries: list[str] = []
    for item in files:
        path = item.get("path")
        if not _safe_path(path):
            errors.append("文件路径必须是相对路径，不能包含空段、反斜杠或 .. 。")
            continue
        if path == "index.html" or path.endswith("/index.html"):
            entries.append(path)
        media_type = item.get("media_type")
        suffix = "." + path.rsplit(".", 1)[-1] if "." in path.rsplit("/", 1)[-1] else ""
        expected = MEDIA_BY_SUFFIX.get(suffix)
        if expected is None or media_type != expected:
            errors.append(f"{path} 的媒体类型不在允许范围内。")
        content = item.get("content")
        if isinstance(content, str):
            try:
                raw = content.encode("utf-8")
            except UnicodeError:
                errors.append(f"{path} 不是 UTF-8。")
                continue
        elif isinstance(content, bytes):
            raw = content
        else:
            errors.append(f"{path} 没有内容。")
            continue
        total += len(raw)
        if len(raw) > MAX_FILE_BYTES:
            errors.append(f"{path} 超过 500 KB。")
        if expected == "text/html" or (expected or "").startswith("text/"):
            try:
                text = raw.decode("utf-8")
            except UnicodeError:
                errors.append(f"{path} 不是 UTF-8。")
                continue
            lowered = text.lower()
            if "http:" in lowered or "https:" in lowered or "<?" in text or "<%" in text:
                errors.append(f"{path} 含有外链资源或要在服务器执行的内容。")
            if _has_protocol_relative_url(text):
                errors.append(f"{path} 含有外链资源或要在服务器执行的内容。")
            if path == "index.html" and not _visible_text(text):
                errors.append("页面没有可显示的正文。")
    if entries != ["index.html"]:
        errors.append("页面必须恰好有一个 index.html。")
    if total > MAX_TOTAL_BYTES:
        errors.append("文件合计超过 2 MB。")
    return ValidationResult(ok=not errors, errors=errors)


def _safe_path(path: object) -> bool:
    if not isinstance(path, str) or path == "" or "\\" in path or path.startswith("/"):
        return False
    parts = path.split("/")
    return all(part not in ("", ".", "..") for part in parts)


def _has_protocol_relative_url(text: str) -> bool:
    parser = _AttrParser()
    parser.feed(text)
    return parser.protocol_relative


def _visible_text(text: str) -> str:
    parser = _VisibleParser()
    parser.feed(text)
    return "".join(parser.parts).strip()


class _AttrParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.protocol_relative = False

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in {"src", "href"} and isinstance(value, str) and value.startswith("//"):
                self.protocol_relative = True


class _VisibleParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._skip = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if self._skip == 0:
            self.parts.append(data)
