# 知识库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教师在「备课与学情」下面有独立的知识库，上传或粘贴资料后用向量检索，把相关段落注入这一轮对话。

**Architecture:** 解析器按扩展名登记，文本按 512 token 上限切块，向量存在 SQLite。嵌入走 `{嵌入地址}/embeddings`。`LLM_EMBEDDING_BASE_URL` 与 `LLM_EMBEDDING_API_KEY` 都非空时用这一对，否则地址和密钥沿用 `LLM_BASE_URL`、`LLM_API_KEY`。模型名是 `LLM_EMBEDDING_MODEL`。对话注入在备课摘要之后新增一条系统消息，不改图的节点和边。

**Tech Stack:** Python 3.10、FastAPI、标准库 sqlite3 与 urllib、`pypdf`、`python-docx`、React、Vitest。不引入向量数据库或 NumPy。

**Spec:** `docs/superpowers/specs/2026-11-04-knowledge-base-design.md`

测试命令在 `backend/` 或 `frontend/` 下执行。

## Global Constraints

- 侧栏按钮文案是「知识库」，位于「备课与学情」下面，打开独立页面。
- 一位教师最多 50 份资料，失败的也计入。一份最多 200 块。标题 1 到 64 个字。粘贴正文最长 200000 个字符。文件最大 10 MB。
- 扩展名只接受 `.txt`、`.md`、`.pdf`、`.docx`。类型只看文件名扩展名。`.txt` / `.md` 先 UTF-8，失败再 gb18030。
- 每块不超过 512 token，重叠前一块末尾 64 token。单段超过 512 时按 token 切开。
- 嵌入请求 `POST {嵌入地址}/embeddings`。专用地址和密钥都非空时用它们，否则用 `LLM_BASE_URL` 与 `LLM_API_KEY`。`input` 每次数组最多 16 段，超时用 `LLM_TIMEOUT_SECONDS`。失败不重试。
- 资料存储状态只有 `pending`、`ready`、`failed`。换模型或未配置模型时，列表展示为 `pending`，不把存储状态改成 `failed`。
- 检索取余弦相似度最高的 5 段，不设相似度阈值。知识库消息放在备课摘要之后。模型名为空、没有匹配分块、剩余预算小于标题行加 64 token，或提问嵌入失败时，不插入该消息，会话仍可成功。
- 不登记检索工具，不增加图的节点或边。不把知识库段落并进备课摘要。
- 日志和测试代码不记录密钥、正文或向量。检索验收调用真实嵌入接口；其余测试不访问网络。

---

### Task 1: 配置与范围

**Files:**
- Modify: `AGENTS.md`（第 3.2 节）
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_definitions.py`

**Interfaces:**
- Produces: `Settings.llm_embedding_model: str`，缺省 `""`。`load_settings()` 在三项对话配置齐全时不要求嵌入模型名。`embedding_model_name()` 每次读取 `os.environ["LLM_EMBEDDING_MODEL"]`。`write_embedding_model(model: str, path: Path) -> None` 只改这一行；`path` 不是已有文件时抛 `FileNotFoundError`。

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_definitions.py` 增加：

```python
def test_embedding_model_is_optional_and_written_as_one_line(tmp_path, monkeypatch):
    from app.config import load_settings, write_embedding_model

    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "chat-model")
    monkeypatch.setenv("AUTH_SECRET", "1234567890123456")
    monkeypatch.delenv("LLM_EMBEDDING_MODEL", raising=False)

    assert load_settings().llm_embedding_model == ""

    env_file = tmp_path / ".env"
    env_file.write_text("LLM_MODEL=chat-model\nLLM_API_KEY=test-key\n", encoding="utf-8")
    write_embedding_model("embed-model", env_file)

    text = env_file.read_text(encoding="utf-8")
    assert "LLM_API_KEY=test-key" in text
    assert "LLM_EMBEDDING_MODEL=embed-model" in text
    assert os.environ["LLM_EMBEDDING_MODEL"] == "embed-model"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/test_definitions.py::test_embedding_model_is_optional_and_written_as_one_line -v`

Expected: FAIL，`write_embedding_model` 或字段不存在。

- [ ] **Step 3: 实现**

