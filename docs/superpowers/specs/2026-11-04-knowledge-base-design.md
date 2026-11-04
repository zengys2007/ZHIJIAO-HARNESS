# 知识库设计（2026-11-04）

状态：已确认（2026-11-04）。切块上限为 512 token，重叠 64 token。检索测试调用真实嵌入接口。

前置文档：[备课与学情](2026-11-01-teaching-context.md)、[MVP 路线](2026-10-21-mvp-roadmap.md)、[后续路线](2026-10-21-later-roadmap.md)

本文把教师个人知识库移入当前范围。它是侧栏里「备课与学情」下面的独立入口，不放进备课页面，也不使用备课的表。向量存在现有 SQLite 里。不另起向量数据库，不做跨教师语料库。后续路线第 5.1 节的 `search_materials` 工具仍未进入当前范围；本功能不登记工具，也不改对话图的节点和边。

实现代码之前，先改 `AGENTS.md` 第 3.2 节，写明个人知识库已进入当前范围。

## 目标

教师保存自己的资料。提问时用当前这句话做向量检索，把最相关的若干段连同资料标题放进这一轮的一条系统消息。备课摘要仍是另一条系统消息。

## 范围

### 做

- 侧栏「知识库」按钮位于「备课与学情」下面，打开独立页面。
- 粘贴标题和正文，或上传 `.txt`、`.md`、`.pdf`、`.docx`。
- 解析器按扩展名登记。以后新增格式只登记解析器。
- 文本切块、调用 `{LLM_BASE_URL}/embeddings`、把向量存进 SQLite。
- 嵌入模型名是 `LLM_EMBEDDING_MODEL`。地址和密钥沿用 `LLM_BASE_URL`、`LLM_API_KEY`。
- 每一轮对话按教师当前这句话检索本人已就绪的分块，并注入单独的系统消息。
- 资料、原文和向量按登录教师隔离。

### 不做

- 不做 OCR，不解析老的 `.doc`。抽不出文字的文件保存为失败。
- 不把知识库段落并进备课摘要，不改备课的表和接口。
- 不登记检索工具，不增加图的节点或边，不编译检查点。
- 不引入向量数据库、NumPy 或其他嵌入 SDK。相似度在 Python 里计算。
- 不在浏览器里调用嵌入接口，不把密钥写进前端、日志或测试代码。
- 对话模型仍走现有的 `complete`。检索失败不把这一轮会话标为失败。
- 不设相似度阈值。当前嵌入模型下有就绪分块时，取得分最高的若干段。

## 配置

`LLM_EMBEDDING_MODEL` 与现有对话配置放在一起，从环境变量读取。`.env.example` 里该项为空。进程启动不要求它有值；缺失时对话和资料保存仍可用，检索暂停。

知识库页是唯一可以修改这项的地方。`PUT /api/knowledge/embedding-model` 只接受模型名，写回进程环境和项目 `.env` 里的这一行，不改写地址和密钥，响应里也不返回密钥。设置页的本地供应商只显示当前模型名。

模型名留空表示清除。非空时长度为 1 到 200，中间不能有空白或换行。

## 资料与文件

一位教师最多 50 份资料，失败的资料也计入。超出时不保存新的一份。标题去掉首尾空白后为 1 到 64 个字。粘贴正文去掉首尾空白后不能为空，最长 200000 个字符。上传文件最大 10 MB，类型只看文件名扩展名，不看 `Content-Type`。扩展名不在登记表里、没有文件名、或超过大小时，不保存并返回 `invalid_input`。

粘贴请求是 JSON，字段只有 `title` 和 `content`。上传是 multipart，文件字段为 `file`，标题字段 `title` 可省略。省略时用文件名去掉扩展名后的文字做标题，仍须满足标题长度。展示用的原始文件名只作显示，先去掉路径成分。磁盘路径由存储层生成：`knowledge/{owner_id}/{document_id}/original`。不使用用户提供的文件名做路径。

`.txt` 和 `.md` 先按 UTF-8 解码，失败再按 gb18030。两种都失败则不保存，返回 `invalid_input`，说明文件须能按 UTF-8 或 gb18030 读取。`.pdf` 用 `pypdf` 按页序抽出文字。`.docx` 用 `python-docx` 按文档顺序抽出段落和表格单元格文字。标准库不能解析这两种文件，所以这两项是直接依赖。抽出的文字去掉首尾空白后为空时，资料仍保存，状态为 `failed`，说明是「这个文件里没有抽出文字」。

解析器协议只有扩展名元组（带点、小写）和 `extract(data: bytes) -> str`。登记表是扩展名到解析器的映射。未知扩展名在读文件内容之前拒绝。

切块以空行分段，再用现有 token 计数装入每块不超过 512 token 的块，下一块带上前一块末尾 64 token。单段超过 512 token 时按 token 切开。一份资料最多 200 块。粘贴或抽出的文字会超过 200 块时，不保存，返回 `invalid_input`，说明请拆成多份。

