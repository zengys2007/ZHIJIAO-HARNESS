# 加号「模型」选择浮层

日期：2026-11-03  
状态：已确认方向，待实现

## 1. 目标

把加号菜单里「模型」的行为，从「跳进设置 → API/MCPs配置」，改成参考图样式的会话模型浮层：搜索、按来源分组、勾选；选中后本会话后续发消息携带 `llm_source`，后端该轮用对应配置调用模型。

## 2. 范围

### 做

- 加号 →「模型」：关闭加号菜单，在输入区上方打开模型浮层。
- 浮层：顶部「搜索模型…」、分组「本机环境」「自行填写」、模型名列表、当前选中右侧勾选、悬停高亮。
- 列表数据来自现有 `/api/llm/config`；每组至多一项，展示该来源的 `model`。
- 未配齐（缺 `base_url` / `model` / 密钥）的来源：不展示该组可选项。
- 两组皆不可用：空态「暂无可用模型，请先在设置中配置」（及英文）。
- 本页会话状态记住 `llmSource: "local" | "dotenv"`；刷新可丢，不写 localStorage。
- `POST /api/conversations/{id}/messages` 增加可选字段 `llm_source`；未传时行为与现在完全一致。
- 后端该轮按 source 解析配置并建 `complete`；缺项 `400 invalid_input`，不静默回退到默认。
- 更新前端相关测试；补后端消息解析与按 source 选配置的测试。
- 中英文文案（搜索占位、空态、分组名复用设置侧已有键若合适）。

### 不做

- 不改造输入框底栏（不加参考图中的模型胶囊、`High`、圆形发送等）。
- 不引入多提供商增删、不写 `.env`、不接设置页「自行填写」草稿覆盖。
- 不把密钥回传前端；不改探针契约语义。
- 不做跨会话/服务端持久的「当前模型」偏好（非方案 B）。
- 不改动 API/MCPs 列表界面本身（仅取消「模型」菜单项对设置页的跳转）。

## 3. 界面与交互

```
┌─────────────────────────────────┐
│ 搜索模型...                      │
├─────────────────────────────────┤
│ 本机环境                         │
│   env-model                  ✓  │
│ 自行填写                         │
│   file-model                    │
└─────────────────────────────────┘
        ↑ 锚在输入区 / 加号附近上方
```

- Esc / 点击浮层外侧关闭；选中一项后关闭并勾选。
- 搜索按模型名（及可选分组名）过滤，大小写不敏感。
- 打开浮层时拉取 `/api/llm/config`（可与设置缓存策略简单一致：每次打开拉一次即可）。
- 加载失败：toast「加载模型列表失败」，关闭浮层；不自动进设置。

## 4. 数据流与 API

### 4.1 前端

- `Workbench` 持有浮层开关与 `llmSource`；新组件 `ModelPicker` 负责展示与选择。
- `sendMessage(conversationId, content, { llmSource? })`：有选中时 body 为 `{ content, llm_source }`。
- `PlusMenu` 的 `onOpenModel` 不再 `setView("settings")`；改为打开浮层。设置页仍可从侧栏进入。

### 4.2 消息体

当前 `parse_message` 仅允许 `{ "content" }`。改为：

- 必填：`content`（规则不变：非空字符串，trim 后 1–4000）。
- 可选：`llm_source`，取值仅 `"local"` | `"dotenv"`。
- 其它键、非法 `llm_source` → `RequestError` / `400 invalid_input`。

### 4.3 后端选配置

| `llm_source` | 配置来源 |
| --- | --- |
| 省略 | 沿用应用启动时的默认 `complete`（现有 `Settings`） |
| `"local"` | `process_llm()`；三项皆非空才可用 |
| `"dotenv"` | `dotenv_llm(env_file)`；三项皆非空才可用 |

解析成功后，在执行该任务的工作线程内用对应 URL/密钥/模型构造本轮 `complete`（或等价地注入本轮图），**不得**改写进程全局默认配置以免并发串台。超时等沿用现有 `Settings.llm_timeout_seconds`（或与默认 complete 相同的超时策略）。

推荐实现要点（实现计划可细化）：

- `make_complete` 已能从类 Settings 对象构造；可为 dict/`SimpleNamespace` 增加薄适配，或新增 `make_complete_from_values(...)`。
- `run_turn` 接受可选的本轮 `complete` / 本轮 graph；`create_message` 在提交任务前解析 source，把解析结果交给线程，避免 ContextVar 跨请求泄漏。

## 5. 错误处理

| 情况 | 行为 |
| --- | --- |
| 配置列表加载失败 | 提示失败，浮层可关 |
| 无可用模型 | 空态引导去设置 |
| 发送时 source 缺项 / 非法 | `400`；前端 toast；勾选保留，不强制清掉 |
| 上游超时等 | 沿用现有任务失败与横幅文案 |

## 6. 测试与验收

- 前端：加号 → 模型 → 出现搜索与分组；勾选；发送请求带 `llm_source`；原「打开设置 API/MCPs」用例改为「打开模型浮层」。
- 后端：`llm_source=local|dotenv` 使用对应配置；缺项 400；未传字段与现网一致。
- 手动：两端均配置时可切换；只配一端时另一端不出现；未选时对话仍可用默认模型。

## 7. 主要文件（预期）

- `frontend/src/components/PlusMenu.tsx`、新 `ModelPicker.tsx`（或同级）
- `frontend/src/pages/Workbench.tsx`、`frontend/src/api/http.ts`、`appearance` / `styles.css`
- `frontend/src/pages/Workbench.test.tsx`
- `backend/app/api/messages.py`、`backend/app/main.py`、`backend/app/tasks/runner.py`、`backend/app/llm/complete.py`（按需）
- 对应 backend 测试