`Settings` 增加 `llm_embedding_model: str = ""`。`load_settings()` 用 `os.environ.get("LLM_EMBEDDING_MODEL", "").strip()` 赋值，不把它加进启动必填项。

```python
def embedding_model_name() -> str:
    return os.environ.get("LLM_EMBEDDING_MODEL", "").strip()


def write_embedding_model(model: str, path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(path)
    lines = path.read_text(encoding="utf-8").splitlines()
    replaced = False
    next_lines: list[str] = []
    for line in lines:
        if line.startswith("LLM_EMBEDDING_MODEL="):
            next_lines.append(f"LLM_EMBEDDING_MODEL={model}")
            replaced = True
        else:
            next_lines.append(line)
    if not replaced:
        next_lines.append(f"LLM_EMBEDDING_MODEL={model}")
    path.write_text("\n".join(next_lines) + "\n", encoding="utf-8")
    os.environ["LLM_EMBEDDING_MODEL"] = model
```

`AGENTS.md` 第 3.2 节在教学数据那句后面加：教师个人知识库已于 2026-11-04 进入当前范围。资料按登录教师隔离，向量存在 SQLite，嵌入模型名是 `LLM_EMBEDDING_MODEL`。这不是向量数据库平台，也不做跨教师语料库。从「不要提前实现」列表里删掉「向量数据库与完整 RAG」这一条，改写成：不建通用向量数据库，不做跨教师语料库；个人知识库以 `docs/superpowers/specs/2026-11-04-knowledge-base-design.md` 为准。

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/test_definitions.py::test_embedding_model_is_optional_and_written_as_one_line -v`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add AGENTS.md backend/app/config.py backend/tests/test_definitions.py
git commit -m "feat: read optional knowledge embedding model"
```

---

### Task 2: 切块

**Files:**
- Create: `backend/app/knowledge/__init__.py`（空文件）
- Create: `backend/app/knowledge/chunk.py`
- Test: `backend/tests/test_knowledge_chunk.py`

**Interfaces:**
- Consumes: `count_messages_locally` from `app.llm.usage`
- Produces: `MAX_CHUNK_TOKENS = 512`，`OVERLAP_TOKENS = 64`，`MAX_CHUNKS = 200`，`chunk_text(text: str) -> list[str]`。超过 200 块抛 `ChunkLimitError`。

- [ ] **Step 1: 写失败测试**

```python
from app.knowledge.chunk import ChunkLimitError, chunk_text, text_tokens


def test_chunk_splits_on_blank_lines_and_overlaps():
    pieces = chunk_text(("甲" * 600) + "\n\n" + ("乙" * 600))
    assert len(pieces) >= 2
    assert all(text_tokens(piece) <= 512 for piece in pieces)
    assert any(piece.startswith("甲") and "乙" in piece for piece in pieces[1:])


def test_chunk_rejects_more_than_200_pieces():
    text = "\n\n".join("句" * 400 for _ in range(201))
    try:
        chunk_text(text)
    except ChunkLimitError:
        return
    raise AssertionError("expected ChunkLimitError")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/test_knowledge_chunk.py -v`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`text_tokens` 用同一条消息的 token 差，避免把消息包装算进块长：

```python
def text_tokens(text: str) -> int:
    empty = count_messages_locally([{"role": "system", "content": ""}])
    return count_messages_locally([{"role": "system", "content": text}]) - empty
```

`chunk_text`：按空行拆段；一段超过 512 token 时用二分法按字符切到每片不超过 512。再把片段装进块，使 `text_tokens(block) <= 512`。下一块以「前一块末尾、token 数不超过 64 的后缀」开头，再加上新片段后仍不得超过 512。结果超过 200 块抛 `ChunkLimitError`。空文本返回 `[]`。

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/test_knowledge_chunk.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add backend/app/knowledge backend/tests/test_knowledge_chunk.py
git commit -m "feat: chunk knowledge text at 512 tokens"
```

---

### Task 3: 解析器

**Files:**
- Modify: `backend/pyproject.toml`（dependencies 增加 `pypdf`、`python-docx`）
- Create: `backend/app/knowledge/extract.py`
- Test: `backend/tests/test_knowledge_extract.py`

**Interfaces:**
- Produces: `EXTRACTORS: dict[str, TextExtractor]`，键为 `.txt`、`.md`、`.pdf`、`.docx`。`extract_bytes(extension: str, data: bytes) -> str`。未知扩展名抛 `UnknownExtension`。文本编码失败抛 `DecodeError`。

- [ ] **Step 1: 安装依赖并写失败测试**

Run: `python -m pip install pypdf python-docx`

`backend/tests/test_knowledge_extract.py`：

```python
import io

