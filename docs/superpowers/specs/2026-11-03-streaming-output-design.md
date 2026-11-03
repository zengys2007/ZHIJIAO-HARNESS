# 助手回复流式输出设计（2026-11-03）

状态：已确认（2026-11-03）。教师在工作台里逐字看见助手正文。任务仍要整段保存成功后才标为成功。中途失败不留下助手回复，也不覆盖已成功的回复。本文取代 MVP 路线中「模型请求一律 `stream: false`」的那一条：只有教师可见的模型调用改为 `stream: true`，摘要和计划整理仍是 `stream: false`。

前置文档：[MVP 路线](2026-10-21-mvp-roadmap.md)、[API 契约](../../api-contract.md)

## 目标

发送消息仍立刻返回 `202` 和 `task_id`，生成仍在后台线程里跑。教师能看见的那次模型调用按流读取正文，经 `GET /api/tasks/{task_id}/stream` 推到当前页面。摘要和计划整理仍一次取回整段。

## 范围

### 做

- 教师可见的模型调用使用 Chat Completions 的 `stream: true`，只把助手正文片段推到界面。
- 进程内按 `task_id` 保存已生成正文和当前订阅。缓冲不进数据库，也不出现在 `GET /api/tasks/{task_id}` 的 `reply` 里。
- 工作台在拿到 `task_id` 后订阅这条流，在教师消息下显示草稿。`done` 之后用已保存的整段替换草稿。
- 浏览器流断开时任务继续跑。界面保留草稿并重新订阅一次；订不上就改回现有任务轮询。

### 不做

- 不改任务状态。对外仍只有 `pending`、`running`、`succeeded`、`failed`。
- 不把半段正文写成助手消息，也不写入 `reply`。
- 不流式传输工具参数、摘要、计划整理。
- 不增加 LangGraph 的节点或边，不改停机条件，不编译检查点。
- 不改 `POST /api/conversations/{conversation_id}/messages` 的 `202` 响应。
- 本机服务没接上时的界面预览仍一次给出整句预览回复，不假装逐字生成。
- 不新增超时配置，不记录正文片段或密钥。

## 数据流

1. `POST` 仍创建 `pending` 任务并启动后台线程。同一会话已有 `pending` 或 `running` 任务时仍返回 409。
2. 线程把任务改为 `running` 后，为这个 `task_id` 打开缓冲，再调用现有的 `invoke`。
3. 模型节点仍调用 `complete(messages, tools, sink=None)`。`sink` 来自该任务的缓冲。摘要用的 `complete` 不传 `sink`。
4. 有 `sink` 时请求体 `stream` 为 `true`。没有 `sink` 时 `stream` 为 `false`，行为与现在相同。`temperature` 仍为 0.2。`max_tokens` 用该模型的最大输出，读不到时为 128000。注册表为空时请求仍不带 `tools`。
5. 上游每行 `data:` 是一个 JSON 对象。助手正文位于 `choices[0].delta.content`。非空片段按到达顺序交给 `sink.delta(text)`，并拼进最终的 `AssistantMessage.content`。缺省或空字符串不转发。工具调用位于 `choices[0].delta.tool_calls`，按 `index` 拼好名称和参数，只放进返回值。`data: [DONE]` 结束这一次响应。无法按这个形状读出助手消息时，这一次尝试视为无效输出。响应块里若带 `usage`，仍用现有解析得到 token 数；没有 `usage` 时保持缺省，上下文用量继续用已有的本地估算。
6. 同一次 `complete` 需要第二次请求时，先调用 `sink.reset()` 清空缓冲，再发第二次请求。返回值只含成功那一次的正文和工具调用。
7. 图返回后，成功路径先把非空回复写入任务并标为 `succeeded`，再向订阅者发 `done` 并丢掉缓冲。失败路径先把任务标为 `failed`，再发 `error` 并丢掉缓冲。
8. 一轮里若模型节点被调用多次，各次正文按顺序接在同一缓冲后。`reset` 只发生在同一次 `complete` 的重试之前，不发生在两次模型步骤之间。成功后界面用已保存的最终回复替换草稿。生产注册表为空，教师可见的一轮通常只有一次模型调用。

`sink` 只有两个方法：`reset()` 与 `delta(text: str)`。缓冲是进程内单例，用锁把后台线程的推送交给各条 SSE 连接。模型节点用 `state["task_id"]` 取 `sink`，不把回调放进图状态。

## 接口

`GET /api/tasks/{task_id}/stream`

登录与属主规则与 `GET /api/tasks/{task_id}` 相同。未登录返回 401 `unauthenticated`。任务不存在、不属于当前教师，或 `task_id` 格式不对，返回 404 `not_found`。这两种响应在流开始之前，正文是现有的 JSON 错误。

流本身为 200，`Content-Type: text/event-stream; charset=utf-8`，并带 `Cache-Control: no-cache`。每条事件的 `data` 是一行 JSON。正文里的换行写在 JSON 字符串里。

| 事件 | data | 何时发送 |
| --- | --- | --- |
| `snapshot` | `{"text":"到目前为止的全文"}` | 连接建立时缓冲非空。空缓冲不发 |
| `delta` | `{"text":"这一段新正文"}` | 新的非空正文片段 |
| `reset` | `{}` | 同一次模型调用发出第二次请求之前 |
| `done` | `{}` | 任务已经是 `succeeded` |
| `error` | `{"code":"model_timeout","message":"模型响应超时，可以再发一次。","retryable":true}` | 任务已经是 `failed`。字段与现有错误对象相同 |

