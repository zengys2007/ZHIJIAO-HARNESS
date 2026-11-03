# API/MCPs 列表界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「API/MCPs配置」改成两行摘要列表，点「编辑」行内展开原表单；「添加模型提供商」提示尚未开放。

**Architecture:** 仅改前端 `ApiConfig`：默认渲染提供商行，用 `expanded: "local" | "dotenv" | null` 控制行内展开；探测逻辑按行来源复用现有 `probe`/`loadSources`。不加后端。

**Tech Stack:** React、Vitest、Testing Library、现有 `appearance` 文案表与 CSS 变量。

## Global Constraints

- 不改 `/api/llm/config`、`/api/llm/probe`。
- 不做多提供商持久化；「添加」只 toast「尚未开放」。
- 同时只展开一行。
- 本机环境字段只读；自行填写可改。

---

### Task 1: 列表摘要与行内编辑

**Files:**
- Modify: `frontend/src/lib/appearance.tsx`（新增文案键）
- Modify: `frontend/src/components/Settings.tsx`（`ApiConfig`）
- Modify: `frontend/src/styles.css`（列表/行/虚线添加按钮）
- Modify: `frontend/src/pages/Workbench.test.tsx`（设置相关断言）

**Interfaces:**
- Consumes: `loadLlmSources`, `probeLlm`, `useAppearance().t`
- Produces: 列表 UI；`expanded` 状态；添加按钮触发尚未开放 toast（可用 `role="status"` 或页面内 banner）

- [x] **Step 1: 写失败测试** — 进入 API/MCPs 先看到两行与「编辑」「添加」；点编辑才出现服务地址输入；点添加出现尚未开放。
- [x] **Step 2: 跑测试确认失败**
- [x] **Step 3: 实现列表 + 行内展开 + 样式 + 文案**
- [x] **Step 4: 跑测试通过；`npx tsc --noEmit`**
- [x] **Step 5: 提交**

---

### Task 2: 双来源状态与只展开一行

**Files:**
- Modify: `frontend/src/components/Settings.tsx`
- Modify: `frontend/src/pages/Workbench.test.tsx`

- [x] **Step 1: 测试** — 展开自行填写时再点本机环境编辑，自行填写收起、本机展开；本机输入 disabled。
- [x] **Step 2: 实现每行独立 probeState（或按来源缓存）并保证互斥展开**
- [x] **Step 3: 测试通过并提交**