import pytest
from docx import Document
from pypdf import PdfWriter

from app.knowledge.extract import DecodeError, UnknownExtension, extract_bytes


def test_text_extensions_decode_utf8_then_gb18030():
    assert extract_bytes(".txt", "通分\n".encode("utf-8")) == "通分\n"
    assert extract_bytes(".md", "通分".encode("gb18030")) == "通分"
    with pytest.raises(DecodeError):
        extract_bytes(".txt", b"\xff\xfe not text")


def test_docx_extracts_paragraphs_and_cells():
    document = Document()
    document.add_paragraph("通分时先找最小公倍数。")
    table = document.add_table(rows=1, cols=1)
    table.cell(0, 0).text = "单元格"
    buffer = io.BytesIO()
    document.save(buffer)

    text = extract_bytes(".docx", buffer.getvalue())

    assert "通分时先找最小公倍数。" in text
    assert "单元格" in text


def test_blank_pdf_extracts_empty_string_and_doc_is_unknown():
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buffer = io.BytesIO()
    writer.write(buffer)

    assert extract_bytes(".pdf", buffer.getvalue()).strip() == ""
    with pytest.raises(UnknownExtension):
        extract_bytes(".doc", b"old")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/test_knowledge_extract.py -v`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`extract_bytes` 用小写扩展名查表。`.txt` 与 `.md` 共用一个解析器：`data.decode("utf-8")` 失败再 `data.decode("gb18030")`。`.pdf` 用 `PdfReader` 按 `pages` 顺序取 `extract_text()`，空页当空字符串，用换行接起来。`.docx` 先输出段落，再按表格、行、单元格输出文字。解析器不判断抽出结果是否为空，调用方处理。

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/test_knowledge_extract.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add backend/pyproject.toml backend/app/knowledge/extract.py backend/tests/test_knowledge_extract.py
git commit -m "feat: extract text from txt markdown pdf and docx"
```

---

### Task 4: 存储与原始文件

**Files:**
- Modify: `backend/app/storage/protocol.py`
- Modify: `backend/app/storage/repository.py`
- Modify: `backend/app/storage/files.py`
- Test: `backend/tests/test_knowledge_store.py`

**Interfaces:**
- Produces:
  - `KnowledgeDocument`：`id`、`owner_id`、`title`、`source`、`filename`、`extension`、`status`、`message`、`created_at`
  - `KnowledgeChunk`：`id`、`document_id`、`owner_id`、`ordinal`、`text`、`embedding: bytes | None`、`dimensions: int`、`embedding_model: str`、`token_count: int`
  - `insert_knowledge_document(...) -> KnowledgeDocument`
  - `count_knowledge_documents(owner_id: str) -> int`
  - `list_knowledge_documents(owner_id: str) -> list[KnowledgeDocument]`
  - `get_knowledge_document(document_id: str, owner_id: str) -> KnowledgeDocument | None`
  - `replace_knowledge_chunks(document_id, owner_id, chunks: list[tuple[str, int]]) -> None`
  - `list_knowledge_chunks(owner_id: str) -> list[KnowledgeChunk]`
  - `save_knowledge_embeddings(document_id, owner_id, model: str, vectors: list[bytes]) -> None`
  - `set_knowledge_status(document_id, owner_id, status: str, message: str) -> None`
  - `delete_knowledge_document(document_id, owner_id) -> bool`
  - `FileStore.write_knowledge(owner_id, document_id, data: bytes) -> Path`
  - `FileStore.remove_knowledge(owner_id, document_id) -> None`

