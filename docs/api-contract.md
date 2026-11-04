# 智教 Harness MVP 接口契约

状态：已确认（2026-10-21）。对话 MVP 已于 2026-10-22 标记完成。2026-10-22 起，对话和模型试连要求登录，规则见第 10 节。2026-11-04 起收录知识库，规则见第 11 节。

本文是对话接口的字段契约。产品行为以 [MVP 路线](superpowers/specs/2026-10-21-mvp-roadmap.md) 为准。知识库行为以 [知识库设计](superpowers/specs/2026-11-04-knowledge-base-design.md) 为准。路径或状态含义有冲突时，先改对应规格，再改本文。

范围包括四个对话接口、第 6 节的任务文字流、当前教师的会话列表、第 8 节的模型试连、第 10 节的注册、登录、退出和当前用户，以及第 11 节的知识库。不包含 `GET /health`、工作台页面，也不包含产物预览、修改和导出。那些路由不在本契约里。

## 1. 共同约定

- 前缀 `/api`。请求和响应正文都是 JSON，`Content-Type: application/json; charset=utf-8`。
- 字符按 Unicode 码位计数，不是字节。教师原文先去掉首尾空白再计数。
- `conversation_id` 和 `task_id` 是 32 位小写十六进制。路径里的标识不符合这个形式，或者库里没有，都返回 `not_found`。
- 成功响应不含 `error`。失败响应只有 `error`，不含部分成功字段。
- `error.message` 使用第 7 节的句子。不含堆栈、绝对路径、密钥和系统提示词。
- 对话、会话列表和模型试连从 Cookie `zhijiao_session` 识别教师。不读取 `Authorization`。未登录返回 401 `unauthenticated`。`GET /health` 不登录。
- 未知字段视为 `invalid_input`。不忽略多出来的字段。

失败正文：

```json
{
  "error": {
    "code": "invalid_input",
    "message": "这句话是空的，或请求格式不对。",
    "retryable": false
  }
}
```

| HTTP | 何时 |
| --- | --- |
| 201 | 创建会话成功 |
| 202 | 消息已接收，任务仍是 `pending` |
| 200 | 读取成功 |
| 400 | `invalid_input` |
| 401 | `unauthenticated` |
| 404 | `not_found` |
| 409 | `conflict` |
| 500 | 请求还没变成任务就失败：`storage_failed` 或 `internal` |

模型超时、空回复、步数用尽和中断发生在任务创建之后。提交接口仍返回 202。工作台用轮询看到 `failed` 和对应的 `error`。

## 2. 创建会话

`POST /api/conversations`

没有正文。带了 JSON 对象时，对象必须是 `{}`。

201：

```json
{
  "conversation_id": "0123456789abcdef0123456789abcdef"
}
```

## 3. 发送消息

`POST /api/conversations/{conversation_id}/messages`

```json
{
  "content": "这节课怎么讲通分"
}
```

| 字段 | 规则 |
| --- | --- |
| `content` | 必填字符串。去掉首尾空白后不能为空。不按 4000 字拒绝；上下文快满时压缩更早的对话，这一句仍放不下时模型看到交接摘要，原文仍保存 |

同一会话已有 `pending` 或 `running` 任务时返回 409，不创建新任务。

202：

```json
{
  "conversation_id": "0123456789abcdef0123456789abcdef",
  "task_id": "fedcba9876543210fedcba9876543210",
  "status": "pending"
}
```

`status` 在这个响应里只有 `pending`。

## 4. 读取会话

`GET /api/conversations/{conversation_id}`

200：

```json
{
  "conversation_id": "0123456789abcdef0123456789abcdef",
  "ask_mode": false,
  "plan_mode": false,
  "plan_status": "off",
  "plan_body": "",
  "messages": [
    {
      "task_id": "fedcba9876543210fedcba9876543210",
      "role": "user",
      "content": "这节课怎么讲通分",
      "status": "succeeded",
      "created_at": "2026-10-21T10:00:00Z"
    },
    {
      "task_id": "fedcba9876543210fedcba9876543210",
      "role": "assistant",
      "content": "可以先用同一块饼分成不同份数。",
      "status": "succeeded",
      "created_at": "2026-10-21T10:00:02Z"
    }
  ]
}
```

