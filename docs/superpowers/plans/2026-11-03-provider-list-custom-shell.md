# 自定义提供商列表壳 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉「自行填写」；支持 localStorage 自定义提供商的添加/编辑/删除；本机行保留。

**Architecture:** `ApiConfig` 只保留本机一行 + `customProviders` 状态；读写 `zhijiao.providers:v1`。添加用简易对话框；编辑复用现有展开面板（本机只读，自定义可保存）。模型浮层不改契约。

**Tech Stack:** React、localStorage、Vitest、appearance 文案。

## Global Constraints

- 不写 `.env`、不改后端多提供商。
- 模型浮层只列本机。
- 本机不可删除。

---

### Task 1: 存储 + 列表 UI（去自行填写、添加/删）

**Files:**
- Create: `frontend/src/lib/providers.ts`（类型、load/save）
- Modify: `Settings.tsx`、`appearance.tsx`、`styles.css`、`Workbench.test.tsx`

- [ ] 测试：无自行填写；可添加一行；删除消失；刷新（localStorage）仍在。
- [ ] 实现存储与列表/对话框。
- [ ] vitest + tsc；提交。

### Task 2: 自定义行编辑保存

- [ ] 测试：编辑自定义行改名称/地址后保存，再打开仍是新值；取消还原。
- [ ] 实现草稿与 save 写回 localStorage。
- [ ] 测试通过并提交。
