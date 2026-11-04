import io
import threading
import time
from uuid import uuid4

import pytest
from pypdf import PdfWriter

from app.api.messages import RequestError
from app.knowledge.chunk import ChunkLimitError, text_tokens
from app.knowledge.embed import pack_vector
from app.knowledge.service import (
    create_paste,
    create_upload,
    display_document,
    embed_document,
    schedule_background,
)
from app.storage.files import FileStore
from app.storage.protocol import KnowledgeChunk, KnowledgeDocument
from app.storage.repository import SqliteRepository

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
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def test_paste_becomes_ready_after_the_scheduled_embed(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-unit")
    repository = SqliteRepository(tmp_path / "knowledge.db")
    owner = uuid4().hex
    calls: list[list[str]] = []
    jobs: list = []

    def embedder(texts):
        calls.append(list(texts))
        return [[1.0, 0.0] for _ in texts]

    document = create_paste(
        repository,
        owner,
        "  分数课标  ",
        "  通分时先找最小公倍数。  ",
        embedder,
        jobs.append,
    )

    assert document.status == "pending"
    assert document.source == "paste"
    assert document.filename == ""
    assert document.extension == ""
    assert document.title == "分数课标"
    assert len(jobs) == 1
    assert calls == []

    jobs[0]()

    saved = repository.get_knowledge_document(document.id, owner)
    assert saved is not None
    assert saved.status == "ready"
    assert saved.message == ""
    chunks = repository.list_knowledge_chunks(owner)
    assert [chunk.text for chunk in chunks] == ["通分时先找最小公倍数。"]
    assert chunks[0].token_count == text_tokens("通分时先找最小公倍数。")
    assert chunks[0].embedding == pack_vector([1.0, 0.0])
    assert chunks[0].embedding_model == "embed-unit"
    assert calls == [["通分时先找最小公倍数。"]]


def test_fifty_first_document_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-unit")
    repository = SqliteRepository(tmp_path / "knowledge.db")
    owner = uuid4().hex
    other = uuid4().hex
    jobs: list = []
    for index in range(50):
        repository.insert_knowledge_document(owner, f"资料{index}", "paste", "", "")

    with pytest.raises(RequestError) as rejected:
        create_paste(repository, owner, "第五十一份", "通分。", _vectors, jobs.append)

    assert rejected.value.public_message == COUNT_MESSAGE
    assert repository.count_knowledge_documents(owner) == 50
    assert all(item.title != "第五十一份" for item in repository.list_knowledge_documents(owner))
    assert jobs == []

    created = create_paste(repository, other, "别人的笔记", "通分。", _vectors, jobs.append)
    assert created.owner_id == other
    assert repository.count_knowledge_documents(other) == 1


def test_unknown_extension_is_not_stored(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-unit")
    repository, store, owner = _upload_world(tmp_path)
    jobs: list = []

    with pytest.raises(RequestError) as rejected:
        create_upload(repository, store, owner, "tool.exe", b"MZ", "标题", _vectors, jobs.append)

    assert rejected.value.public_message == EXTENSION_MESSAGE
    assert repository.count_knowledge_documents(owner) == 0
    assert jobs == []
    assert not (store.root / "knowledge").exists()


def test_empty_pdf_is_saved_as_failed_without_scheduling(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-unit")
    repository, store, owner = _upload_world(tmp_path)
    jobs: list = []
    calls: list = []

    def embedder(texts):
        calls.append(texts)
        return [[1.0, 0.0] for _ in texts]

    payload = _blank_pdf()
    document = create_upload(
        repository,
        store,
        owner,
        "blank.pdf",
        payload,
        "空白卷",
        embedder,
        jobs.append,
    )

    assert document.status == "failed"
    assert document.message == EMPTY_EXTRACT_MESSAGE
    assert document.source == "upload"
    assert document.extension == ".pdf"
    saved = repository.get_knowledge_document(document.id, owner)
    assert saved is not None
    assert saved.status == "failed"
    assert saved.message == EMPTY_EXTRACT_MESSAGE
    assert repository.list_knowledge_chunks(owner) == []
    assert jobs == []
    assert calls == []
    stored = store.root / "knowledge" / owner / document.id / "original"
    assert stored.read_bytes() == payload


def test_unconfigured_model_does_not_call_embedder(tmp_path, monkeypatch):
    monkeypatch.delenv("LLM_EMBEDDING_MODEL", raising=False)
    repository = SqliteRepository(tmp_path / "knowledge.db")
    owner = uuid4().hex
    calls: list = []
    jobs: list = []

    def embedder(texts):
        calls.append(texts)
        return [[1.0, 0.0] for _ in texts]

    document = create_paste(repository, owner, "笔记", "通分。", embedder, jobs.append)

    saved = repository.get_knowledge_document(document.id, owner)
    assert saved is not None
    assert saved.status == "pending"
    assert saved.message == ""
    assert jobs == []
    assert calls == []
    assert len(repository.list_knowledge_chunks(owner)) == 1


def test_display_document_pending_after_model_change():
    ready = _document(status="ready", message="")
    chunks = [_chunk("old-model"), _chunk("old-model", ordinal=1)]

    assert display_document(ready, chunks, "new-model") == ("pending", MODEL_CHANGED_MESSAGE)
    assert display_document(ready, [_chunk("embed-unit")], "embed-unit") == ("ready", "")
    assert display_document(ready, [_chunk("embed-unit"), _chunk("other", ordinal=1)], "embed-unit") == (
        "pending",
        MODEL_CHANGED_MESSAGE,
    )
    assert display_document(ready, [_chunk("embed-unit")], "  ") == ("pending", MODEL_UNSET_MESSAGE)
    failed = _document(status="failed", message=EMPTY_EXTRACT_MESSAGE)
    assert display_document(failed, [], "") == ("failed", EMPTY_EXTRACT_MESSAGE)
    pending = _document(status="pending", message="")
    assert display_document(pending, [_chunk("old-model")], "new-model") == ("pending", "")


def test_embed_failure_marks_document_failed(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-unit")
    repository = SqliteRepository(tmp_path / "knowledge.db")
    owner = uuid4().hex
    jobs: list = []

    def embedder(texts):
        return None

    document = create_paste(repository, owner, "笔记", "通分。", embedder, jobs.append)
    jobs[0]()

    saved = repository.get_knowledge_document(document.id, owner)
    assert saved is not None
    assert saved.status == "failed"
    assert saved.message == EMBED_FAILED_MESSAGE
    chunks = repository.list_knowledge_chunks(owner)
    assert [chunk.text for chunk in chunks] == ["通分。"]
    assert chunks[0].embedding is None


def test_embed_document_returns_when_already_running(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-unit")
    repository = SqliteRepository(tmp_path / "knowledge.db")
    owner = uuid4().hex
    document = repository.insert_knowledge_document(owner, "笔记", "paste", "", "")
    repository.replace_knowledge_chunks(document.id, owner, [("通分。", 2)])
    started = threading.Event()
    release = threading.Event()
    calls = {"first": 0, "second": 0}

    def first(texts):
        calls["first"] += 1
        started.set()
        assert release.wait(2)
        return [[1.0, 0.0] for _ in texts]

    def second(texts):
        calls["second"] += 1
        return [[1.0, 0.0] for _ in texts]

    worker = threading.Thread(target=embed_document, args=(repository, document.id, owner, first))
    worker.start()
    assert started.wait(2)
    embed_document(repository, document.id, owner, second)
    assert calls["second"] == 0
    release.set()
    worker.join(2)
    assert not worker.is_alive()
    assert calls["first"] == 1
    saved = repository.get_knowledge_document(document.id, owner)
    assert saved is not None
    assert saved.status == "ready"


def test_embed_document_can_call_embed_texts_shape(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "chat-model")
    monkeypatch.setenv("AUTH_SECRET", "1234567890123456")
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-unit")
    repository = SqliteRepository(tmp_path / "knowledge.db")
    owner = uuid4().hex
    document = repository.insert_knowledge_document(owner, "笔记", "paste", "", "")
    repository.replace_knowledge_chunks(document.id, owner, [("通分。", 2)])
    seen: dict = {}

    def embedder(settings, texts):
        seen["model"] = settings.llm_model
        seen["texts"] = list(texts)
        return [[1.0, 0.0] for _ in texts]

    embed_document(repository, document.id, owner, embedder)

    assert seen == {"model": "chat-model", "texts": ["通分。"]}
    saved = repository.get_knowledge_document(document.id, owner)
    assert saved is not None
    assert saved.status == "ready"


def test_invalid_paste_and_upload_leave_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-unit")
    repository, store, owner = _upload_world(tmp_path)
    jobs: list = []

    with pytest.raises(RequestError) as rejected:
        create_paste(repository, owner, "  ", "正文", _vectors, jobs.append)
    assert rejected.value.public_message == TITLE_MESSAGE

    with pytest.raises(RequestError) as rejected:
        create_paste(repository, owner, "标" * 65, "正文", _vectors, jobs.append)
    assert rejected.value.public_message == TITLE_MESSAGE

    with pytest.raises(RequestError) as rejected:
        create_paste(repository, owner, "标题", "   ", _vectors, jobs.append)
    assert rejected.value.public_message == EMPTY_CONTENT_MESSAGE

    with pytest.raises(RequestError) as rejected:
        create_paste(repository, owner, "标题", "文" * 200_001, _vectors, jobs.append)
    assert rejected.value.public_message == LONG_CONTENT_MESSAGE

    with pytest.raises(RequestError) as rejected:
        create_upload(repository, store, owner, "", b"abc", "标题", _vectors, jobs.append)
    assert rejected.value.public_message == FILENAME_MESSAGE

    with pytest.raises(RequestError) as rejected:
        create_upload(
            repository,
            store,
            owner,
            "notes.txt",
            b"a" * (_MAX_UPLOAD_BYTES + 1),
            "标题",
            _vectors,
            jobs.append,
        )
    assert rejected.value.public_message == SIZE_MESSAGE

    with pytest.raises(RequestError) as rejected:
        create_upload(repository, store, owner, "notes.txt", b"\xff\xfe not text", "标题", _vectors, jobs.append)
    assert rejected.value.public_message == DECODE_MESSAGE

    def explode(text):
        raise ChunkLimitError("知识文本超过 200 块")

    monkeypatch.setattr("app.knowledge.service.chunk_text", explode)
    with pytest.raises(RequestError) as rejected:
        create_paste(repository, owner, "标题", "正文", _vectors, jobs.append)
    assert rejected.value.public_message == CHUNK_MESSAGE

    assert repository.count_knowledge_documents(owner) == 0
    assert jobs == []
    assert not (store.root / "knowledge").exists()


def test_upload_keeps_the_basename_and_original_bytes(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-unit")
    repository, store, owner = _upload_world(tmp_path)
    jobs: list = []
    data = "通分。".encode("gb18030")

    document = create_upload(
        repository,
        store,
        owner,
        "C:\\课堂\\分数课标.TXT",
        data,
        "",
        _vectors,
        jobs.append,
    )

    assert document.title == "分数课标"
    assert document.filename == "分数课标.TXT"
    assert document.extension == ".txt"
    assert document.source == "upload"
    assert document.status == "pending"
    stored = store.root / "knowledge" / owner / document.id / "original"
    assert stored.read_bytes() == data
    assert "分数课标.TXT" not in stored.as_posix()
    jobs[0]()
    saved = repository.get_knowledge_document(document.id, owner)
    assert saved is not None
    assert saved.status == "ready"


def test_default_schedule_runs_embed_on_a_daemon_thread(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "embed-unit")
    repository = SqliteRepository(tmp_path / "knowledge.db")
    owner = uuid4().hex
    seen: dict = {}

    def embedder(texts):
        seen["daemon"] = threading.current_thread().daemon
        return [[1.0, 0.0] for _ in texts]

    document = create_paste(repository, owner, "笔记", "通分。", embedder)
    deadline = time.monotonic() + 2
    saved = repository.get_knowledge_document(document.id, owner)
    while saved is not None and saved.status != "ready" and time.monotonic() < deadline:
        time.sleep(0.02)
        saved = repository.get_knowledge_document(document.id, owner)

    assert saved is not None
    assert saved.status == "ready"
    assert seen["daemon"] is True
    done = threading.Event()

    def work():
        done.set()

    schedule_background(work)
    assert done.wait(2)


def _vectors(texts):
    return [[1.0, 0.0] for _ in texts]


def _upload_world(tmp_path):
    repository = SqliteRepository(tmp_path / "knowledge.db")
    store = FileStore(tmp_path / "files")
    return repository, store, uuid4().hex


def _blank_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _document(status: str, message: str) -> KnowledgeDocument:
    return KnowledgeDocument(
        id="doc",
        owner_id="owner",
        title="笔记",
        source="paste",
        filename="",
        extension="",
        status=status,
        message=message,
        created_at="2026-11-04T00:00:00",
    )


def _chunk(model: str, ordinal: int = 0) -> KnowledgeChunk:
    return KnowledgeChunk(
        id=f"chunk-{ordinal}",
        document_id="doc",
        owner_id="owner",
        ordinal=ordinal,
        text="通分。",
        embedding=b"\x00\x00\x80?",
        dimensions=1,
        embedding_model=model,
        token_count=1,
    )