`ask_mode` 为 `true` 时，这一会话处于提问模式。它不写进 `messages`。

`plan_mode` 在 `plan_status` 为 `draft` 时为 `true`，其余为 `false`。`plan_status` 是 `off`、`draft` 或 `approved`。`plan_body` 是当前计划正文，去掉首尾空白后的原文。它们都不写进 `messages`。提问和计划互相排斥：打开其中一个会关掉另一个。

`messages` 按 `created_at` 升序。同一任务里，教师消息在助手回复之前。

| 字段 | 规则 |
| --- | --- |
| `role` | `user` 或 `assistant` |
| `content` | 教师原文，或已保存的助手回复 |
| `status` | 该 `task_id` 的任务状态：`pending`、`running`、`succeeded`、`failed` |
| `created_at` | UTC，`YYYY-MM-DDTHH:MM:SSZ` |

出现规则：

- 每个已创建的任务有一条 `user`。
- 只有 `succeeded` 的任务另有一条 `assistant`。`pending`、`running`、`failed` 不出现助手消息。
- `failed` 的 `user` 条目带 `error`。其它条目没有 `error`。
- 不返回系统提示词、工具 schema、其它会话、摘要正文和模型请求原文。

同一响应带 `context`：

| 字段 | 规则 |
| --- | --- |
| `used_tokens` | 最近一次模型请求的 `prompt_tokens + completion_tokens`。还没有请求时，用本地 tiktoken（`o200k_base`，每条消息加 4，整段加 3）估算已提交上下文 |
| `limit_tokens` | 供应商 `GET /models` 里的 `max_model_len`、`context_length` 或 `context_window`。读不到时用 `CONTEXT_TOKEN_LIMIT`，默认 1000000 |
| `limit_source` | `provider` 或 `fallback` |
| `output_tokens` | 这一轮允许生成的最大 token。来自供应商的 `max_completion_tokens`、`max_output_tokens` 或 `output_token_limit`。读不到时为 128000，且不超过 `limit_tokens` |
| `compressed` | 该会话是否已经把更早的成功轮压成摘要。摘要存在会话行上，任务里的原文仍全部返回 |
| `parts` | 各块的本地 token 估算。`name` 为 `system`、`tools`、`context`、`summary`、`ask`、`plan`、`conversation`。`tokens` 为非负整数。系统策略、工具说明、教学资料、交接摘要、提问说明、计划说明和已成功对话分开计数。`ask_mode` 为 `false` 时 `ask` 为 0。`plan_status` 为 `off` 时 `plan` 为 0。输入框草稿由前端另计，不在这个数组里 |

发送前的精确计数走 `POST {LLM_BASE_URL}/responses/input_tokens`。该接口不可用时，压缩判断使用同一套本地 tiktoken 计数。已用 token 达到窗口的 90%，或再加上最大输出 token 后放不下时，更早的成功轮换成交接摘要，最近不超过 20000 token 的整轮原文仍发给模型。最大输出来自供应商，读不到时为 128000，并写入 `output_tokens`。摘要失败时，只从这一轮的模型输入里丢掉最旧的整轮，不删除已保存的任务。

`PUT /api/conversations/{conversation_id}/ask`

正文只有 `{"ask_mode": true}` 或 `{"ask_mode": false}`。打开提问时，计划状态回到 `off`，已有 `plan_body` 保留。别人的会话返回 `not_found`。

200：

```json
{
  "conversation_id": "0123456789abcdef0123456789abcdef",
  "ask_mode": true,
  "plan_mode": false,
  "plan_status": "off",
  "plan_body": ""
}
```

`ask_mode` 为 `true` 时，在交接摘要之后、已成功对话之前挂一条用户消息：「当前处于提问模式：只回答教师的问题，不要交付试题、评语或课件成品。」教师发出的仍是普通消息，回复也按普通助手消息保存。自动压缩不把这句说明写进摘要。关掉之后不再注入。

`PUT /api/conversations/{conversation_id}/plan`