标识用 `uuid4().hex`。路径是 `root/knowledge/{owner_id}/{document_id}/original`。`owner_id` 和 `document_id` 只允许 32 位小写十六进制，否则 `ValueError`。别人的 id 对当前属主返回 `None` 或 `False`。

- [ ] **Step 1: 写失败测试**

用临时 `SqliteRepository` 与 `FileStore`：教师 A 插入一份 paste 资料和两块；B 的列表为空，B 不能读、不能删 A 的资料。`write_knowledge` 的路径以 `knowledge/` 开头且文件名是 `original`。删除后分块和文件都不在。`../` 作为 owner id 抛 `ValueError`。

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/test_knowledge_store.py -v`

Expected: FAIL

- [ ] **Step 3: 实现**

在 `_init_schema` 末尾创建 `knowledge_documents` 与 `knowledge_chunks`，字段与规格第「数据」节一致。`embedding` 是 BLOB。所有查询带 `owner_id`。`save_knowledge_embeddings` 按 `ordinal` 写向量、维度和模型名；向量个数与分块数不一致时抛 `InputError`。

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/test_knowledge_store.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add backend/app/storage/protocol.py backend/app/storage/repository.py backend/app/storage/files.py backend/tests/test_knowledge_store.py
git commit -m "feat: store personal knowledge documents and files"
```

---

### Task 5: 嵌入客户端与余弦相似度

**Files:**
- Create: `backend/app/knowledge/embed.py`
- Test: `backend/tests/test_knowledge_embed.py`

**Interfaces:**
- Produces:
  - `pack_vector(values: list[float]) -> bytes`
  - `unpack_vector(blob: bytes) -> list[float]`
  - `cosine(left: list[float], right: list[float]) -> float`
  - `embed_texts(settings, texts: list[str], opener=None) -> list[list[float]] | None`
  - 模型名为空时返回 `None`，不发请求。

- [ ] **Step 1: 写失败测试**

用假的 `opener` 记录 URL 和正文。两条文本分成一批时，URL 以 `/embeddings` 结尾，`input` 长度不超过 16，`model` 等于 `LLM_EMBEDDING_MODEL`。响应 `data` 顺序与输入一致。HTTP 错误、超时、缺 `embedding` 或长度对不上时返回 `None`，且 opener 只被调用一次。`cosine([1, 0], [1, 0]) == 1`。零向量返回 `-1`。`pack_vector` 再 `unpack_vector` 与原列表在 `1e-6` 内相等。

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/test_knowledge_embed.py -v`

Expected: FAIL

- [ ] **Step 3: 实现**

请求体 `{"model": model, "input": batch}`。一批最多 16 条。使用 `LLM_TIMEOUT_SECONDS`。失败返回 `None`，不重试，不记录 `texts` 或密钥。向量用 `struct.pack("<{}f".format(len(values)), *values)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/test_knowledge_embed.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add backend/app/knowledge/embed.py backend/tests/test_knowledge_embed.py
git commit -m "feat: call embeddings endpoint and score vectors"
```

---

### Task 6: 入库与后台嵌入

**Files:**
- Create: `backend/app/knowledge/service.py`
- Test: `backend/tests/test_knowledge_service.py`

**Interfaces:**
- Consumes: Task 2 到 Task 5 的函数和仓储方法。
- Produces:
  - `create_paste(repo, owner_id, title, content, embedder, schedule) -> KnowledgeDocument`
  - `create_upload(repo, store, owner_id, filename, data, title, embedder, schedule) -> KnowledgeDocument`
  - `embed_document(repo, document_id, owner_id, embedder) -> None`
  - `display_document(document, chunks, current_model) -> tuple[str, str]`
  - `schedule` 是 `Callable[[Callable[[], None]], None]`。默认实现启动守护线程。测试传入把函数收进列表的 schedule，再手动调用。
  - 同一 `document_id` 已有嵌入在跑时，`embed_document` 直接返回。

校验失败抛 `app.api.messages.RequestError`，`public_message` 用规格里的说明：标题、空正文、扩展名、10 MB、50 份、200 块、请拆成多份、UTF-8 或 gb18030。抽出空文本时保存 `failed` 和「这个文件里没有抽出文字」，不调用 `schedule`。已配置模型且抽出成功时，先存 `pending` 和分块，返回后由 `schedule` 调用 `embed_document`。嵌入返回 `None` 时状态改为 `failed`，说明「嵌入服务暂时不可用，可以重试。」成功时状态改为 `ready`。进程启动不扫描 `pending` 资料。

- [ ] **Step 1: 写失败测试**

假 `embedder` 返回 `[[1.0, 0.0]]` 这种与块数相同的向量。覆盖：粘贴成功后手动跑 schedule 里的任务，状态变为 `ready`；第 51 份被拒绝；`.exe` 不落库；空 PDF 保存为 `failed`；模型名为空时不调用 embedder，状态保持 `pending`；展示函数在模型名变更后返回 `pending` 和「嵌入模型已更换，请重新生成向量」。

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/test_knowledge_service.py -v`