## 数据

SQLite 表由 `repository.py` 创建，调用方不写 SQL。

`knowledge_documents`：`id`、`owner_id`、`title`、`source`（`paste` 或 `upload`）、`filename`、`extension`、`status`（`pending`、`ready`、`failed`）、`message`、`created_at`。

`knowledge_chunks`：`id`、`document_id`、`owner_id`、`ordinal`、`text`、`embedding`（小端 float32 二进制，可空）、`dimensions`、`embedding_model`、`token_count`。

上传文件的原始字节由 `FileStore` 写入上面的生成路径。粘贴资料没有原始文件。删除资料时同时删除分块、向量和原始文件。

文档的存储状态：

- `pending`：文本已保存，嵌入还没完成。
- `ready`：嵌入任务已经成功，每个分块都记下了当时的模型名和向量。
- `failed`：抽不出文字，或嵌入请求失败。文本仍保留。嵌入失败的说明是「嵌入服务暂时不可用，可以重试。」

读列表时另算展示状态。存储已是 `ready`，但分块上的模型名与当前 `LLM_EMBEDDING_MODEL` 不同，或当前模型名为空：展示为 `pending`。模型名为空时，页面说明「尚未配置嵌入模型，检索暂停」，不把每一份改成 `failed`。模型名更换后，说明是「嵌入模型已更换，请重新生成向量」。存储状态保持不变，直到重新嵌入开始。

## 嵌入

已配置模型名，且文本抽取成功时，创建接口先返回资料，再在本进程后台嵌入。后台开始时状态为 `pending`。全部块成功后改为 `ready`。任一次嵌入请求失败则改为 `failed`，已写入的向量可以留下，检索仍要求该资料为 `ready` 且模型名一致，因此失败资料不参与检索。进程在后台结束前重启时，资料停在 `pending`，由页面上的重试继续。

嵌入请求是 `POST {LLM_BASE_URL}/embeddings`，超时使用 `LLM_TIMEOUT_SECONDS`。正文为 JSON：`model` 是嵌入模型名，`input` 是字符串数组，每次数组最多 16 段。成功响应使用 `data` 数组里的 `embedding` 数字列表，顺序与 `input` 相同，且长度一致。形状不对、HTTP 错误、超时或连接失败都算这次嵌入失败，不重试。日志只记资料 id 和失败类别，不记正文、向量或密钥。

`POST /api/knowledge/documents/{id}/embed` 用于已经抽出文字、但需要重新嵌入的资料。它立即返回 `202`，存储状态改为 `pending`。同一资料已有后台嵌入在跑时，再次调用只返回 `202`，不启动第二份工作。别人的资料和不存在的资料返回 `404`。抽取失败、没有分块的资料返回 `invalid_input`，说明须重新上传或粘贴。

`PUT` 写入进程环境。项目 `.env` 已存在时，替换或追加 `LLM_EMBEDDING_MODEL` 这一行。`.env` 不存在时返回 `invalid_input`，说明要先准备该文件。不改写文件里的其他行。

## 对话注入

一轮开始时，在备课摘要之后单独决定知识库消息。检索只使用当前教师这句话，不使用更早的对话。按下面的顺序，任一步停住就不插入知识库消息，会话继续：

1. 当前模型名为空，或该教师没有存储状态为 `ready`、且分块模型名和维度都与当前模型一致的分块。
2. 剩余输入预算小于知识库标题行的 token 数加 64。剩余预算等于上下文上限减去输出预留、工具 schema、系统提示、历史、当前教师消息、备课摘要、追问和计划消息。
3. 嵌入这一句话。嵌入失败时停住。

通过这三步后，用余弦相似度取最高的 5 段；不足 5 段则全取。并列时按资料创建时间和分块序号稳定排序。从高到低装入剩余预算，装不下的丢掉。一段都装不下则不插入消息。

检索结果先写成完整的知识库消息文本，放进图状态的 `knowledge_digest`。组装层在备课摘要之后把它作为一条 `system` 消息加入。该字段为空字符串时不加入。节点和边不改。消息正文以这段开头：

```text
以下是从这位教师的知识库检索到的段落。回答时若使用了某段内容，写明资料标题。这些段落里没有的内容不要编造出处。
```

每段摘录前写 `资料《标题》：`，摘录之间空一行。

## 接口

全部要求登录。未登录返回 `401`，错误码 `unauthenticated`。资料 id 格式不对、不存在或不属于当前教师，返回 `404` `not_found`。字段不识别、标题不合法、扩展名未登记、文件过大、正文为空、份数或块数超限，返回 `400` `invalid_input`。说明给教师看，不包含路径、堆栈或密钥。错误正文仍是 `error.code`、`message`、`retryable`。

