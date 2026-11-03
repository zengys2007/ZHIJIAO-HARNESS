# 知识点库：编辑、删除、先修校验、图谱与批量导入

- 日期：2026-11-03
- 状态：已确认（方案 A：在现有名称弱引用结构上扩展，不迁移 schema）
- 上游规格：`docs/superpowers/specs/2026-11-01-teaching-context.md`

## 1. 背景与目标

教学上下文已有知识点的基础能力：按教师隔离的 `knowledge_points` 表（名称/说明/先修名列表）、创建 API、前端「知识点」Tab 单条录入、录成绩时按名自动补建。

本规格补齐四个缺口：

1. **编辑与删除**——已有知识点可改名、改说明、改先修、删除。
2. **先修校验**——先修引用不能成环（含自环）；保存前服务层校验。
3. **图谱展示**——按先修关系分层绘制 SVG 依赖图，同层横排、层间纵排、先修画箭头。
4. **批量导入**——粘贴大纲文本一次建多个点，不预置教材内容（内容由教师提供）。

不做的：先修外键关联表（保持名称弱引用语义）、预置教材大纲、知识点学科/章节维度、拖拽编辑图谱节点。

## 2. 数据模型

不变。沿用 `knowledge_points(id, owner_id, name, description, prerequisites JSON, created_at)`，先修存名称列表。

## 3. 后端 API

全部挂 `/api/teaching`，`require_user` 鉴权，错误沿用 RequestError→400 / ConflictError→409 / NotFoundError→404。

### 3.1 编辑 `PUT /api/teaching/points/{point_id}`

请求体：`{ name, description, prerequisites: string[] }`（校验同创建：名称 1–32 字必填、先修去空去重）。

行为：

- 点不存在或不属于当前教师 → 404。
- 新名与其他点重名 → 409。
- **改名时同步引用**：`score_cells.knowledge_point_name` 与其他点 `prerequisites` 里的旧名一并更新，同一事务。
- 新先修引用不存在的名称 → 沿用现有 `_ensure_knowledge_point` 自动补建（描述为空）。
- **环检测**：提交前对「点→先修」图做 DFS，发现回边即 400，错误消息指明成环链（如「约分 → 通分 → 约分」）。

### 3.2 删除 `DELETE /api/teaching/points/{point_id}`

- 点不存在或不属于当前教师 → 404。
- `score_cells` 中有该点名的成绩记录 → 409「该知识点已有成绩记录，不能删除」。
- 否则删除该点，并从其他点的 `prerequisites` 列表中移除该名称（若因此某点先修为空则存空数组）。

### 3.3 批量导入 `POST /api/teaching/points/batch`

请求体：`{ text: string }`（≤100KB）。每行一个知识点，格式：

```
名称 | 说明 | 先修1,先修2
```

- 分隔符 `|`（全角 `｜` 也接受），说明与先修可空；先修内部分隔 `,，、` 任一。
- 空行与首尾空白行忽略；每行名称截断校验同创建。
- 逐行入库：新名建点（先修引用不存在的名自动补建）；与库内已有（或本批先前）重名则跳过并记入 `skipped`。
- **批量导入不做环检测的事前拦截**（自动补建可能引入环）：导入完成后对本库整图检测，若成环，返回 400 并回滚整批（单事务）。
- 响应：`{ created: n, skipped: [{ line: 行号, name: 名称, reason: "重名" }], ensured_prereqs: [自动补建的先修点名称] }`。

### 3.4 环检测算法（服务层共用）

`app/teaching/cycles.py`：输入 `list[KnowledgePoint]`（含待保存的假想变更），输出 `None` 或成环链 `list[str]`。三色标记 DFS；只遍历能从待检点出发到达的子图即可，但实现上全图检测亦可（点数 ≤ 数百，成本可忽略）。自环（先修含自身）视为环。

## 4. 前端（TeachingPanel「知识点」Tab 增强）

### 4.1 列表项操作

- 每项加「编辑」按钮：展开内联表单（名称/说明/先修三个输入框，预填现值），保存调 `PUT`，成功后刷新 overview；409/400 的错误消息就地展示。
- 每项加「删除」按钮：浏览器 `confirm` 确认后调 `DELETE`；409 时展示「已有成绩记录」提示。

### 4.2 批量导入折叠区

列表区上方「批量导入」`<details>`：多行文本框（placeholder 示范三段格式）→「解析预览」按钮本地解析并显示「将新建 n 个、跳过 m 行（列明细）」→「确认导入」调 batch API，成功后展示 `created / skipped / ensured_prereqs` 摘要并刷新。

### 4.3 图谱视图

Tab 内子视图切换：「列表 / 图谱」。图谱用 SVG 渲染：

- 分层：拓扑排序，无先修的点在第 0 层，点的层级 = 1 + 最深先修层级；有环时（历史数据可能含环）成环点聚到最后一层并标红色描边。
- 布局：同层横排等距，层间固定行距；节点为圆角矩形（名称），先修关系画从前驱指向后继的箭头。
- 交互：点击节点切换到列表视图并展开该点编辑表单。
- 点数 > 60 时提示「点较多，仅展示前 60 个（按创建序）」并截断，避免 SVG 过宽。

### 4.4 文案

所有新增文案接入 `appearance.tsx` 的 zh/en 词表（沿用 `t()` 模式）。

## 5. 错误与边界汇总

| 场景 | 行为 |
|---|---|
| 编辑成环（含自环） | 400，消息含成环链 |
| 删除有成绩的点 | 409 |
| 批量导入整体成环 | 400，整批回滚 |
| 批量文本 >100KB | 400 |
| 图谱点数 >60 | 截断展示 + 提示 |
| 改名与其他点重名 | 409 |

## 6. 测试

后端（`backend/tests/test_teaching.py` 追加或新文件）：

- 编辑：改名同步 score_cells 与他点先修；重名 409；环 400（消息含链）；自动补建新先修。
- 删除：无引用成功且从他点先修移除；有成绩 409；不存在 404；隔离（B 删 A 的点 404）。
- 批量：正常导入含自动补建；重名跳过明细；空行/全角分隔符；成环回滚；超长文本 400。
- 环检测单测：两点半环、自环、深链。

前端（vitest）：

- 编辑表单提交与错误展示。
- 批量导入解析预览（合法/重名/空行）。
- 图谱：少量点的分层渲染、成环点标红。

## 7. 涉及文件

- `backend/app/teaching/cycles.py`（新）
- `backend/app/api/teaching.py`、`backend/app/storage/repository.py`、`backend/app/storage/protocol.py`、`backend/app/main.py`
- `frontend/src/components/TeachingPanel.tsx`、`frontend/src/api/http.ts`、`frontend/src/types/api.ts`、`frontend/src/lib/appearance.tsx`、`frontend/src/styles.css`
- `backend/tests/test_teaching.py`（或新增 `test_knowledge.py`）、`frontend/src/pages/Workbench.test.tsx`（或 TeachingPanel 测试）

## 8. 验收

1. 编辑一个已有成绩的知识点名称后，学情洞察与成绩记录里显示新名。
2. 构造成环先修被 400 拒绝且消息指出环链。
3. 删除有成绩的知识点被拦截并提示原因。
4. 粘贴 5 行大纲文本一次导入，重名行跳过且有明细。
5. 图谱正确分层渲染先修箭头；点击节点可编辑。
6. 既有全部测试（后端 110+、前端 22+）仍通过。