Expected: FAIL

- [ ] **Step 3: 实现**

展示规则按规格「读列表时另算展示状态」。嵌入用文档锁：`acquire(blocking=False)` 失败则返回。锁放在 `service` 模块的字典里，以 `document_id` 为键。

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/test_knowledge_service.py tests/test_knowledge_store.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add backend/app/knowledge/service.py backend/tests/test_knowledge_service.py
git commit -m "feat: save knowledge documents and embed them in the background"
```

---

### Task 7: HTTP 接口

**Files:**
- Create: `backend/app/api/knowledge.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/config.py` 的公开配置组装处（`process_llm` / `dotenv_llm` 若只服务对话字段，则在 `main._public_llm` 增加读取）
- Test: `backend/tests/test_knowledge_api.py`

**Interfaces:**
- Produces: 规格「接口」表中的五个路由。`GET /api/llm/config` 的 `environment` 和 `dotenv` 都含 `embedding_model`。`create_app` 把 `app.state.env_file` 设为传入的 `env_file` 或 `default_env_path()`。

- [ ] **Step 1: 写失败测试**

沿用 `tests/test_teaching.py` 的 `_two_teachers`。断言：

- 未登录 `GET /api/knowledge/documents` 为 401。
- A 粘贴后 B 的列表 `documents` 为空。B 删除 A 的 id 为 404。
- 上传 `notes.exe` 为 400，列表仍为空。
- 删除自己的资料为 204，之后列表为空。
- `PUT /api/knowledge/embedding-model` 正文 `{"model":"embed-small"}` 写到测试用的 `.env`，响应只有 `embedding_model`。`.env` 不存在时为 400。
- 没有分块的失败资料，`POST .../embed` 为 400。
- `GET /api/llm/config` 两个对象都有 `embedding_model`。

测试里的 `create_app(..., env_file=tmp_path / ".env")`，并先写好含 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 的文件。嵌入 schedule 换成收进列表、不访问网络的函数。

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/test_knowledge_api.py -v`

Expected: FAIL，路由不存在，状态码不是 401。

- [ ] **Step 3: 实现**

