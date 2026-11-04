from uuid import uuid4

import pytest

from app.storage.files import FileStore
from app.storage.protocol import InputError
from app.storage.repository import SqliteRepository


def test_knowledge_documents_and_files_stay_with_their_owner(tmp_path):
    repository = SqliteRepository(tmp_path / "knowledge.db")
    store = FileStore(tmp_path / "files")
    owner_a = uuid4().hex
    owner_b = uuid4().hex

    document = repository.insert_knowledge_document(
        owner_a,
        "单元说明",
        "paste",
        "",
        "",
    )
    assert document.owner_id == owner_a
    assert document.title == "单元说明"
    assert document.source == "paste"
    assert document.filename == ""
    assert document.extension == ""
    assert document.status == "pending"
    assert document.message == ""
    assert document.created_at

    repository.replace_knowledge_chunks(document.id, owner_a, [("第一段", 3), ("第二段", 4)])

    assert repository.count_knowledge_documents(owner_b) == 0
    assert repository.list_knowledge_documents(owner_b) == []
    assert repository.get_knowledge_document(document.id, owner_b) is None
    assert repository.delete_knowledge_document(document.id, owner_b) is False
    assert repository.list_knowledge_chunks(owner_b) == []

    visible = repository.list_knowledge_documents(owner_a)
    assert [item.id for item in visible] == [document.id]
    assert repository.count_knowledge_documents(owner_a) == 1
    chunks = repository.list_knowledge_chunks(owner_a)
    assert [(chunk.ordinal, chunk.text, chunk.token_count, chunk.embedding) for chunk in chunks] == [
        (0, "第一段", 3, None),
        (1, "第二段", 4, None),
    ]
    assert all(chunk.document_id == document.id and chunk.owner_id == owner_a for chunk in chunks)

    stored = store.write_knowledge(owner_a, document.id, b"paste-bytes")
    relative = stored.relative_to(store.root).as_posix()
    assert relative.startswith("knowledge/")
    assert stored.name == "original"
    assert stored.read_bytes() == b"paste-bytes"

    with pytest.raises(ValueError):
        store.write_knowledge("../", document.id, b"nope")
    with pytest.raises(ValueError):
        store.remove_knowledge("../", document.id)

    assert repository.delete_knowledge_document(document.id, owner_a) is True
    assert repository.get_knowledge_document(document.id, owner_a) is None
    assert repository.list_knowledge_chunks(owner_a) == []
    assert repository.count_knowledge_documents(owner_a) == 0
    store.remove_knowledge(owner_a, document.id)
    assert not stored.exists()


def test_embeddings_follow_ordinal_and_reject_a_count_mismatch(tmp_path):
    repository = SqliteRepository(tmp_path / "knowledge.db")
    owner = uuid4().hex
    document = repository.insert_knowledge_document(
        owner,
        "课堂笔记",
        "upload",
        "notes.md",
        ".md",
    )
    repository.replace_knowledge_chunks(document.id, owner, [("甲", 1), ("乙", 1)])
    first = b"\x00\x00\x80\x3f"
    second = b"\x00\x00\x00\x40\x00\x00\x40\x40"

    repository.save_knowledge_embeddings(document.id, owner, "embed-model", [first, second])

    chunks = repository.list_knowledge_chunks(owner)
    assert chunks[0].embedding == first
    assert chunks[0].dimensions == 1
    assert chunks[0].embedding_model == "embed-model"
    assert chunks[1].embedding == second
    assert chunks[1].dimensions == 2
    assert chunks[1].embedding_model == "embed-model"

    with pytest.raises(InputError):
        repository.save_knowledge_embeddings(document.id, owner, "embed-model", [first])

    repository.set_knowledge_status(document.id, owner, "ready", "")
    saved = repository.get_knowledge_document(document.id, owner)
    assert saved is not None
    assert saved.status == "ready"
    assert saved.message == ""
    assert saved.filename == "notes.md"
    assert saved.extension == ".md"
