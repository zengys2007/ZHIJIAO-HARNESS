# 助手回复流式输出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教师在工作台里逐段看见助手正文，任务仍等整段保存成功后才标为成功。

**Architecture:** 教师可见的 `complete` 在带 `sink` 时向上游打开 `stream: true`，把正文片段推进程内 hub。`GET /api/tasks/{task_id}/stream` 用 SSE 把 `snapshot`、`delta`、`reset`、`done`、`error` 推给工作台。摘要不传 `sink`。失败丢掉缓冲，不写助手消息。

**Tech Stack:** Python 3.10、FastAPI、标准库 urllib、React、Vitest。不新增依赖。

## Global Constraints

- 任务状态只有 `pending`、`running`、`succeeded`、`failed`。
- `POST` 消息仍返回 202 和 `task_id`。
- 有 `sink` 时 `stream` 为 true；没有 `sink` 时 `stream` 为 false。`temperature` 为 0.2。`max_tokens` 用该模型的最大输出，读不到时为 128000。
- 工具参数不推给 `sink`。摘要和计划整理不传 `sink`。
- 成功先保存回复再发 `done`。失败先标失败再发 `error`。缓冲不进数据库，`reply` 在成功前为 null。
- 浏览器流断开先重连一次，再不行就轮询任务。预览 API 不实现 `streamTask`。
- 不增加图的节点或边。不记录正文片段或密钥。

---

### Task 1: 进程内 hub

**Files:**
- Create: `backend/app/llm/hub.py`
- Test: `backend/tests/test_hub.py`

**Interfaces:**
- Produces: `hub.open(task_id)`, `hub.sink(task_id)` with `delta(text)` and `reset()`, `hub.listen(task_id)`, `hub.succeed(task_id)`, `hub.fail(task_id, error)`, `hub.iter_events(task_id, load_task)`, `encode_sse(event, data)`

- [x] 写失败测试：后订阅者先拿到全文，再拿到新片段；失败收到 `error` 且不再有正文；成功在标记之后收到 `done`。
- [x] 运行 `pytest tests/test_hub.py -v`，确认失败。
- [x] 实现 hub。
- [x] 再运行同一命令，确认通过。

### Task 2: 流式 complete

**Files:**
- Modify: `backend/app/llm/complete.py`
- Test: `backend/tests/test_llm.py`

**Interfaces:**
- Consumes: `sink.delta` / `sink.reset`
- Produces: `complete(messages, tools, sink=None) -> AssistantMessage | ModelError`

- [x] 测试：无 sink 时 `stream` 为 false；有 sink 时为 true，正文按序进入 `delta`，工具参数只在返回值里。
- [x] 测试：HTTP 错误只请求一次。半截流先 `reset` 再请求第二次，返回第二次的整段。空白正文仍是 `AssistantMessage`，由任务层标 `model_invalid_output`。
- [x] 运行 `pytest tests/test_llm.py -v`，先看失败再实现。

### Task 3: 接入一轮和 SSE

**Files:**
- Modify: `backend/app/graph/model_node.py`
- Modify: `backend/app/tasks/runner.py`
- Modify: `backend/app/main.py`
- Modify: `docs/api-contract.md`
- Modify: 现有假 `complete` 的签名，接受并忽略 `sink`
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: hub 与 `complete(..., sink)`
- Produces: `GET /api/tasks/{task_id}/stream`

- [x] 模型节点把 `hub.sink(task_id)` 传给 `complete`。
- [x] `run_turn` 在 `running` 后 `open`，成功保存后 `succeed`，`_fail` 里 `fail`。
- [x] SSE：属主收到片段和 `done`；别人和未登录分别是 404 和 401；进行中 `reply` 为 null；失败会话没有助手消息。
- [x] 运行 `pytest tests/test_api.py tests/test_hub.py tests/test_llm.py tests/test_graph.py tests/test_runner.py -v`。

### Task 4: 工作台草稿

**Files:**
- Create: `frontend/src/lib/stream.ts`
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/api/http.ts`
- Modify: `frontend/src/pages/Workbench.tsx`
- Test: `frontend/src/lib/stream.test.ts`
- Test: `frontend/src/pages/Workbench.test.tsx`

**Interfaces:**
- Consumes: SSE 事件
- Produces: 可选 `streamTask(taskId)`

- [x] `snapshot` 和 `reset` 替换草稿，`delta` 追加。`done` 后用已保存回复替换。`error` 去掉草稿。
- [x] 流在终态前断开时重连一次，再失败就轮询。没有 `streamTask` 时保持原轮询。
- [x] 草稿期间发送按钮保持禁用。
- [x] 运行 `npm test` 和 `npm run typecheck`。