正文是下面三种之一：

- `{"plan_mode": true}` 进入草稿，`false` 退出。退出后保留 `plan_body`。
- `{"plan_body": "..."}` 只在草稿中保存正文。不在草稿时返回 400，`error.message` 为「先进入计划模式再改计划。」
- `{"action": "generate"}` 把非空正文标为 `approved`。正文为空时返回 400，`error.message` 为「还没有可确认的计划，先写出计划再生成。」

计划正文超过 `limit_tokens - output_tokens` 时返回 400，`error.message` 为「这份计划占的上下文已经放不下输出，缩短后再保存。」别人的会话返回 `not_found`。

200：

```json
{
  "conversation_id": "0123456789abcdef0123456789abcdef",
  "plan_mode": true,
  "plan_status": "draft",
  "plan_body": ""
}
```

进入计划草稿时会关掉提问。草稿时，在交接摘要之后、已成功对话之前挂一条用户消息。还没有正文时是：「当前处于计划模式：只修订下面的计划，不要交付试题、评语或课件成品。」已有正文时，这句话下面再附「计划正文：」和正文。成功的助手回复写入 `plan_body`；失败不覆盖上一份正文。`approved` 的下一轮改为挂：「教师已确认下面的计划。请按这份计划生成可直接使用的成品，不要再改写成新计划。」并附上正文。这一轮成功后 `plan_status` 回到 `off`，正文保留，之后不再注入。失败则保持 `approved`。自动压缩不把计划说明写进摘要。

失败的教师消息：

```json
{
  "task_id": "fedcba9876543210fedcba9876543210",
  "role": "user",
  "content": "这节课怎么讲通分",
  "status": "failed",
  "created_at": "2026-10-21T10:00:00Z",
  "error": {
    "code": "model_timeout",
    "message": "模型响应超时，可以再发一次。",
    "retryable": true
  }
}
```

## 5. 轮询任务

`GET /api/tasks/{task_id}`

进行中时建议每 1 秒请求一次。`succeeded` 或 `failed` 后停止。

200，尚未结束：

```json
{
  "task_id": "fedcba9876543210fedcba9876543210",
  "conversation_id": "0123456789abcdef0123456789abcdef",
  "status": "running",
  "step_count": 1,
  "last_event_type": "user_message",
  "reply": null,
  "error": null
}
```

200，成功：

```json
{
  "task_id": "fedcba9876543210fedcba9876543210",
  "conversation_id": "0123456789abcdef0123456789abcdef",
  "status": "succeeded",
  "step_count": 1,
  "last_event_type": "assistant_message",
  "reply": "可以先用同一块饼分成不同份数。",
  "error": null
}
```

200，失败：

