# 智教 Harness MVP 接口契约

状态：已确认（2026-10-21）。对话 MVP 已于 2026-10-22 标记完成。2026-10-22 起，对话和模型试连要求登录，规则见第 9 节。

本文是对话接口的字段契约。产品行为以 [MVP 路线](superpowers/specs/2026-10-21-mvp-roadmap.md) 为准。路径或状态含义有冲突时，先改路线，再改本文。

范围包括四个对话接口、当前教师的会话列表、第 7 节的模型试连，以及第 9 节的注册、登录、退出和当前用户。不包含 `GET /health`、工作台页面，也不包含产物预览、修改和导出。那些路由不在本契约里。

## 1. 共同约定

- 前缀 `/api`。请求和响应正文都是 JSON，`Content-Type: application/json; charset=utf-8`。
- 字符按 Unicode 码位计数，不是字节。教师原文先去掉首尾空白再计数。
- `conversation_id` 和 `task_id` 是 32 位小写十六进制。路径里的标识不符合这个形式，或者库里没有，都返回 `not_found`。
- 成功响应不含 `error`。失败响应只有 `error`，不含部分成功字段。
- `error.message` 使用第 6 节的句子。不含堆栈、绝对路径、密钥和系统提示词。
- 对话、会话列表和模型试连从 Cookie `zhijiao_session` 识别教师。不读取 `Authorization`。未登录返回 401 `unauthenticated`。`GET /health` 不登录。
- 未知字段视为 `invalid_input`。不忽略多出来的字段。

失败正文：

```json
{
  "error": {
    "code": "invalid_input",
    "message": "请把这句话写成 1 到 4000 字后再发送。",
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
| `content` | 必填字符串。去掉首尾空白后为 1 到 4000 个码位 |

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
- 不返回系统提示词、工具 schema、其它会话和模型请求原文。

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

## 6. 错误码

| `error.code` | HTTP，仅当这次请求本身失败 | `retryable` | `error.message` |
| --- | --- | --- | --- |
| `invalid_input` | 400 | 否 | 请把这句话写成 1 到 4000 字后再发送。 |
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

## 7. 试连模型

`GET /api/llm/config` 只返回两边的服务地址、模型名，以及是否已有密钥。响应里不出现密钥。

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

## 8. 实现状态

对话 MVP 已于 2026-10-22 标记完成。四个对话接口、会话列表、模型试连和登录接口已经挂在 `backend/app/main.py`。工作台源码在 `frontend/`，开发入口是 `frontend/index.html`，尚未发送登录 Cookie。画面和文案见 [登录工作台界面](superpowers/specs/2026-10-22-login-frontend.md)。模型适配在 `backend/app/llm/complete.py`。单元测试注入假的 `complete` 和试连函数，不访问真实供应商。

## 9. 登录

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

对话忙时的 `conflict` 句子不变。别人的会话和任务返回第 6 节的 `not_found`。

### 9.1 注册

`POST /api/auth/register`

```json
{ "username": "teacher", "password": "correct-horse", "display_name": "王老师" }
```

`display_name` 可省略，省略时等于处理后的用户名。201：

```json
{
  "user_id": "0123456789abcdef0123456789abcdef",
  "username": "teacher",
  "display_name": "王老师"
}
```

### 9.2 登录

`POST /api/auth/login`

```json
{ "username": "teacher", "password": "correct-horse" }
```

成功时 200，正文与注册相同，并设置 Cookie。字段缺失或类型不对时，用第 9 节对应字段的句子。

### 9.3 退出

`POST /api/auth/logout`。没有正文。已登录时 204，没有正文。未登录时 401，并清除 Cookie。

### 9.4 当前用户

`GET /api/auth/me`。已登录时 200，正文与注册相同。

### 9.5 会话列表

`GET /api/conversations`。只返回当前教师的会话，按 `created_at` 降序，相同时按 `conversation_id` 降序。

```json
{
  "conversations": [
    {
      "conversation_id": "0123456789abcdef0123456789abcdef",
      "title": "这节课怎么讲通分",
      "created_at": "2026-10-22T02:00:00Z"
    }
  ]
}
```

`title` 取最早一条教师消息的第一行，超过 18 个码位时保留前 18 个并加上 `…`。还没有消息时为「新对话」。

创建会话时写入当前教师。读取、发送和轮询只面对该教师的记录。