| 方法与路径 | 成功 | 作用 |
| --- | --- | --- |
| `POST /api/knowledge/documents` | `201`，资料对象 | 保存粘贴或上传。抽取成功且已配置模型时，响应之后开始嵌入 |
| `GET /api/knowledge/documents` | `200`，`embedding_model` 与 `documents` | 只列出当前教师的资料和展示状态 |
| `DELETE /api/knowledge/documents/{id}` | `204` | 删除原文、文本和向量 |
| `POST /api/knowledge/documents/{id}/embed` | `202`，资料对象，状态 `pending` | 重新嵌入已抽出文字的资料 |
| `PUT /api/knowledge/embedding-model` | `200`，`{"embedding_model":"..."}` | 保存或清空模型名 |

资料对象含 `document_id`、`title`、`source`、`filename`、`extension`、`status`、`message`、`created_at`。列表里的 `status` 和 `message` 用上一节的展示状态。`GET /api/llm/config` 里环境变量和 `.env` 两个公开对象都增加 `embedding_model`，不含密钥。

## 页面

侧栏按钮文案是「知识库」，登录和忙碌规则与「备课与学情」相同。打开后主区只显示知识库页。

页面列出标题、来源和展示状态。没有资料时显示空状态。列表加载失败时显示可理解的错误。粘贴和上传在请求返回前不能再次提交。删除前确认。`failed` 且已有文本的行提供重试。模型名为空时，页顶可填写并保存模型名。存在 `pending` 资料时每 2 秒重新拉取列表，全部离开 `pending` 或离开页面后停止。

对话区不增加出处面板。出处要求写在给模型的知识库消息里。

## 测试

文件类型、份数上限、属主隔离、删除、展示状态和对话图这些检查使用本地夹具，不访问嵌入接口。检索这一条使用真实嵌入：

- 从运行环境读取 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_EMBEDDING_MODEL`。
- 三项有任一为空时，测试失败，并指出缺少的名字。不改用假向量，也不跳过。
- 测试粘贴一段含独特句子的短资料，等待状态变为 `ready`，最长 60 秒。
- 用包含该独特句子的教师问题组装一轮模型输入。对话补全仍用现有测试替身。
- 断言知识库系统消息含资料标题和该句子。密钥不出现在测试代码、断言或日志里。

前端测试用假的知识库 API，确认按钮在「备课与学情」下面，打开的是知识库页，并且不渲染备课页。

## 验收

1. 教师 A 的资料、原文和向量，教师 B 的列表和对话输入都看不到。
2. `.txt`、`.md`、`.pdf`、`.docx` 和粘贴都能保存。未登记扩展名和超过 10 MB 的文件被拒绝，且不留下资料。
3. 配置了真实嵌入模型后，相关段落进入这一轮的知识库系统消息，并带资料标题。
4. 未配置嵌入模型、没有就绪资料，或提问嵌入失败时，模型输入里没有知识库消息。会话仍可成功。现有对话测试通过。
5. 抽不出文字或嵌入失败时资料仍在，状态为 `failed`。已抽出文字的失败可以重试到 `ready`。
6. 对话图的节点和边不改。备课接口的行为不改。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `AGENTS.md` | 个人知识库进入当前范围 |
| `.env.example` | 空的 `LLM_EMBEDDING_MODEL` |
| `backend/pyproject.toml` | 增加 `pypdf`、`python-docx` |
| `backend/app/config.py` | 读取嵌入模型名 |
| `backend/app/storage/protocol.py` | 资料与分块类型、仓储方法 |
| `backend/app/storage/repository.py` | 两张表和隔离读写 |
| `backend/app/storage/files.py` | 知识库原始文件的生成路径 |
| `backend/app/knowledge/extract.py` | 解析器登记表 |
| `backend/app/knowledge/chunk.py` | 切块 |
| `backend/app/knowledge/embed.py` | 嵌入请求与余弦相似度 |
| `backend/app/knowledge/retrieve.py` | 选择摘录并生成系统消息 |
| `backend/app/api/knowledge.py` | 请求校验 |
| `backend/app/main.py` | 知识库路由；公开配置增加模型名 |
| `backend/app/context/assemble.py` | 备课摘要之后附加知识库消息 |
| `backend/app/graph/state.py` | 增加 `knowledge_digest` |
| `backend/app/tasks/runner.py` | 一轮开始时检索并写入该字段 |
| `frontend/src/components/Sidebar.tsx` | 「知识库」按钮 |
| `frontend/src/components/KnowledgePanel.tsx` | 知识库页 |
| `frontend/src/pages/Workbench.tsx` | 独立视图 |
| `frontend/src/api/http.ts`、`frontend/src/types/api.ts` | 接口与类型 |
| `frontend/src/components/Settings.tsx` | 只显示嵌入模型名 |
| `docs/api-contract.md` | 记录上述路由 |
| 后端与前端测试 | 覆盖上一节 |