连接时任务已经成功：只发 `done` 并关闭。连接时任务已经失败：只发 `error` 并关闭，不发已丢弃的正文。任务仍在 `pending` 或 `running`：先按上表发 `snapshot`，再转发后续事件，直到 `done` 或 `error`。

## 失败与断线

- 上游 HTTP 错误在读到任何正文之前返回，不重试。缓冲保持为空。任务失败类别仍是 `model_upstream`。
- 超时、连接失败，或流无法解析出助手消息时，整次请求再试一次。重试前 `reset`。第二次仍失败时，类别仍是 `model_timeout` 或 `model_invalid_output`。单次尝试的读取使用现有 `llm_timeout_seconds`。
- 拼完后去掉首尾空白为空的正文，仍是 `model_invalid_output`，不标成功。
- 失败的会话读取结果与现在相同：有教师消息和 `error`，没有助手消息。已成功的回复保持不变。
- 浏览器这条流在 `done` 或 `error` 之前断开时，任务继续跑。界面留着已显示的草稿，并立刻重新订阅一次。再次订不上，或第二次连接又在终态事件前断开，就改回 `GET /api/tasks/{task_id}` 轮询。轮询到 `succeeded` 时用已保存回复替换草稿；轮询到 `failed` 时丢掉草稿并显示任务错误。
- 教师没有打开这条流时，生成、保存和现有轮询与现在相同。
- 进程重启后缓冲消失。进行中的任务仍由现有的超时清理标为 `interrupted`，不留下半段回复。
- 草稿显示期间不能再次发送。禁止发送一直保持到任务 `succeeded` 或 `failed`，不在流断开时提前放开。

## 工作台

正式 API 增加 `streamTask(taskId)`，用 `fetch` 读取上述事件，以便在打开流之前识别 401 和 404。预览 API 不实现 `streamTask`。没有这个方法时，工作台保持现有轮询。

有 `streamTask` 时：

- `snapshot` 和 `reset` 用事件中的全文替换草稿。`reset` 的全文为空。
- `delta` 把片段接在草稿后面。
- `done` 之后读取任务和会话，用已保存的助手消息替换草稿。
- `error` 去掉草稿，在这轮教师消息上显示该错误。
- 流中途断开时按上一节重连，再不行就轮询。

## 测试

后端：

- 不传 `sink` 时请求体 `stream` 为 `false`。
- 传入 `sink` 时请求体 `stream` 为 `true`。正文片段按顺序进入 `delta`，函数返回拼好的 `AssistantMessage`。工具参数只出现在返回值里。
- 上游 HTTP 错误只请求一次，`sink` 不留下正文。
- 第一次超时或半截流之后先 `reset` 再请求第二次。第二次成功则返回第二次的整段。第二次仍失败则为 `model_timeout` 或 `model_invalid_output`。
- 空白正文返回 `model_invalid_output`。
- 后连上的订阅者先得到已有全文，再得到新片段。失败时订阅者收到 `error` 且缓冲被清空。成功时在回复写入之后收到 `done`。缓冲不出现在任务的 `reply` 里。
- 属主可以打开流。别人的任务和不存在的任务是 404，未登录是 401。失败的一轮在会话里没有助手消息。

前端：

- `delta` 接在草稿后，`snapshot` 和 `reset` 替换草稿。
- `done` 之后界面改为会话里的已保存回复。`error` 去掉草稿并显示该错误。
- 流在终态前断开时改回轮询：成功显示已保存回复，失败显示任务错误。
- 草稿显示期间不能再次发送。
- 预览 API 仍一次显示整句预览回复。

现有假 `complete(messages, tools)` 改为接受可选的 `sink` 并忽略它。不传 `sink` 的原有断言保持有效。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `backend/app/llm/complete.py` | 可选 `sink`；解析上游 SSE；重试前 `reset` |
| `backend/app/llm/hub.py` | 进程内缓冲、订阅、`snapshot` / `delta` / `reset` / `done` / `error` |
| `backend/app/graph/model_node.py` | 按 `task_id` 取出 `sink` 传给 `complete` |
| `backend/app/tasks/runner.py` | 打开缓冲；成功写入后再 `done`；失败后 `error` |
| `backend/app/main.py` | `GET /api/tasks/{task_id}/stream` |
| `docs/api-contract.md` | 在第 5 节「轮询任务」之后新增「流式任务」，其后节号顺延 |
| `frontend/src/api/http.ts`、`frontend/src/types/api.ts` | `streamTask` |
| `frontend/src/pages/Workbench.tsx` | 草稿、重连一次、回退轮询 |
| 后端与前端测试 | 覆盖上一节的行为 |

## 验收

1. 教师发送后，回复文字在任务仍为 `running` 时逐段出现。
2. 任务只有在整段非空回复保存之后才变为 `succeeded`。`GET` 任务在此之前 `reply` 为 `null`。
3. 模型中途失败或返回空白时，会话里没有这轮助手消息，已成功的回复不变。
4. 刷新后若任务仍在跑，重新订阅能看到已经生成的全文，并继续接到新片段。
5. 浏览器流断开后，任务仍会正常成功或失败；界面最终与任务结果一致。
6. 不传 `sink` 的调用仍是 `stream: false`。图的节点和边不变。