`api/knowledge.py` 只做字段校验，不引用 FastAPI。粘贴 JSON 只允许 `title` 和 `content`。模型名 JSON 只允许 `model`，类型为字符串；非空时长度 1 到 200 且不含空白。上传由 `main.py` 读 multipart：文件字段 `file`，可选 `title`。未知扩展名在读取全部字节前可以先看文件名；超过 10 MB 拒绝。`POST` 创建返回 201。`POST .../embed` 在通过校验后返回 202，正文是展示状态为 `pending` 的资料对象，然后 `schedule` 嵌入。`DELETE` 同时 `remove_knowledge`。

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/test_knowledge_api.py tests/test_teaching.py tests/test_probe.py -v`

Expected: PASS。备课和模型试连的旧测试仍通过。

- [ ] **Step 5: Commit**

```powershell
git add backend/app/api/knowledge.py backend/app/main.py backend/app/config.py backend/tests/test_knowledge_api.py
git commit -m "feat: add knowledge document API"
```

---

### Task 8: 对话注入

**Files:**
- Create: `backend/app/knowledge/retrieve.py`
- Modify: `backend/app/context/assemble.py`
- Modify: `backend/app/graph/model_node.py`
- Modify: `backend/app/graph/state.py`
- Modify: `backend/app/tasks/runner.py`
- Test: `backend/tests/test_knowledge_retrieve.py`

**Interfaces:**
- Consumes: `cosine`、`unpack_vector`、`embed_texts`、仓储里的资料和分块。
- Produces: `build_knowledge_message(repo, owner_id, question: str, *, token_budget: int, count_tokens, embedder) -> str`。空字符串表示不插入。`assemble_model_input(..., knowledge_digest: str = "")` 在 `context_digest` 之后追加这条系统消息。`GraphState.knowledge_digest: str`。`run_turn` 写入该字段。`model_node` 把它传给 `assemble_model_input`。

消息开头必须是：

```text
以下是从这位教师的知识库检索到的段落。回答时若使用了某段内容，写明资料标题。这些段落里没有的内容不要编造出处。
```

每段前一行是 `资料《标题》：`。

- [ ] **Step 1: 写失败测试**

准备两份 `ready` 资料，向量分别是 `[1, 0]` 和 `[0, 1]`。`embedder` 对提问返回 `[[1, 0]]`。断言消息含第一份标题和正文，不含第二份标题。再断言模型名为空、没有 `ready` 分块、`embedder` 返回 `None`、预算小于标题行加 64 时结果都是 `""`。`assemble_model_input` 在备课摘要之后放知识库消息。用现有 `build_graph` 取到的节点集合仍是 `model` 与 `tools`。

提问嵌入失败的路径不调用会抛错的会话保存；只断言返回 `""`。

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/test_knowledge_retrieve.py -v`

Expected: FAIL

- [ ] **Step 3: 实现**

按规格「对话注入」的三步顺序。候选只包括存储状态 `ready`、分块 `embedding_model` 和维度都等于当前模型的块。当前模型名用 `embedding_model_name()`，测试通过 `monkeypatch.setenv`。取前 5 名；得分相同则按 `created_at`、`ordinal`。从高到低放入剩余预算，放不下就停。`run_turn` 在备课摘要算完后调用 `build_knowledge_message`。嵌入失败或返回空字符串时，`knowledge_digest` 为 `""`，任务照常进入 `invoke`。

不要改 `backend/app/graph/build.py` 和 `backend/app/graph/edges.py`。

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/test_knowledge_retrieve.py tests/test_graph.py tests/test_context.py tests/test_runner.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add backend/app/knowledge/retrieve.py backend/app/context/assemble.py backend/app/graph/model_node.py backend/app/graph/state.py backend/app/tasks/runner.py backend/tests/test_knowledge_retrieve.py
git commit -m "feat: inject retrieved knowledge into the turn"
```

---

### Task 9: 真实嵌入验收

**Files:**
- Test: `backend/tests/test_knowledge_live.py`

**Interfaces:**
- Consumes: `create_paste`、`build_knowledge_message`、环境变量 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_EMBEDDING_MODEL`。

- [ ] **Step 1: 写测试**

三项有任一为空时，`pytest.fail` 并写明缺少的变量名。否则粘贴标题「分数课标」和正文「青椒独特句：通分时先找最小公倍数。」调用真实 `embed_texts` 作为 embedder，schedule 用直接执行。60 秒内状态须为 `ready`。再用包含「青椒独特句」的问题调用 `build_knowledge_message`。对话补全不在这个测试里调用。断言消息含「分数课标」和「青椒独特句」。

- [ ] **Step 2: 运行**

Run: `python -m pytest tests/test_knowledge_live.py -v`

Expected: 三项已填写时 PASS。未填 `LLM_EMBEDDING_MODEL` 时 FAIL，并指出这个名字。不要改测试去跳过或换假向量。

- [ ] **Step 3: Commit**

```powershell
git add backend/tests/test_knowledge_live.py
git commit -m "test: retrieve knowledge with the real embeddings endpoint"
```

---

