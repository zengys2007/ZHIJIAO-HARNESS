# 目标与计划管理设计

状态：已确认（2026-10-31，用户逐项确认：AI 辅助拆解、初中 9 科课标骨架、打印 HTML 导出、显式定稿快照、产物关联延后、同学期多份目标树）。

前置文档：[后续路线](2026-10-21-later-roadmap.md)、[登录设计](2026-10-22-login-design.md)

## 0. 定位与决策记录

本模块服务中学教师的教学大纲编制与管理：学期总目标 → 单元目标 → 课时计划三层级，按学科/年级/学期组织，支持目标拆解、计划-目标映射、打印导出与定稿版本。

用户已确认的决策：

| 决策点 | 结论 |
| --- | --- |
| AI 角色 | CRUD 管理为主体；提供「AI 拆解建议」独立端点，建议只作草稿，老师采纳后才入库。不改动对话图与工具注册表（`llm/probe.py` 已有图外调模型先例） |
| 课标模板 | 初中 9 科（语文、数学、英语、物理、化学、生物、历史、地理、道德与法治）结构化骨架，按 2022 版课标提炼领域/主题/素养维度，不含课标原文（篇幅与版权） |
| 导出格式 | 打印友好 HTML，浏览器直接打印或另存 PDF。不做 Office 格式 |
| 版本语义 | 显式定稿快照：老师点「定稿」生成不可变快照，可回看、恢复；日常编辑不记版本 |
| 产物关联 | 计划条目与已发布产物（网页/讲义）的关联延后到 `compose_lesson` 阶段 |
| 目标树数量 | 同一教师同一学科/年级/学期允许多份目标树并存（草稿、平行方案），无唯一约束 |

架构采用独立领域模块：后端新增 `app/goals/` 领域与 `app/api/goals.py`，存储进现有 SQLite 仓储；前端在 Workbench 内加视图切换。不复用任务/产物体系（目标树是需频繁局部编辑的结构化层级数据，与「四态任务 + 一轮一候选 + 不可变文件版本」语义冲突）。

## 1. 数据模型

新增 4 张表，进 `backend/app/storage/repository.py` 现有 SQLite；1 份内置模板为代码常量。

### goal_trees（目标树 = 一份教学大纲）

| 列 | 说明 |
| --- | --- |
| id | TEXT 主键 |
| owner_id | 属主，外键 users |
| subject / grade / term | 学科 / 年级（7、8、9）/ 学期（上、下） |
| title | 标题，如「七上数学-草稿」 |
| created_at / updated_at | 时间戳 |

无 `owner_id+subject+grade+term` 唯一约束：同学期允许多份（用户确认）。不做「主大纲」标记与归档位，用标题区分。

### goal_nodes（目标节点，三级层级）

| 列 | 说明 |
| --- | --- |
| id | TEXT 主键 |
| tree_id | 外键 goal_trees |
| parent_id | 外键 goal_nodes，可空 |
| level | `semester` / `unit` / `lesson` |
| title / description | 标题与描述 |
| standard_refs | 课标骨架维度引用，JSON 数组 |
| verify_criteria | 可验证达成标准 |
| sort_order / created_at / updated_at | 排序与时间戳 |

层级规则（服务端强校验）：

- `semester`（学期总目标，多条平行）与 `unit`（单元）的 parent 为空，挂根下；`lesson`（课时目标）的 parent 必须是 `unit`
- 数量上限：每树 semester ≤ 20、unit ≤ 30、每 unit 下 lesson ≤ 40

UI 在树根下分组渲染「学期总目标」与「单元」两组；数据层仅靠 level 区分。

### plan_entries（课时计划条目）

| 列 | 说明 |
| --- | --- |
| id | TEXT 主键 |
| owner_id / tree_id | 属主与所属树 |
| week_no / weekday / period | 教学周 / 星期 / 节次 |
| topic / activities / note | 课题 / 活动描述 / 备注 |
| status | `planned` / `done` / `adjusted` |
| sort_order / created_at / updated_at | 排序与时间戳 |

周/月/学期视图由 week_no 聚合得出，不单独建视图表。

### plan_goal_links（计划↔目标映射）

`plan_entry_id` + `goal_node_id` 联合主键，多对多。计划条目可关联任意层级节点（semester/unit/lesson）；追踪视图由 lesson → unit → semester 逐级汇总。

### goal_snapshots（定稿快照，不可变）

| 列 | 说明 |
| --- | --- |
| id / tree_id / version | 主键 / 所属树 / 版本号，UNIQUE(tree_id, version) |
| payload | 整树节点 + 计划条目 + 映射的 JSON 序列化 |
| note / created_at | 定稿说明与时间 |

恢复 = 把快照内容写回活动表成为新编辑态；快照本身永不修改。

### 内置课标骨架（app/goals/templates.py，代码常量，不进库）

9 科 × {领域 → 主题 → 素养维度 + 参考表述句式}。创建目标时可选取维度预填 description 与 verify_criteria 草稿，老师改写。

## 2. API 契约

`/api` 前缀，复用现有 Cookie 鉴权（require_user）与 `api/errors.py` 错误正文。

