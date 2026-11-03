# 加号「模型」浮层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加号「模型」打开可搜索的会话模型浮层；选中后发消息带 `llm_source`，后端该轮用对应本机/dotenv 配置。

**Architecture:** 前端 `Workbench` 持有 `llmSource` 与浮层开关，`ModelPicker` 拉 `/api/llm/config` 列表；`sendMessage` 可选附带 `llm_source`。后端 `parse_message` 解析可选字段；有 source 时在工作线程用本轮 `build_graph(make_complete(...))`，不改全局默认 graph。

**Tech Stack:** FastAPI、现有 `make_complete`/`process_llm`/`dotenv_llm`、React、Vitest、Testing Library。

## Global Constraints

- 未传 `llm_source` 时行为与现在完全一致。
- 缺项不静默回退；非法 source → `400 invalid_input`。
- 不写 `.env`、不改 API/MCPs 列表页、不改造输入框底栏胶囊。
- 未配齐来源不展示该组；刷新可丢选中状态。

## File map

| File | Responsibility |
| --- | --- |
| `backend/app/api/messages.py` | `parse_message` → `(content, llm_source \| None)` |
| `backend/app/main.py` | 解析后建本轮 graph 并交给 `run_turn` |
| `backend/app/llm/complete.py`（按需） | 从 values 建 complete，或复用 `Settings` |
| `frontend/src/components/ModelPicker.tsx` | 搜索 + 分组列表浮层 |
| `frontend/src/components/PlusMenu.tsx` | `onOpenModel` 仅回调，不再假定进设置 |
| `frontend/src/pages/Workbench.tsx` | 状态、打开浮层、发送带 source |
| `frontend/src/api/http.ts` + `types/api.ts` + `preview.ts` | `sendMessage` 第三参可选 |
| `frontend/src/lib/appearance.tsx` + `styles.css` | 文案与浮层样式 |
| 测试 | `test_api`/`messages` 单元；`Workbench.test` |

---

### Task 1: 后端消息解析与按 source 建本轮 complete

**Files:**
- Modify: `backend/app/api/messages.py`
- Modify: `backend/app/main.py`（`create_message`）
- Modify: `backend/app/llm/complete.py`（若需 `make_complete_from_values`）
- Test: `backend/tests/test_api.py` 或新增小测 `test_messages.py`

**Interfaces:**
- Produces: `parse_message(body) -> tuple[str, str | None]`；`llm_source in {None, "local", "dotenv"}`
- Consumes: `process_llm()`, `dotenv_llm(env_file)`, `make_complete`, `build_graph`, `load_system_prompt`

- [ ] **Step 1:** 测试 — body 仅 content 仍 202；带 `llm_source:"dotenv"` 且 .env 齐全时用 dotenv 的 model（可用 mock complete 记录 settings）；缺 key 或非法 source → 400；多余键 → 400。
- [ ] **Step 2:** 改 `parse_message`；`create_message` 解析 source、校验配置、本轮 `build_graph` 传入线程。
- [ ] **Step 3:** 跑相关 pytest 通过并提交。

---

### Task 2: 前端 API 契约与 ModelPicker UI

**Files:**
- Create: `frontend/src/components/ModelPicker.tsx`
- Modify: `frontend/src/types/api.ts`、`http.ts`、`preview.ts`
- Modify: `frontend/src/lib/appearance.tsx`、`styles.css`
- Modify: `frontend/src/components/PlusMenu.tsx`（行为不变，仅由父级改回调）
- Modify: `frontend/src/pages/Workbench.tsx`
- Modify: `frontend/src/pages/Workbench.test.tsx`

**Interfaces:**
- `sendMessage(id, content, options?: { llmSource?: "local" | "dotenv" })`
- `ModelPicker`: `{ open, selected, onSelect, onClose, loadSources }`

- [ ] **Step 1:** 改测试 — 加号→模型出现「搜索模型」与分组；勾选；发送 body 含 `llm_source`；不再断言打开设置 API/MCPs。
- [ ] **Step 2:** 实现 ModelPicker、文案、样式；Workbench 接线；http/preview 传参。
- [ ] **Step 3:** `npx vitest` 相关 + `npx tsc --noEmit`；提交。

---

### Task 3: 收尾核对

- [ ] 手动或测试：未选 source 发送仍成功；只配一端时浮层只显示一组。
- [ ] 更新本 plan 复选框；必要时补一句架构文档交叉引用（可选，非必须）。
