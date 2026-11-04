"""知识库请求的字段校验。不引用 Web 框架。"""

import re

from app.api.messages import RequestError
from app.knowledge.extract import EXTRACTORS
from app.knowledge.service import EXTENSION_MESSAGE, FILENAME_MESSAGE, MAX_UPLOAD_BYTES, SIZE_MESSAGE

UNKNOWN_FIELD_MESSAGE = "请求里有不能识别的字段。"
MODEL_MESSAGE = "模型名留空表示清空；填写时写成 1 到 200 个不含空白的字符。"
ENV_FILE_MESSAGE = "请先准备 .env 文件。"
NO_CHUNKS_MESSAGE = "这份资料没有抽出文字，请重新上传或粘贴。"
NOT_FOUND_MESSAGE = "没有找到这份资料。"

_HEX_ID = re.compile(r"^[0-9a-f]{32}$")
_NAME = re.compile(r'(?:^|;)\s*name="([^"]*)"')
_FILENAME = re.compile(r'(?:^|;)\s*filename="([^"]*)"')
_MAX_FIELD_BYTES = 4096
_MAX_HEADER_BYTES = 8192


def parse_paste(body: object) -> tuple[str, str]:
    if not isinstance(body, dict) or set(body) != {"title", "content"}:
        raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
    title = body["title"]
    content = body["content"]
    if not isinstance(title, str) or not isinstance(content, str):
        raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
    return title, content


def parse_embedding_model(body: object) -> str:
    if not isinstance(body, dict) or set(body) != {"model"}:
        raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
    model = body["model"]
    if not isinstance(model, str):
        raise RequestError("model", public_message=MODEL_MESSAGE)
    if model == "":
        return ""
    if not 1 <= len(model) <= 200 or any(char.isspace() for char in model):
        raise RequestError("model", public_message=MODEL_MESSAGE)
    return model


def valid_document_id(value: object) -> bool:
    return isinstance(value, str) and _HEX_ID.fullmatch(value) is not None


def document_payload(document, status: str, message: str) -> dict:
    return {
        "document_id": document.id,
        "title": document.title,
        "source": document.source,
        "filename": document.filename,
        "extension": document.extension,
        "status": status,
        "message": message,
        "created_at": document.created_at,
    }