```json
{
  "task_id": "fedcba9876543210fedcba9876543210",
  "conversation_id": "0123456789abcdef0123456789abcdef",
  "status": "failed",
  "step_count": 1,
  "last_event_type": "assistant_message",
  "reply": null,
  "error": {
    "code": "model_invalid_output",
    "message": "模型没有返回可用回复，可以再发一次。",
    "retryable": true
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `status` | `pending`、`running`、`succeeded`、`failed` |
| `step_count` | 整数，从 0 开始。每收到一次模型响应加一 |
| `last_event_type` | 还没有事件时为 `null`。否则是 `user_message`、`assistant_message`、`tool_result`、`artifact_published` 之一。生产对话不会出现后两种 |
| `reply` | 仅 `succeeded` 时为非空字符串。其余状态为 `null` |
| `error` | 仅 `failed` 时为错误对象。其余状态为 `null` |

任务失败不删除本会话里已经成功的消息。

## 6. 流式任务

`GET /api/tasks/{task_id}/stream`

登录和属主规则与第 5 节相同。未登录返回 401。任务不存在、不属于当前教师，或 `task_id` 格式不对，返回 404。这两种响应在流开始之前，正文是 JSON 错误。

流本身为 200，`Content-Type: text/event-stream; charset=utf-8`，并带 `Cache-Control: no-cache`。每条事件的 `data` 是一行 JSON。

| 事件 | data | 何时发送 |
| --- | --- | --- |
| `snapshot` | `{"text":"到目前为止的全文"}` | 连接建立时缓冲里已有正文 |
| `delta` | `{"text":"这一段新正文"}` | 新的非空正文片段 |
| `reset` | `{}` | 同一次模型调用发出第二次请求之前。界面清空草稿 |
| `done` | `{}` | 任务已经是 `succeeded`。之后用第 5 节的 `reply` 或第 4 节的会话替换草稿 |
| `error` | 与第 7 节错误对象相同 | 任务已经是 `failed`。不附带已丢弃的正文 |

缓冲只在进程内存里。`GET /api/tasks/{task_id}` 的 `reply` 仍只在 `succeeded` 时为非空字符串。失败不写入助手消息，也不覆盖已成功的回复。

## 7. 错误码

| `error.code` | HTTP，仅当这次请求本身失败 | `retryable` | `error.message` |
| --- | --- | --- | --- |
| `invalid_input` | 400 | 否 | 这句话是空的，或请求格式不对。 |
| `unauthenticated` | 401 | 否 | 请先登录。 |
| `not_found` | 404 | 否 | 没有找到这个会话或任务。 |
| `conflict` | 409 | 否 | 上一条还在处理，请等它结束再发送。 |
| `model_timeout` | 不用于提交响应 | 是 | 模型响应超时，可以再发一次。 |
| `model_invalid_output` | 不用于提交响应 | 是 | 模型没有返回可用回复，可以再发一次。 |
| `model_upstream` | 不用于提交响应 | 是 | 模型服务暂时不可用，可以再发一次。 |
| `step_limit` | 不用于提交响应 | 是 | 这次尝试次数已用完，还没有回复，可以再发一次。 |
| `interrupted` | 不用于提交响应 | 是 | 这次处理被中断了，可以再发一次。 |
| `storage_failed` | 500，或任务上的 `failed` | 是 | 回复没有保存成功，可以再发一次。 |
| `internal` | 500，或任务上的 `failed` | 是 | 系统出错了，可以再发一次。 |

本契约不使用 `needs_clarification` 和 `no_artifact`。

## 8. 试连模型

`GET /api/llm/config` 返回 `environment` 和 `dotenv` 两个公开对象。每个对象含服务地址、对话模型名、`has_api_key`，以及 `embedding_model`。响应里不出现密钥。

`POST /api/llm/probe`

只检查这一次能不能连上模型。不改进程里正在使用的配置，响应里不出现密钥。

本机环境读取进程里的环境变量，不读 `.env` 文件：

```json
{ "source": "local" }
```

自行填写读取项目 `.env`。请求可以只带 `source`，缺的地址、模型和密钥用文件里的值。也可以带上改过的字段；没带 `api_key` 时仍用文件里的密钥：

```json
{ "source": "dotenv" }
```

200：

```json
{ "reachable": true }
```

连不上时同样是 200，`reachable` 为 `false`。字段不合法时仍是 `invalid_input`。

## 9. 实现状态

对话 MVP 已于 2026-10-22 标记完成。四个对话接口、会话列表、模型试连和登录接口已经挂在 `backend/app/main.py`。工作台源码在 `frontend/`，开发入口是 `frontend/index.html`，尚未发送登录 Cookie。画面和文案见 [登录工作台界面](superpowers/specs/2026-10-22-login-frontend.md)。模型适配在 `backend/app/llm/complete.py`。单元测试注入假的 `complete` 和试连函数，不访问真实供应商。

## 10. 登录

登录态是 Cookie `zhijiao_session`。属性为 `HttpOnly`、`SameSite=Lax`、`Path=/`。成功的注册和登录设置这枚 Cookie。退出删除服务端会话并清除 Cookie。

用户名去掉首尾空白后为 1 到 32 个码位，且不含空白。密码为 8 到 128 个码位。显示名去掉首尾空白后为 1 到 32 个码位，中间可以有空格。`local-admin` 不能注册。

| 情况 | HTTP | `error.code` | `error.message` |
| --- | --- | --- | --- |
| 用户名不合法 | 400 | `invalid_input` | 用户名写成 1 到 32 个字，中间不要有空格。 |
| 密码不合法 | 400 | `invalid_input` | 密码写成 8 到 128 个字。 |
| 显示名不合法 | 400 | `invalid_input` | 显示名写成 1 到 32 个字。 |
| 多出来的字段 | 400 | `invalid_input` | 请求里有不能识别的字段。 |
| 用户名或密码不正确 | 400 | `invalid_input` | 用户名或密码不正确。 |
| 用户名已存在，或使用 `local-admin` | 409 | `conflict` | 这个用户名已经有人使用。 |
| 未登录 | 401 | `unauthenticated` | 请先登录。 |

对话忙时的 `conflict` 句子不变。别人的会话和任务返回第 7 节的 `not_found`。

### 10.1 注册

`POST /api/auth/register`

```json
{ "username": "teacher", "password": "correct-horse", "display_name": "王老师" }
```

`display_name` 可省略，省略时等于处理后的用户名。201：

```json
{
  "user_id": "0123456789abcdef0123456789abcdef",
  "username": "teacher",
  "display_name": "王老师",
  "remember_token": "设备令牌，只在这一次响应里出现"
}
```

`remember_token` 是记住此设备的令牌。前端只放在本机账号记录里，不写入日志。没有这个字段时，切换该账号仍要输入密码。

### 10.2 登录

`POST /api/auth/login`

```json
{ "username": "teacher", "password": "correct-horse" }
```

成功时 200，正文与注册相同，并设置 Cookie。字段缺失或类型不对时，用第 10 节对应字段的句子。

### 10.2.1 免密恢复

`POST /api/auth/resume`

```json
{ "remember_token": "上一次登录或恢复返回的令牌" }
```

令牌有效时 200，正文与登录相同，并设置新的 Cookie。旧令牌立即作废，响应里的 `remember_token` 是下一枚。令牌缺失、过期或不存在时 401，`error.code` 为 `unauthenticated`。空令牌或超长令牌是 400，`error.message` 为「令牌写成 1 到 128 个字。」

### 10.3 退出

`POST /api/auth/logout`。没有正文。已登录时 204，没有正文。未登录时 401，并清除 Cookie。

### 10.4 当前用户

`GET /api/auth/me`。已登录时 200，正文只有 `user_id`、`username`、`display_name`，不含 `remember_token`。

### 10.5 会话列表

`GET /api/conversations`。只返回当前教师的会话。已置顶的在前，按 `pinned_at` 从新到旧；未置顶的在后，按 `created_at` 降序，相同时按 `conversation_id` 降序。

```json
{
  "conversations": [
    {
      "conversation_id": "0123456789abcdef0123456789abcdef",
      "title": "这节课怎么讲通分",
      "created_at": "2026-10-22T02:00:00Z",
      "pinned": false
    }
  ]
}
```

`pinned` 表示该会话是否置顶。`title` 在第一轮成功前是「新对话」。第一轮成功后取该轮教师消息的第一行，超过 18 个码位时保留前 18 个并加上 `…`。尚未成功的消息不参与标题，之后的轮次也不改标题。计划模式不改变标题。

`PUT /api/conversations/{conversation_id}/pin`。正文只有 `{"pinned": true}` 或 `{"pinned": false}`。再次置顶会刷新置顶时间，排到置顶区最前。成功 200，正文是 `conversation_id` 和 `pinned`。正文不对返回 400 `invalid_input`。别人的会话或不存在的会话返回 404 `not_found`。正在生成回复时也可以置顶或取消。

`DELETE /api/conversations/{conversation_id}`。成功 204，没有正文。同一次事务删除该会话、它的任务和这些任务的事件；任务关联的产物连同版本和已存文件一起删除。班级、成绩、教案不删除。有 `pending` 或 `running` 任务时返回 409 `conflict`，`error.message` 为「这条会话还在回复，等它结束再删除。」别人的会话或不存在的会话返回 404 `not_found`。

创建会话时写入当前教师。读取、发送、置顶、删除和轮询只面对该教师的记录。

## 11. 知识库

登录规则与第 1 节相同，从 Cookie `zhijiao_session` 识别教师。未登录返回 401 `unauthenticated`。资料 `document_id` 是 32 位小写十六进制。格式不对、不存在或不属于当前教师，都返回 404 `not_found`，`error.message` 为「没有找到这份资料。」字段不识别、标题不合法、扩展名未登记、文件过大、正文为空、份数或块数超限、没有可重新嵌入的文字，以及项目 `.env` 不存在，返回 400 `invalid_input`。说明给教师看，不包含路径、堆栈或密钥。错误正文仍是 `error.code`、`message`、`retryable`。

粘贴和保存模型名的正文是 JSON。上传是 `multipart/form-data`。删除成功没有正文。

| 方法与路径 | 成功 | 作用 |
| --- | --- | --- |
| `POST /api/knowledge/documents` | `201`，资料对象 | 保存粘贴或上传。抽取成功且已配置模型名时，响应之后开始嵌入 |
| `GET /api/knowledge/documents` | `200`，`embedding_model` 与 `documents` | 只列出当前教师的资料和展示状态 |
| `DELETE /api/knowledge/documents/{id}` | `204` | 删除原文、文本和向量 |
| `POST /api/knowledge/documents/{id}/embed` | `202`，资料对象，状态 `pending` | 重新嵌入已抽出文字的资料 |
| `PUT /api/knowledge/embedding-model` | `200`，`{"embedding_model":"..."}` | 保存或清空模型名 |

资料对象：

```json
{
  "document_id": "0123456789abcdef0123456789abcdef",
  "title": "课堂笔记",
  "source": "paste",
  "filename": "",
  "extension": "",
  "status": "pending",
  "message": "",
  "created_at": "2026-11-04T02:00:00Z"
}
```

| 字段 | 规则 |
| --- | --- |
| `document_id` | 32 位小写十六进制 |
| `title` | 去掉首尾空白后为 1 到 64 个码位 |
| `source` | `paste` 或 `upload` |
| `filename` | 粘贴为 `""`。上传为去掉路径后的原始文件名，只用于显示 |
| `extension` | 粘贴为 `""`。上传为 `.txt`、`.md`、`.pdf`、`.docx` 之一 |
| `status` | `pending`、`ready` 或 `failed`。列表、创建和重新嵌入的响应都用展示状态 |
| `message` | 给教师看的说明。没有说明时为 `""` |
| `created_at` | UTC，`YYYY-MM-DDTHH:MM:SSZ` |

展示状态：存储已是 `ready`，但分块上的模型名与当前 `LLM_EMBEDDING_MODEL` 不同，或当前模型名为空，列表和资料对象里的 `status` 为 `pending`。模型名为空时 `message` 为「尚未配置嵌入模型，检索暂停」。模型名更换后 `message` 为「嵌入模型已更换，请重新生成向量」。这两种情况不把存储状态改成 `failed`。存储还不是 `ready` 时，展示直接使用存储里的 `status` 和 `message`。

`embedding_model` 出现在列表响应里，也出现在 `GET /api/llm/config` 的 `environment` 和 `dotenv` 两个对象里。这三处都不包含密钥。

服务端调用嵌入时，`LLM_EMBEDDING_BASE_URL` 与 `LLM_EMBEDDING_API_KEY` 都非空则用这一对；任一为空则地址和密钥沿用 `LLM_BASE_URL` 与 `LLM_API_KEY`。知识库接口不读写这两对地址和密钥，响应里也不出现它们的值。

### 11.1 保存资料

`POST /api/knowledge/documents`

粘贴正文只有这两个字段：

```json
{ "title": "课堂笔记", "content": "分数先通分再比较。" }
```

`title` 和 `content` 都必填，且都是字符串。上传的 `Content-Type` 为 `multipart/form-data`。文件字段名是 `file`，必须带文件名。标题字段 `title` 可省略；省略或去掉首尾空白后为空时，用文件名去掉扩展名后的文字做标题，仍须满足标题长度。类型只看文件名扩展名。一位教师最多 50 份，失败的也计入。粘贴正文去掉首尾空白后不能为空，最长 200000 个字符。上传不超过 10 MB。

201 的正文是上面的资料对象。粘贴的 `source` 为 `paste`，`filename` 和 `extension` 为 `""`。上传的 `source` 为 `upload`。抽出文字且已配置模型名时，响应当时 `status` 为 `pending`，响应返回之后才在本进程后台嵌入。模型名为空时仍保存资料，不开始嵌入。`.txt` 或 `.md` 按 UTF-8 读不出时再按 gb18030；两种都失败则不保存。`.pdf` 和 `.docx` 抽出的文字去掉首尾空白后为空时仍保存，201 的 `status` 为 `failed`，`message` 为「这个文件里没有抽出文字」。

### 11.2 读取列表

`GET /api/knowledge/documents`。没有正文。200：

```json
{
  "embedding_model": "embed-small",
  "documents": []
}
```

`embedding_model` 是当前进程里的 `LLM_EMBEDDING_MODEL`，没有配置时为 `""`。`documents` 只含当前教师的资料，按 `created_at` 升序，相同时按 `document_id` 升序。每项都是资料对象，`status` 和 `message` 为展示状态。

### 11.3 删除资料

`DELETE /api/knowledge/documents/{id}`。没有正文。成功 204，没有正文，并删除该资料的原文、文本和向量。别人的资料、不存在的资料，或 `id` 不是 32 位小写十六进制，返回 404。

### 11.4 重新嵌入

`POST /api/knowledge/documents/{id}/embed`。没有正文。资料已经抽出文字时，先把存储状态改为 `pending`，再返回 202 和资料对象，`status` 为 `pending`，然后在本进程后台嵌入。同一资料已有后台嵌入在跑时，再次调用仍返回 202 和当前资料对象，不把状态重写一遍，也不启动第二份工作。没有分块时返回 400，`error.message` 为「这份资料没有抽出文字，请重新上传或粘贴。」别人的资料和不存在的资料返回 404。

### 11.5 嵌入模型名

`PUT /api/knowledge/embedding-model`

正文只有 `model`：

```json
{ "model": "embed-small" }
```

`model` 为 `""` 时清空。非空时为 1 到 200 个码位，且不含空白。200：

```json
{ "embedding_model": "embed-small" }
```

已有项目 `.env` 时，只替换或追加 `LLM_EMBEDDING_MODEL` 这一行，并写入进程环境。不改写文件里的其他行，不改写地址或密钥，响应里也不返回密钥。`.env` 不存在时返回 400，`error.message` 为「请先准备 .env 文件。」，并且不创建该文件。

| 情况 | HTTP | `error.message` |
| --- | --- | --- |
| 未登录 | 401 | 请先登录。 |
| 多出来的字段，粘贴字段不是字符串，或上传格式不对 | 400 | 请求里有不能识别的字段。 |
| JSON 无法解析 | 400 | 这句话是空的，或请求格式不对。 |
| 标题不合法 | 400 | 标题写成 1 到 64 个字。 |
| 粘贴正文为空 | 400 | 正文去掉首尾空白后不能为空。 |
| 粘贴正文超过 200000 个字符 | 400 | 正文最长 200000 个字符。 |
| 扩展名未登记 | 400 | 扩展名不在登记表里。 |
| 上传没有文件名 | 400 | 没有文件名。 |
| 文件超过 10 MB | 400 | 文件不能超过 10 MB。 |
| `.txt` 或 `.md` 两种编码都失败 | 400 | 文件须能按 UTF-8 或 gb18030 读取。 |
| 已有 50 份 | 400 | 最多保存 50 份资料。 |
| 超过 200 块 | 400 | 内容超过 200 块，请拆成多份。 |
| 重新嵌入时没有分块 | 400 | 这份资料没有抽出文字，请重新上传或粘贴。 |
| 模型名不合法 | 400 | 模型名留空表示清空；填写时写成 1 到 200 个不含空白的字符。 |
| 项目 `.env` 不存在 | 400 | 请先准备 .env 文件。 |
| 资料 id 不对、不存在，或不属于当前教师 | 404 | 没有找到这份资料。 |
