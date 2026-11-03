# 提供商编辑展开面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 API/MCPs「编辑」展开区改成密钥 + 自定义设置（地址）+ 单行模型目录 + 取消/保存的参考图版式。

**Architecture:** 只改 `ApiConfig` 的 `renderEditor` 与样式/文案；探测与双来源逻辑不变。取消时还原打开时的自行填写草稿；保存/添加模型 toast 尚未开放。

**Tech Stack:** React、Vitest、Testing Library、appearance 文案、CSS。

## Global Constraints

- 不改后端与 `/api/llm/*`。
- 不做多模型持久化；添加/删除/保存 →「尚未开放」。
- 本机字段 disabled；展开区不单独放联通行。

---

### Task 1: 编辑面板版式与交互

**Files:**
- Modify: `frontend/src/lib/appearance.tsx`
- Modify: `frontend/src/components/Settings.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/pages/Workbench.test.tsx`

- [ ] **Step 1:** 更新测试——编辑后见 API 密钥、自定义设置、模型目录、取消/保存；本机 disabled；添加模型尚未开放；取消还原自行填写草稿。
- [ ] **Step 2:** 实现展开面板、文案、样式、草稿快照。
- [ ] **Step 3:** vitest + tsc 通过并提交。