### Task 10: 知识库页面

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/api/http.ts`
- Create: `frontend/src/components/KnowledgePanel.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/pages/Workbench.tsx`
- Modify: `frontend/src/components/Settings.tsx`
- Test: `frontend/src/components/KnowledgePanel.test.tsx`
- Test: `frontend/src/pages/Workbench.test.tsx`

**Interfaces:**
- Produces: `KnowledgeApi`，方法 `listDocuments`、`createPaste`、`createUpload`、`deleteDocument`、`embedDocument`、`saveEmbeddingModel`。`Workbench` 的 `view` 增加 `"knowledge"`。

- [ ] **Step 1: 写失败测试**

`KnowledgePanel.test.tsx`：列表为空时能看见空状态；有一条 `failed` 且 `extension` 为 `.pdf` 时能看见重试；点击重试调用 `embedDocument`。模型名为空时能看见输入框，保存调用 `saveEmbeddingModel`。

`Workbench.test.tsx`：已登录时「知识库」按钮在「备课与学情」之后。点击后能看见知识库标题，看不见备课页标题「备课与学情」的主区内容。给 `Workbench` 传入假的 `knowledgeApi`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/components/KnowledgePanel.test.tsx src/pages/Workbench.test.tsx`

Expected: FAIL，组件或按钮不存在。

- [ ] **Step 3: 实现**

侧栏按钮 class 使用 `new-chat side-teaching`，`aria-current` 在 `knowledgeOpen` 时为 `page`。忙碌或未登录时禁用，规则与备课按钮相同。

`KnowledgePanel` 进入时拉列表。`embedding_model` 为空时页顶显示输入框和「尚未配置嵌入模型，检索暂停」。存在 `pending` 时每 2 秒再拉一次，离开页面时清掉定时器。粘贴和上传在 `busy` 时按钮禁用。删除先 `window.confirm`。`failed` 且 `extension` 非空或 `source` 为 `paste` 时，若 `message` 是「这个文件里没有抽出文字」则不显示重试；其余 `failed` 显示重试。设置页本地供应商在对话模型名下面显示嵌入模型名，没有输入框。

`http.ts` 解析资料对象时缺字段就抛 `ApiRequestError("invalid_response", ...)`，与现有解析风格一致。上传用 `FormData`，不要手写 JSON 边界。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/components/KnowledgePanel.test.tsx src/pages/Workbench.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/types/api.ts frontend/src/api/http.ts frontend/src/components/KnowledgePanel.tsx frontend/src/components/KnowledgePanel.test.tsx frontend/src/components/Sidebar.tsx frontend/src/components/Settings.tsx frontend/src/pages/Workbench.tsx frontend/src/pages/Workbench.test.tsx
git commit -m "feat: open the knowledge base under teaching context"
```

---

### Task 11: 接口契约

**Files:**
- Modify: `docs/api-contract.md`

**Interfaces:**
- Consumes: Task 7 的五个路由和 `GET /api/llm/config` 的新字段。

- [ ] **Step 1: 写入契约**

在文首范围句里加上知识库。新增一节，列出五个路由的方法、成功状态码、请求字段和资料对象字段。写明未登录 401、别人的资料 404、校验失败 400。`embedding_model` 出现在列表响应和两个模型配置对象里。不要写密钥样例。

- [ ] **Step 2: 对照规格核对**

把规格「接口」表的每一行和契约新节对一遍。状态码必须是 201、200、204、202、200。

- [ ] **Step 3: Commit**

```powershell
git add docs/api-contract.md docs/superpowers/specs/2026-11-04-knowledge-base-design.md
git commit -m "docs: record the knowledge base API"
```

---

## 规格覆盖

| 规格要求 | 任务 |
| --- | --- |
| 独立入口、不进备课页 | Task 10 |
| 粘贴与四种文件、解析器登记 | Task 3、Task 6、Task 7 |
| 512 / 64 / 200 块 / 50 份 | Task 2、Task 6 |
| SQLite 向量、属主隔离、原始文件路径 | Task 4 |
| 嵌入请求、失败不重试、同资料不重复嵌入 | Task 5、Task 6 |
| 展示状态与页面轮询 | Task 6、Task 10 |
| 对话注入三步和前 5 段 | Task 8 |
| 真实嵌入测试 | Task 9 |
| 设置页只显示模型名，知识库页可保存 | Task 7、Task 10 |
| 不改图的节点和边 | Task 8 |
| AGENTS.md 与接口契约 | Task 1、Task 11 |