class UploadReader:
    """从 multipart 正文取出 file，并在扩展名或体积不合法时停止继续读取。"""

    def __init__(self, content_type: str, max_bytes: int = MAX_UPLOAD_BYTES):
        self._boundary = _boundary(content_type)
        self._marker = b"\r\n--" + self._boundary
        self._max_bytes = max_bytes
        self._buf = bytearray()
        self._mode = "seek"
        self._kind = ""
        self._seen: set[str] = set()
        self._title = bytearray()
        self.file = bytearray()
        self.filename = ""
        self.halt = False
        self.done = False
        self.bad = False
        self.too_large = False
        self.extension_rejected = False
        self.filename_missing = False
        self.saw_file = False

    def feed(self, chunk: bytes) -> None:
        if self.halt or not chunk:
            return
        ceiling = self._max_bytes + _MAX_HEADER_BYTES
        room = ceiling - len(self._buf)
        if room <= 0:
            self.too_large = True
            self.halt = True
            return
        if len(chunk) > room:
            self._buf.extend(chunk[:room])
            self._drain()
            if not self.halt:
                self.too_large = True
                self.halt = True
            return
        self._buf.extend(chunk)
        self._drain()

    def finish(self) -> tuple[str, bytes, str | None]:
        if not self.halt:
            self._drain()
        if self.extension_rejected:
            raise RequestError("extension", public_message=EXTENSION_MESSAGE)
        if self.too_large:
            raise RequestError("size", public_message=SIZE_MESSAGE)
        if self.filename_missing:
            raise RequestError("filename", public_message=FILENAME_MESSAGE)
        if self.bad or not self.done or not self.saw_file:
            raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
        title = None
        if "title" in self._seen:
            try:
                title = self._title.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise RequestError("title", public_message=UNKNOWN_FIELD_MESSAGE) from exc
        return self.filename, bytes(self.file), title

    def _drain(self) -> None:
        while not self.halt:
            if self._mode == "seek":
                if not self._seek_boundary():
                    return
            elif self._mode == "headers":
                if not self._read_headers():
                    return
            else:
                if not self._read_body():
                    return

    def _seek_boundary(self) -> bool:
        token = b"--" + self._boundary
        index = self._buf.find(token)
        if index < 0:
            if len(self._buf) > _MAX_HEADER_BYTES:
                self.bad = True
                self.halt = True
            return False
        after = index + len(token)
        if len(self._buf) < after + 2:
            return False
        mark = self._buf[after : after + 2]
        if mark == b"--":
            self.done = True
            self.halt = True
            return False
        if mark != b"\r\n":
            self.bad = True
            self.halt = True
            return False
        del self._buf[: after + 2]
        self._mode = "headers"
        return True

    def _read_headers(self) -> bool:
        separator = self._buf.find(b"\r\n\r\n")
        if separator < 0:
            if len(self._buf) > _MAX_HEADER_BYTES:
                self.bad = True
                self.halt = True
            return False
        raw = bytes(self._buf[:separator])
        del self._buf[: separator + 4]
        self._open_part(raw)
        if self.halt:
            return False
        self._mode = "body"
        return True

    def _read_body(self) -> bool:
        index = self._buf.find(self._marker)
        if index < 0:
            keep = len(self._marker) - 1
            if len(self._buf) <= keep:
                return False
            ready = bytes(self._buf[:-keep])
            del self._buf[:-keep]
            self._take_body(ready)
            return False
        self._take_body(bytes(self._buf[:index]))
        if self.halt:
            return False
        del self._buf[: index + 2]
        self._mode = "seek"
        return True

    def _open_part(self, raw: bytes) -> None:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            self.bad = True
            self.halt = True
            return
        disposition = ""
        for line in text.split("\r\n"):
            if line.lower().startswith("content-disposition:"):
                disposition = line.split(":", 1)[1].strip()
                break
        name, filename = _content_disposition(disposition)
        if name not in {"file", "title"} or name in self._seen:
            self.bad = True
            self.halt = True
            return
        self._seen.add(name)
        if name == "title":
            self._kind = "title"
            return
        if filename is None or _basename(filename) in {"", ".", ".."}:
            self.filename_missing = True
            self.halt = True
            return
        self._kind = "file"
        self.saw_file = True
        self.filename = filename
        if _extension(filename) not in EXTRACTORS:
            self.extension_rejected = True
            self.halt = True

    def _take_body(self, data: bytes) -> None:
        if not data:
            return
        if self._kind == "title":
            if len(self._title) + len(data) > _MAX_FIELD_BYTES:
                self.bad = True
                self.halt = True
                return
            self._title.extend(data)
            return
        if len(self.file) + len(data) > self._max_bytes:
            self.too_large = True
            self.halt = True
            return
        self.file.extend(data)


def _boundary(content_type: str) -> bytes:
    pieces = content_type.split(";", 1)
    if not pieces[0].strip().lower().startswith("multipart/form-data") or len(pieces) == 1:
        raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
    for piece in pieces[1].split(";"):
        item = piece.strip()
        if not item.lower().startswith("boundary="):
            continue
        token = item.split("=", 1)[1].strip()
        if len(token) >= 2 and token[0] == token[-1] and token[0] in {'"', "'"}:
            token = token[1:-1]
        if token and token.isascii() and not any(char.isspace() for char in token):
            return token.encode("ascii")
    raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)


def _content_disposition(value: str) -> tuple[str, str | None]:
    name_match = _NAME.search(value)
    if name_match is None:
        return "", None
    file_match = _FILENAME.search(value)
    filename = _unescape(file_match.group(1)) if file_match else None
    return _unescape(name_match.group(1)), filename


def _unescape(value: str) -> str:
    return value.replace("\\\\", "\\").replace("%22", '"')


def _basename(filename: str) -> str:
    return filename.replace("\\", "/").rsplit("/", 1)[-1].strip()


def _extension(filename: str) -> str:
    base = _basename(filename)
    dot = base.rfind(".")
    if dot <= 0 or dot == len(base) - 1:
        return ""
    return base[dot:].lower()
