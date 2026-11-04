"""保存知识资料，并在返回后于后台生成嵌入。"""

import inspect
import threading
from collections.abc import Callable

from app.api.messages import RequestError
from app.config import embedding_model_name, load_settings
from app.knowledge.chunk import ChunkLimitError, chunk_text, text_tokens
from app.knowledge.embed import pack_vector
from app.knowledge.extract import EXTRACTORS, DecodeError, extract_bytes
from app.storage.protocol import KnowledgeChunk, KnowledgeDocument

MAX_DOCUMENTS = 50
MAX_TITLE_CHARS = 64
MAX_PASTE_CHARS = 200_000
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

TITLE_MESSAGE = "标题写成 1 到 64 个字。"
EMPTY_CONTENT_MESSAGE = "正文去掉首尾空白后不能为空。"
LONG_CONTENT_MESSAGE = "正文最长 200000 个字符。"
EXTENSION_MESSAGE = "扩展名不在登记表里。"
FILENAME_MESSAGE = "没有文件名。"
SIZE_MESSAGE = "文件不能超过 10 MB。"
COUNT_MESSAGE = "最多保存 50 份资料。"
CHUNK_MESSAGE = "内容超过 200 块，请拆成多份。"
DECODE_MESSAGE = "文件须能按 UTF-8 或 gb18030 读取。"
EMPTY_EXTRACT_MESSAGE = "这个文件里没有抽出文字"
EMBED_FAILED_MESSAGE = "嵌入服务暂时不可用，可以重试。"
MODEL_CHANGED_MESSAGE = "嵌入模型已更换，请重新生成向量"
MODEL_UNSET_MESSAGE = "尚未配置嵌入模型，检索暂停"

Embedder = Callable[..., list[list[float]] | None]
Schedule = Callable[[Callable[[], None]], None]

_embed_locks: dict[str, threading.Lock] = {}
_embed_locks_guard = threading.Lock()


def schedule_background(work: Callable[[], None]) -> None:
    threading.Thread(target=work, daemon=True).start()


def create_paste(
    repo,
    owner_id: str,
    title: str,
    content: str,
    embedder: Embedder,
    schedule: Schedule = schedule_background,
) -> KnowledgeDocument:
    cleaned_title = _clean_title(title)
    text = _paste_content(content)
    _ensure_capacity(repo, owner_id)
    chunks = _chunk_or_reject(text)
    with repo.transaction():
        _ensure_capacity(repo, owner_id)
        document = repo.insert_knowledge_document(
            owner_id,
            cleaned_title,
            "paste",
            "",
            "",
            status="pending",
            message="",
        )
        _replace_chunks(repo, document.id, owner_id, chunks)
    _schedule_embed(schedule, repo, document.id, owner_id, embedder)
    return document


def create_upload(
    repo,
    store,
    owner_id: str,
    filename: str,
    data: bytes,
    title: str,
    embedder: Embedder,
    schedule: Schedule = schedule_background,
) -> KnowledgeDocument:
    basename = _basename(filename)
    extension = _known_extension(basename)
    payload = _limited_bytes(data)
    cleaned_title = _upload_title(title, basename)
    _ensure_capacity(repo, owner_id)
    text = _extract_or_reject(extension, payload)
    if text == "":
        return _save_empty_upload(repo, store, owner_id, cleaned_title, basename, extension, payload)
    chunks = _chunk_or_reject(text)
    with repo.transaction():
        _ensure_capacity(repo, owner_id)
        document = repo.insert_knowledge_document(
            owner_id,
            cleaned_title,
            "upload",
            basename,
            extension,
            status="pending",
            message="",
        )
        _replace_chunks(repo, document.id, owner_id, chunks)
    _write_original(repo, store, owner_id, document.id, payload)
    _schedule_embed(schedule, repo, document.id, owner_id, embedder)
    return document


def embed_document(repo, document_id: str, owner_id: str, embedder: Embedder) -> None:
    lock = _lock_for(document_id)
    if not lock.acquire(blocking=False):
        return
    try:
        _embed_held(repo, document_id, owner_id, embedder)
    finally:
        lock.release()


def embed_lock_held(document_id: str) -> bool:
    with _embed_locks_guard:
        lock = _embed_locks.get(document_id)
        return lock is not None and lock.locked()


def display_document(
    document: KnowledgeDocument,
    chunks: list[KnowledgeChunk],
    current_model: str,
) -> tuple[str, str]:
    if document.status != "ready":
        return document.status, document.message
    model = current_model.strip() if isinstance(current_model, str) else ""
    if model == "":
        return "pending", MODEL_UNSET_MESSAGE
    owned = [chunk for chunk in chunks if chunk.document_id == document.id]
    if any(chunk.embedding_model != model for chunk in owned):
        return "pending", MODEL_CHANGED_MESSAGE
    return document.status, document.message


def _embed_held(repo, document_id: str, owner_id: str, embedder: Embedder) -> None:
    pinned = embedding_model_name()
    if pinned == "":
        return
    document = repo.get_knowledge_document(document_id, owner_id)
    if document is None:
        return
    chunks = [chunk for chunk in repo.list_knowledge_chunks(owner_id) if chunk.document_id == document_id]
    chunks.sort(key=lambda chunk: chunk.ordinal)
    if not chunks:
        return
    texts = [chunk.text for chunk in chunks]
    vectors = _call_embedder(embedder, texts)
    if vectors is None and embedding_model_name() == "":
        return
    if not _valid_vectors(vectors, len(texts)):
        repo.set_knowledge_status(document_id, owner_id, "failed", EMBED_FAILED_MESSAGE)
        return
    packed = [pack_vector([float(value) for value in vector]) for vector in vectors]
    repo.save_knowledge_embeddings(document_id, owner_id, pinned, packed)
    repo.set_knowledge_status(document_id, owner_id, "ready", "")