| 端点 | 用途 |
| --- | --- |
| `GET /api/goal-trees?subject=&grade=&term=` | 列表，按属主过滤；同学期多份全返回，按 updated_at 排序 |
| `POST /api/goal-trees` | 创建；可选 `template_init: true` 按学科素养维度预填学期总目标草稿（semester 层），单元与课时由老师或 AI 拆解生成，不自动建 |
| `GET /api/goal-trees/{id}` | 整树读取（节点 + 计划 + 映射一次返回） |
| `PATCH /api/goal-trees/{id}` | 改标题等元信息 |
| `DELETE /api/goal-trees/{id}` | 删整树（连带节点、计划、映射、快照） |
| `POST /api/goal-trees/{id}/nodes` | 创建目标节点；服务端按 parent 校验层级与数量 |
| `PATCH /api/goal-nodes/{node_id}` | 改目标内容 |
| `DELETE /api/goal-nodes/{node_id}` | 有子节点或被计划引用时返回 409 |
| `POST /api/goal-nodes/{node_id}/suggest` | AI 拆解建议（第 3 节） |
| `POST /api/goal-trees/{id}/plan-entries` | 创建计划条目，携带 `goal_node_ids[]` 建映射 |
| `PATCH /api/plan-entries/{id}` | 改条目与映射（全量替换 `goal_node_ids[]`） |
| `DELETE /api/plan-entries/{id}` | 删条目与映射 |
| `GET /api/goal-trees/{id}/export?scope=week\|month\|term&anchor=YYYY-MM-DD` | 打印 HTML，新标签页打开 |
| `POST /api/goal-trees/{id}/snapshots` | 定稿，生成下一版本号快照 |
| `GET /api/goal-trees/{id}/snapshots` | 快照列表 |
| `POST /api/goal-trees/{id}/snapshots/{version}/restore` | 恢复到编辑态 |

错误码沿用 `api/errors.py` 现有定义：层级/数量违规 → 400 `invalid_input`；删除被引用节点 → 409 `conflict`；跨属主 → 404 `not_found`（不泄露存在性）；未登录 → 401 `unauthenticated`；AI 建议失败 → `model_timeout` / `model_upstream` / `model_invalid_output`（输出不合规 JSON 时）。

## 3. AI 拆解建议

- 输入：目标节点 + 祖先链 + 学科/年级/学期 + 对应课标骨架片段；body 可带 `focus` 补充说明
- 执行：单轮调用 `app/llm/complete.py`（`tools=[]`），系统提示要求仅输出 JSON 子目标数组（title / description / verify_criteria）
- 输出：建议草稿数组返回前端，不入库。前端展示草稿卡片，老师逐条采纳/改写/丢弃；采纳走普通创建端点
- 上限：≤ 10 条建议、每条 ≤ 2000 字；模型输出仅作草稿文本，不执行任何指令
- 失败：返回 `model_upstream` / `model_timeout`，可重试，不阻塞手工编制

## 4. 前端信息架构

不引入路由库，沿用单页 + 视图状态切换（conversation | goals | plans），对话为默认视图。

- 入口：Workbench 顶栏新增「目标」「计划」菜单项（图标 + 中文 + 英文小字 + 灰色说明），样式对齐用户提供的参考图
- GoalsView：左栏目标树（学期总目标 / 单元两组，三级折叠，上下移按钮排序，不做拖拽）；右栏节点详情（标题/描述/课标维度/验证标准）+ 模板参考侧板；「AI 拆解」按钮在 semester 与 unit 节点可用（总目标→单元、单元→课时）
- PlansView：周（教学周表格）/ 月（日历聚合）/ 学期（单元进度总览）三粒度切换；条目编辑抽屉含目标关联 chips 选择器；目标详情反向显示「被哪些课时覆盖」构成效果追踪
- 版本与导出：GoalsView/PlansView 顶栏「定稿」「历史版本」「导出」；导出新标签页打开打印 HTML
- 目标树列表：呈现同学期多份形态，标题 + updated_at 区分

## 5. 错误处理与边界

- 层级违规、超数量上限、删除被引用节点 → 409/400 带明确中文报文
- AI 建议失败不阻塞手工编制
- 并发编辑：单教师场景 last-write-wins（updated_at），不做锁
- 学期导出条目上限 1000，超出提示缩小范围

## 6. 测试与可用性验证

- 后端 pytest：仓储 CRUD、层级与数量校验、属主隔离（教师 A 不可见/不可改教师 B）、快照不可变与恢复、导出 HTML 转义、AI 端点 mock `complete`
- 前端 vitest：GoalsView/PlansView 渲染、目标关联选择、导出触发
- 浏览器可用性走查（验收要求）：注册 → 建树（模板预填）→ AI 拆解 → 采纳 → 排周计划 → 关联目标 → 定稿 → 导出打印，按真实操作路径验证无需培训可上手

## 7. 规范同步

按 AGENTS.md 第 8 节：本设计文档即入路线依据；`later-roadmap.md` 增补说明本模块为用户 2026-10-31 明确要求的独立功能，与阶段一并行推进、互不阻塞；AGENTS.md 3.1「当前要做的是」同步提及。实现时同步更新 `docs/architecture.md` 目录清单。

## 8. 交付批次（每批可独立验收）

1. 批 1：数据模型 + 目标树 CRUD + 课标模板 + 属主隔离 + 基础 GoalsView
2. 批 2：计划条目 + 周/月/学期视图 + 计划-目标映射
3. 批 3：AI 拆解建议 + 打印导出 + 定稿快照与恢复
4. 批 4：可用性走查与修复

## 9. 不做清单

- 不做计划↔已发布产物关联（留 `compose_lesson` 阶段）
- 不做 Word/Excel/PPT 导出
- 不做自动编辑历史（audit log）
- 不做多教师协作、共享与评论
- 不做「主大纲」标记、归档位
- 不动对话图、工具注册表、任务四态
- 不做拖拽排序（用上下移按钮）
- 不做课标原文入库（只做提炼骨架）
