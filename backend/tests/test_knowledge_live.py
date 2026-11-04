"""真实嵌入接口验收。密钥只从环境读取，不写进本文件。"""

import os
import time
from uuid import uuid4

import pytest

from app.config import load_env_file
from app.knowledge.embed import embed_texts
from app.knowledge.retrieve import build_knowledge_message
from app.knowledge.service import create_paste
from app.llm.usage import count_messages_locally
from app.storage.repository import SqliteRepository

_REQUIRED = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_EMBEDDING_MODEL")


def test_real_embeddings_put_the_passage_into_the_turn(tmp_path):
    load_env_file()
    missing = [name for name in _REQUIRED if not os.environ.get(name, "").strip()]
    if missing:
        pytest.fail("缺少 " + "、".join(missing))
    if len(os.environ.get("AUTH_SECRET", "").strip()) < 16:
        os.environ["AUTH_SECRET"] = "test-secret-value"

    owner_id = uuid4().hex
    repo = SqliteRepository(tmp_path / "live.sqlite")
    created = create_paste(
        repo,
        owner_id,
        "分数课标",
        "青椒独特句：通分时先找最小公倍数。",
        embed_texts,
        lambda work: work(),
    )
    deadline = time.time() + 60
    document = created
    while time.time() < deadline:
        current = repo.get_knowledge_document(created.id, owner_id)
        if current is not None and current.status in {"ready", "failed"}:
            document = current
            break
        time.sleep(0.2)

    assert document.status == "ready", document.message
    message = build_knowledge_message(
        repo,
        owner_id,
        "青椒独特句是什么",
        token_budget=8000,
        count_tokens=count_messages_locally,
        embedder=embed_texts,
    )
    assert "分数课标" in message
    assert "青椒独特句" in message
