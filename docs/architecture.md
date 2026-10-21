# 智教 Harness 目录

状态：已确认（2026-10-21）。第 1 步已选定 FastAPI 与标准库 sqlite3。

本文只定源码和运行时文件放在哪里。产品范围、图的停机和 API 以 [MVP 路线](superpowers/specs/2026-10-21-mvp-roadmap.md) 为准。阶段顺序以 [后续路线](superpowers/specs/2026-10-21-later-roadmap.md) 为准。

某一交付步真正开始时，只添加该步用到的文件。Web 框架只出现在 `backend/app/main.py`，数据库驱动只出现在 `backend/app/storage/`。

## 1. 顶层

```text
zhijiao-harness/
  AGENTS.md
  .env.example                 无密钥的环境变量样例
  docs/
    architecture.md            本文
    superpowers/specs/         路线
  backend/                     Python 进程。API 与图在同一进程
  frontend/                    教师工作台。不持有模型密钥
  data/                        运行时数据，不进 git
```

`.env` 不提交。`data/` 不提交。MVP 只在 `data/` 里放 sqlite。生成的网页留到阶段一，不建 `presets/`。

## 2. 后端

Web 框架只允许出现在 `backend/app/main.py`。数据库驱动只允许出现在 `backend/app/storage/`。其余模块不引用这两样依赖，这样框架和数据库选定后不用搬目录。

```text
backend/
  pyproject.toml
  app/
    main.py                    进程入口。挂上 API，并在进程内启动执行器
    config.py                  只从环境变量读取配置
    api/
      errors.py                error.code / message / retryable 的唯一定义
      conversations.py         创建会话、发送消息、读取会话
      tasks.py                 GET /api/tasks/{task_id}
    tasks/
      states.py                pending / running / succeeded / failed 的唯一定义
      runner.py                改状态、调用 invoke、保存助手回复
    graph/
      state.py                 一轮的图状态和合并规则
      build.py                 编译 StateGraph。无检查点，无 RetryPolicy
      model_node.py
      tool_node.py             预留。生产注册表为空时仍在图上
      edges.py                 条件边：无工具调用则结束；有工具调用则进入工具节点；满 6 步结束
    tools/
      protocol.py              name、description、参数 schema、execute
      registry.py              启动时的工具表。MVP 生产表为空
    prompts/
      system.md                启动时读入。不写死工具名单
    context/
      assemble.py              唯一组装模型输入的地方
    llm/
      complete.py              complete(messages, tools)。注册表为空时不传 tools
    storage/
      repository.py            会话、任务、会话事件
  tests/
    graph/
    tools/
    api/
```

`graph/` 里没有某个课堂工具的页面逻辑。`tools/` 里的 `execute` 不写版本行，不改任务状态。`api/` 不组装提示词，不执行工具。

新增一个工具时，在 `tools/` 加一个模块，并在 `registry.py` 登记。`graph/build.py`、`graph/edges.py`、`graph/state.py` 保持不动。MVP 不登记面向教师的工具。

## 3. 运行时数据

根目录来自配置，不来自用户输入或模型输出。

```text
data/
  app.sqlite                             会话、任务、事件
```

阶段一才增加候选目录和 `artifacts/{artifact_id}/{version}/`。路径只由存储模块拼接。

## 4. 前端

工作台使用 Vite、React 与 TypeScript，不引入组件库。开发时在 `frontend/` 执行 `npm run dev`，页面在 `http://127.0.0.1:5173`，`/api` 代理到本机 `8000`。

```text
frontend/
  index.html            Vite 入口
  src/
    api/                只调用本机 /api。类型与后端契约一致
    types/              引用任务四态，不另造一套状态
    pages/              会话、输入、轮询、显示回复
    components/         对话记录和输入区
    lib/                字数和会话标识
```

MVP 没有预览页。`frontend/preview.html` 不进入工作台，也不插入主应用 DOM。阶段一的生成页同样不进 `frontend/src/`。

## 5. 谁可以改哪里

| 路径 | 可以改 | 不要改 |
| --- | --- | --- |
| `graph/build.py` `edges.py` `state.py` | 停机、合并、步数上限 | 为某个新工具加分支 |
| `tools/` | 新工具。MVP 生产表保持为空 | 改任务状态、放进点名计时或投票 |
| `context/` `prompts/system.md` | 拼装和系统提示词 | 调用模型、读取任意路径 |
| `llm/complete.py` | 协议和超时重试 | 选择工具 |
| `tasks/runner.py` | 状态转换和保存回复 | 在 MVP 里写版本行 |
| `tasks/states.py` `api/errors.py` | 这两份定义本身 | 在别的文件再定义一套 |
| `api/` | 请求校验和响应 | 长流程生成 |
| `frontend/src/` | 工作台 | 模型密钥、存储路径 |

## 6. 现在不建的目录

后续路线里的能力先不建目录。进入该阶段时再加文件，并登记进现有 `registry.py`：

- `tools/write_page.py`、`validation/page.py`、`preview/`、`export/`：阶段一的网页。MVP 不建
- `tools/write_handout.py`、`validation/handout.py`：讲义
- `tools/compose_lesson.py`：课堂导航。账号阶段才会有登录模块
- `tools/search_materials.py`：只读检索
- 队列消费者：替换执行器所在的进程，不替换 `graph/`

不建 `presets/`、`use_preset.py`、`agents/`、`plugins/`、`generators/`、用户表、Redis 或 Celery 的目录。点名器、计时器和投票器没有目录。