def _schedule_embed(schedule: Schedule, repo, document_id: str, owner_id: str, embedder: Embedder) -> None:
    if embedding_model_name() == "":
        return
    schedule(lambda: embed_document(repo, document_id, owner_id, embedder))


def _call_embedder(embedder: Embedder, texts: list[str]):
    if _requires_settings(embedder):
        return embedder(load_settings(), texts)
    return embedder(texts)


def _requires_settings(embedder: Embedder) -> bool:
    try:
        signature = inspect.signature(embedder)
    except (TypeError, ValueError):
        return False
    required = 0
    for parameter in signature.parameters.values():
        if parameter.kind in (
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.VAR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        ):
            continue
        if parameter.default is inspect.Parameter.empty:
            required += 1
    return required >= 2


def _valid_vectors(vectors: object, count: int) -> bool:
    if not isinstance(vectors, list) or len(vectors) != count:
        return False
    for vector in vectors:
        if not isinstance(vector, list) or len(vector) == 0:
            return False
        for value in vector:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return False
    return True


def _ensure_capacity(repo, owner_id: str) -> None:
    if repo.count_knowledge_documents(owner_id) >= MAX_DOCUMENTS:
        raise RequestError("count", public_message=COUNT_MESSAGE)


def _paste_content(content: object) -> str:
    if not isinstance(content, str):
        raise RequestError("content", public_message=EMPTY_CONTENT_MESSAGE)
    text = content.strip()
    if text == "":
        raise RequestError("content", public_message=EMPTY_CONTENT_MESSAGE)
    if len(text) > MAX_PASTE_CHARS:
        raise RequestError("content", public_message=LONG_CONTENT_MESSAGE)
    return text


def _clean_title(value: object) -> str:
    if not isinstance(value, str):
        raise RequestError("title", public_message=TITLE_MESSAGE)
    title = value.strip()
    if title == "" or len(title) > MAX_TITLE_CHARS:
        raise RequestError("title", public_message=TITLE_MESSAGE)
    return title


def _upload_title(title: object, basename: str) -> str:
    if title is None or (isinstance(title, str) and title.strip() == ""):
        return _clean_title(_stem(basename))
    return _clean_title(title)


def _chunk_or_reject(text: str) -> list[str]:
    try:
        chunks = chunk_text(text)
    except ChunkLimitError as exc:
        raise RequestError("chunks", public_message=CHUNK_MESSAGE) from exc
    if not chunks:
        raise RequestError("content", public_message=EMPTY_CONTENT_MESSAGE)
    return chunks


def _replace_chunks(repo, document_id: str, owner_id: str, chunks: list[str]) -> None:
    repo.replace_knowledge_chunks(
        document_id,
        owner_id,
        [(part, text_tokens(part)) for part in chunks],
    )


def _basename(filename: object) -> str:
    if not isinstance(filename, str):
        raise RequestError("filename", public_message=FILENAME_MESSAGE)
    name = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if name in {"", ".", ".."}:
        raise RequestError("filename", public_message=FILENAME_MESSAGE)
    return name


def _known_extension(basename: str) -> str:
    extension = _extension(basename)
    if extension not in EXTRACTORS:
        raise RequestError("extension", public_message=EXTENSION_MESSAGE)
    return extension


def _extension(name: str) -> str:
    dot = name.rfind(".")
    if dot <= 0 or dot == len(name) - 1:
        return ""
    return name[dot:].lower()


def _stem(basename: str) -> str:
    extension = _extension(basename)
    if extension and basename.lower().endswith(extension):
        return basename[: -len(extension)]
    return basename


def _limited_bytes(data: object) -> bytes:
    if not isinstance(data, bytes) or len(data) > MAX_UPLOAD_BYTES:
        raise RequestError("size", public_message=SIZE_MESSAGE)
    return data


def _extract_or_reject(extension: str, data: bytes) -> str:
    try:
        extracted = extract_bytes(extension, data)
    except DecodeError as exc:
        raise RequestError("encoding", public_message=DECODE_MESSAGE) from exc
    return extracted.strip()


def _save_empty_upload(repo, store, owner_id: str, title: str, basename: str, extension: str, data: bytes):
    with repo.transaction():
        _ensure_capacity(repo, owner_id)
        document = repo.insert_knowledge_document(
            owner_id,
            title,
            "upload",
            basename,
            extension,
            status="failed",
            message=EMPTY_EXTRACT_MESSAGE,
        )
    _write_original(repo, store, owner_id, document.id, data)
    return document


def _write_original(repo, store, owner_id: str, document_id: str, data: bytes) -> None:
    try:
        store.write_knowledge(owner_id, document_id, data)
    except Exception as exc:
        repo.delete_knowledge_document(document_id, owner_id)
        if _knowledge_ids_ok(owner_id, document_id):
            try:
                store.remove_knowledge(owner_id, document_id)
            except Exception as cleanup_error:
                raise cleanup_error from exc
        raise


def _knowledge_ids_ok(owner_id: str, document_id: str) -> bool:
    return _hex_id(owner_id) and _hex_id(document_id)


def _hex_id(value: str) -> bool:
    return isinstance(value, str) and len(value) == 32 and all(char in "0123456789abcdef" for char in value)


def _lock_for(document_id: str) -> threading.Lock:
    with _embed_locks_guard:
        lock = _embed_locks.get(document_id)
        if lock is None:
            lock = threading.Lock()
            _embed_locks[document_id] = lock
        return lock
