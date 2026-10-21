# 智教 Harness 目录

状态：已确认（2026-10-21）

本文只定源码和运行时文件放在哪里。产品范围、图的停机和 API 以 [MVP 路线](superpowers/specs/2026-10-21-mvp-roadmap.md) 为准。阶段顺序以 [后续路线](superpowers/specs/2026-10-21-later-roadmap.md) 为准。

仓库里还没有 `backend/` 和 `frontend/`。Web 框架和数据库未选定之前，不按本文创建空目录或空模块。某一交付步真正开始时，只添加该步用到的文件。

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

`.env` 不提交。`data/` 不提交。模型生成的网页只出现在 `data/` 里，不进 `backend/app/presets/`。

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
      tasks.py                 POST/GET /api/tasks
      artifacts.py             产物、修改、预览、导出的 HTTP 入口
    tasks/
      states.py                pending / running / succeeded / failed 的唯一定义
      runner.py                改状态、调用 invoke、按返回值发布或失败
    graph/
      state.py                 一轮的图状态和合并规则
      build.py                 编译 StateGraph。无检查点，无 RetryPolicy
      model_node.py
      tool_node.py
      edges.py                 条件边：无工具调用、ask_teacher、满 6 步
    tools/
      protocol.py              name、description、参数 schema、execute
      registry.py              启动时固定的工具表，并投影给模型
      use_preset.py
      write_page.py
      ask_teacher.py
    presets/
      roll_call/index.html     人工模板
      timer/index.html
      poll/index.html
    prompts/
      system.md                启动时读入。不写死工具名单
    context/
      assemble.py              唯一组装模型输入的地方
    llm/
      complete.py              complete(messages, tools)。不引用供应商 SDK
    validation/
      page.py                  结构、路径、大小、安全。不改文件来凑合通过
    artifacts/
      contract.py              产物字段和 capabilities 的唯一定义
      publish.py               版本事务。只由 runner 调用
    preview/
      headers.py               CSP 与 sandbox 相关响应头
      serve.py                 读已发布版本
    export/
      zip.py
    storage/
      repository.py            任务、会话事件、产物、版本
      files.py                 唯一拼接产物路径的地方
  tests/
    graph/
    tools/
    validation/
    api/
```

`graph/` 里没有某个课堂工具的页面逻辑。`tools/` 里的 `execute` 不写版本行，不改任务状态。`api/` 不组装提示词，不执行工具。

新增一个工具时，在 `tools/` 加一个模块，并在 `registry.py` 登记。`graph/build.py`、`graph/edges.py`、`graph/state.py` 保持不动。新的预置模板是 `presets/` 下的一个新目录，加上 `use_preset` 能接受的新 `preset` 值。

## 3. 运行时数据

根目录来自配置，不来自用户输入或模型输出。

```text
data/
  tmp/{task_id}/                         本轮候选。失败则删除
  artifacts/{artifact_id}/{version}/     已发布版本
    index.html
    manifest.json                        仅导出时打包，预览目录里可以有同内容的清单
```

正式路径只在 `publish.py` 的事务成功后出现。业务代码通过 `storage/files.py` 取路径，不自己拼接。

## 4. 前端

前端框架未选定。选定之前，页面文件的具体后缀以当时的框架为准，目录职责不变。

```text
frontend/
  src/
    api/                只调用本机 /api。类型与后端契约一致
    types/              引用任务四态和产物字段，不另造一套状态
    pages/              输入需求、轮询、修改、导出
    preview/            iframe。sandbox="allow-scripts"，不授予 allow-same-origin
```

生成页的 HTML 不进 `frontend/src/`，也不插入主应用 DOM。预览只打开后端的预览 URL。

## 5. 谁可以改哪里

| 路径 | 可以改 | 不要改 |
| --- | --- | --- |
| `graph/build.py` `edges.py` `state.py` | 停机、合并、步数上限 | 为某个新工具加分支 |
| `tools/` `presets/` | 新工具、新模板 | 发布版本、改任务状态 |
| `context/` `prompts/system.md` | 拼装和系统提示词 | 调用模型、读取任意路径 |
| `llm/complete.py` | 协议和超时重试 | 选择工具 |
| `tasks/runner.py` `artifacts/publish.py` | 状态转换和发布 | 工具内部的页面细节 |
| `tasks/states.py` `artifacts/contract.py` `api/errors.py` | 这三份定义本身 | 在别的文件再定义一套 |
| `api/` | 请求校验和响应 | 长流程生成 |
| `frontend/src/` | 工作台 | 模型密钥、存储路径 |

## 6. 现在不建的目录

后续路线里的能力先不建目录。进入该阶段时再加文件，并登记进现有 `registry.py`：

- `tools/write_handout.py`、`validation/handout.py`：讲义
- `tools/compose_lesson.py`：课堂导航。账号阶段才会有登录模块
- `tools/search_materials.py`：只读检索
- 队列消费者：替换执行器所在的进程，不替换 `graph/`

不建 `agents/`、`plugins/`、`generators/`、用户表、Redis 或 Celery 的目录。
