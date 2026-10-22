# 智教 Harness 登录设计

状态：已确认（2026-10-22）。后端已按本文实现。工作台尚未接上登录。

前置文档：[后续路线](2026-10-21-later-roadmap.md)、[接口契约](../../api-contract.md)

工作台的画面、文案和请求见 [登录工作台界面](2026-10-22-login-frontend.md)。

本文决定教师登录的数据、Cookie、接口和隔离规则。后端和接口契约已按本文实现。工作台仍按第 6 节待做。

## 1. 目标

一位教师注册、登录、退出。登录之后只能创建、列出、读取和继续自己的会话，也只能轮询自己会话里的任务。已有的无主会话归到一个明确的本地管理员。

网页、讲义、作品列表和 `compose_lesson` 不在本文。图的节点、边、四态任务和生产空注册表保持不动。

## 2. 存储

现在唯一的数据库实现仍是本机 SQLite，文件是 `data/app.sqlite`。调用方不写 SQL，也不接触连接和文件路径。浏览器不保存用户资料。

远程数据库以后换成 `backend/app/storage/` 里的另一个实现，实现第 2.5 节的同一组方法。用户、登录会话、对话和任务仍在同一个库里，不拆成独立的用户服务。现在不引入数据库驱动，不读取连接串，也不做第二份空实现。

`AUTH_SECRET` 和 `AUTH_ADMIN_PASSWORD` 只从环境变量读取，写入 `.env.example` 时值为空。它们不进数据库，不进日志，不进接口响应。

### 2.1 `users`

| 列 | 内容 |
| --- | --- |
| `id` | 主键。32 位小写十六进制 |
| `username` | 登录名。去掉首尾空白后 1 到 32 个码位，且不含任何空白码位。区分大小写。全库唯一 |
| `display_name` | 侧栏显示名。去掉首尾空白后 1 到 32 个码位，中间可以有空格。注册时缺省等于处理后的 `username` |
| `password_hash` | 密码哈希，见第 2.3 节 |
| `created_at` | UTC，`YYYY-MM-DDTHH:MM:SSZ` |

用户名 `local-admin` 只由第 4 节的迁移创建。注册请求使用这个名字时，返回与用户名重复相同的 `conflict`。

### 2.2 `sessions`

| 列 | 内容 |
| --- | --- |
| `id` | 主键。32 位小写十六进制 |
| `user_id` | `users.id` |
| `expires_at` | 创建时刻加 7 天，格式与 `created_at` 相同。使用期间不续期 |
| `created_at` | 同上 |

一次登录插入一行。退出只删除当前 Cookie 对应的那一行。同一用户可以有多行未过期会话。过期行在校验时视为无效，可以顺手删掉。

### 2.3 密码哈希

使用标准库 `hashlib.scrypt`。参数固定为 `n=16384`、`r=8`、`p=1`，盐为 16 字节随机数，输出 32 字节。

库存字符串：

```text
scrypt$16384$8$1$<盐的 base64>$<哈希的 base64>
```

base64 用标准字母表，去掉末尾填充的 `=`。校验时解析这五个字段，用 `hmac.compare_digest` 比较哈希。用户不存在时，仍对请求中的密码做一次同样参数的运算，再返回失败，避免用耗时区分用户名是否存在。

密码原文、盐和哈希不出现在日志、会话事件和响应里。

### 2.4 会话属主

`conversations` 增加 `owner_id`，指向 `users.id`。迁移结束后这一列非空。任务表不增加属主。读取任务时先找到它的 `conversation_id`，再核对会话的 `owner_id`。没有 `conversation_id` 的任务，任何教师都读不到。

已有建表语句不会补列。SQLite 实现启动时若没有 `owner_id`，用 `ALTER TABLE conversations ADD COLUMN owner_id TEXT` 补上，再执行第 4 节。这是该实现自己的迁移，不放进第 2.5 节的协议。

### 2.5 存储协议

协议放在 `backend/app/storage/protocol.py`。`Task`、`Event`、`VersionRecord`、`User`、`Session`、`ConversationSummary` 也定义在这里，字段是普通值，不是数据库行。`User.password_hash` 只保存第 2.3 节的字符串。哈希的计算在 `backend/app/auth/passwords.py`。

现有 `Repository` 改名为 `SqliteRepository`，继续放在 `repository.py`，方法与协议一致。`sqlite3` 只出现在这个文件。`open_repository(settings)` 放在 `backend/app/storage/__init__.py`，选择只写在这个函数里。今天它固定返回 `SqliteRepository(settings.data_dir / "app.sqlite")`。测试可以直接构造 `SqliteRepository` 并传入临时文件。

协议方法如下。`submit_message` 在会话正忙时抛出 `ConflictError`。

| 方法 | 用途 |
| --- | --- |
| `create_user(username, display_name, password_hash) -> User` | 注册。用户名重复时抛出 `ConflictError` |
| `get_user(user_id) -> User \| None` | 按 id 读取 |
| `get_user_by_username(username) -> User \| None` | 登录 |
| `create_session(user_id, expires_at) -> Session` | 登录时插入一行 |
| `get_session(session_id) -> Session \| None` | 校验 Cookie |
| `delete_session(session_id) -> None` | 退出。行已经不存在也成功 |
| `create_conversation(owner_id) -> str` | 创建会话并写入属主 |
| `list_conversations(owner_id) -> list[ConversationSummary]` | 当前教师的列表。标题规则见第 5.5 节 |
| `submit_message(conversation_id, content, owner_id) -> Task` | 属主不符时抛出 `NotFoundError` |
| `list_conversation_tasks(conversation_id, owner_id) -> list[Task] \| None` | 属主不符或会话不存在时返回 `None` |
| `get_task(task_id) -> Task \| None` | 进程内执行器使用 |
| `get_task_for_owner(task_id, owner_id) -> Task \| None` | 轮询。属主不符时返回 `None` |
| `succeeded_turns(conversation_id) -> list[tuple[str, str]]` | 拼装已成功的对话 |
| `set_step_count(task_id, step_count) -> None` | 记下模型步数 |
| `transition(...)` | 四态转换，参数与现在相同 |
| `append_event(task_id, event_type, payload) -> Event` | 追加会话事件 |
| `list_events(task_id) -> list[Event]` | 读取事件 |
| `last_event(task_id) -> Event \| None` | 最后一条事件 |
| `list_running() -> list[Task]` | 查找超时任务 |
| `insert_published_version(...)` | 现有发布。登录不调用它 |
| `get_version(artifact_id, version) -> VersionRecord \| None` | 现有版本读取 |
| `artifact_view(artifact_id) -> dict \| None` | 现有产物视图 |
| `transaction()` | 上下文管理器。成功提交，异常回滚。调用方不写 SQL |

`open_repository` 不接受来自请求或模型输出的地址。远程实现加入时，连接信息只从环境变量进入这个函数，驱动的 import 只出现在新的存储模块里。

## 3. Cookie

Cookie 名是 `zhijiao_session`。值为：

```text
<session_id>.<expires_unix>.<signature>
```

`expires_unix` 是 `sessions.expires_at` 的 Unix 秒，十进制。`signature` 是对 `<session_id>.<expires_unix>` 做 HMAC-SHA256 的十六进制小写摘要，密钥是 `AUTH_SECRET`。

属性：`HttpOnly`、`SameSite=Lax`、`Path=/`。本机 HTTP 不设置 `Secure`。前端脚本读不到这枚 Cookie，请求使用 `credentials: "include"`。

以下任一情况都是未登录，对外都是第 5 节的 `unauthenticated`：

- 没有这枚 Cookie
- 格式或签名不对
- `expires_unix` 早于当前时间，或与会话行的 `expires_at` 不一致
- 会话行不存在，或 `user_id` 对不上用户

`AUTH_SECRET` 去掉首尾空白后少于 16 个码位时，进程拒绝启动。

## 4. 已有无主会话

启动时，`owner_id` 为空的会话都要有属主。

- 不存在用户名 `local-admin` 时，用 `AUTH_ADMIN_PASSWORD` 创建它。显示名是「本地管理员」。密码规则与注册相同，只把哈希写入 `password_hash`。
- 该用户已存在时，不修改密码。
- 这些会话的 `owner_id` 写成这个用户的 `id`。
- 需要新建该用户、但 `AUTH_ADMIN_PASSWORD` 缺失或不符合密码长度时，进程启动失败。失败信息里不包含密码。

没有任何无主会话时，不创建 `local-admin`。空库的第一位教师通过注册进入。

## 5. 接口

前缀仍是 `/api`。成功响应不含 `error`。失败响应只有 `error`。未知字段是 `invalid_input`。字符按 Unicode 码位计数。

登录态从 Cookie 读取，不读取 `Authorization`。

### 5.1 注册

`POST /api/auth/register`

```json
{
  "username": "teacher",
  "password": "correct-horse",
  "display_name": "王老师"
}
```

`display_name` 可省略。省略时显示名等于处理后的用户名。

201，并设置第 3 节的 Cookie：

```json
{
  "user_id": "0123456789abcdef0123456789abcdef",
  "username": "teacher",
  "display_name": "王老师"
}
```

| 情况 | 结果 |
| --- | --- |
| 用户名、密码或显示名不符合第 2.1 节，或密码不在 8 到 128 个码位 | 400 `invalid_input`，句子见下表 |
| 用户名已存在，或名字是 `local-admin` | 409 `conflict`，句子「这个用户名已经有人使用。」 |

字段句子：

| 字段 | `error.message` |
| --- | --- |
| `username` | 用户名写成 1 到 32 个字，中间不要有空格。 |
| `password` | 密码写成 8 到 128 个字。 |
| `display_name` | 显示名写成 1 到 32 个字。 |

### 5.2 登录

`POST /api/auth/login`

```json
{
  "username": "teacher",
  "password": "correct-horse"
}
```

成功时 200，正文与注册成功相同，并设置 Cookie。用户名不存在或密码不对，都是 400 `invalid_input`，句子「用户名或密码不正确。」字段缺失或类型不对时，用第 5.1 节对应字段的句子。

### 5.3 退出

`POST /api/auth/logout`

没有正文。已登录时删除当前会话行，清除 Cookie，返回 204，没有正文。未登录时同样清除 Cookie，返回 401 `unauthenticated`。

### 5.4 当前用户

`GET /api/auth/me`

已登录时 200，正文与注册成功相同。未登录时 401。

### 5.5 会话列表

`GET /api/conversations`

只返回当前用户的会话，按 `created_at` 降序，相同时按 `conversation_id` 降序。

200：

```json
{
  "conversations": [
    {
      "conversation_id": "0123456789abcdef0123456789abcdef",
      "title": "这节课怎么讲通分",
      "created_at": "2026-10-22T02:00:00Z"
    }
  ]
}
```

`title` 取该会话最早一条教师消息：去掉首尾空白，只留第一行；超过 18 个码位时保留前 18 个并加上 `…`。还没有教师消息时，标题是「新对话」。

### 5.6 原有接口

以下接口必须已登录。未登录返回 401，不创建任务：

- `POST /api/conversations`
- `POST /api/conversations/{conversation_id}/messages`
- `GET /api/conversations/{conversation_id}`
- `GET /api/tasks/{task_id}`
- `GET /api/llm/config`
- `POST /api/llm/probe`

`GET /health` 不登录。

创建会话时写入当前用户的 `owner_id`。读取会话、发送消息、轮询任务时，属主不是当前用户，与记录不存在一样，返回 404 `not_found`，句子仍是「没有找到这个会话或任务。」列表接口不包含别人的会话。

成功时的正文字段与现有契约相同。

### 5.7 新增错误码

| `error.code` | HTTP | `retryable` | `error.message` |
| --- | --- | --- | --- |
| `unauthenticated` | 401 | 否 | 请先登录。 |

用户名重复沿用 `conflict`，但句子换成「这个用户名已经有人使用。」对话忙时的 `conflict` 句子不变。

## 6. 工作台

画面、按钮文案、错误句和每个请求的字段写在 [登录工作台界面](2026-10-22-login-frontend.md)。这里只保留行为：

打开页面先请求 `GET /api/auth/me`。401 时主区域显示注册和登录，输入框不能发送。侧栏账号名显示 `display_name`。用户设置里提供退出。

登录、注册和退出之后，不再使用原来的 `sessionStorage` 键 `zhijiao.conversations:v1`。标题缓存改为 `zhijiao.conversations:v1:<user_id>`，并用 `GET /api/conversations` 覆盖侧栏列表。退出时清掉当前页面上的列表。

预览用的假 API 提供同样的方法，组件测试不访问真实后端。

## 7. 模块

| 位置 | 职责 |
| --- | --- |
| `backend/app/auth/passwords.py` | 哈希与校验 |
| `backend/app/auth/sessions.py` | 签发与校验 Cookie |
| `backend/app/api/` | 解析注册和登录正文 |
| `backend/app/main.py` | 挂路由。Web 框架只出现在这里 |
| `backend/app/storage/protocol.py` | 存储协议和返回值类型 |
| `backend/app/storage/repository.py` | SQLite 实现、用户表和本地迁移 |
| `backend/app/storage/__init__.py` 的 `open_repository` | 按配置选择实现。现在只返回 `SqliteRepository` |
| `backend/app/config.py` | 读取 `AUTH_SECRET`、`AUTH_ADMIN_PASSWORD` |
| `frontend/src/api/http.ts` | 带 Cookie 调用上述接口 |
| `docs/api-contract.md` | 实现时同步第 5 节 |

`backend/app/graph/` 不改。密码和会话逻辑不放进图节点，也不放进工具。

## 8. 不做

- 不做学校、班级、角色和公开分享。
- 不做作品列表、预览、导出和 `compose_lesson`。
- 不增加任务属主列，不留空的 `owner_id`。
- 不把会话标识放进 `localStorage` 或 `sessionStorage`。
- 不引入哈希库、JWT 库或独立的登录服务。
- 不连接远程数据库，不新增数据库驱动，不读取连接串。
- 不把登录状态传进以后的预览页。

## 9. 验收

- 注册后立刻处于登录态。密码列里找不到原文，格式符合第 2.3 节。
- 错误密码和未知用户名返回同一句「用户名或密码不正确。」
- 退出后，原来的 Cookie 不能再调用 `GET /api/auth/me`。
- 教师 A 不能读取、发送或轮询教师 B 的会话和任务，响应都是 `not_found`。A 的会话列表里没有 B 的会话。
- 未登录创建会话得到 `unauthenticated`，库里不新增会话。
- 已有无主会话在启动后属于 `local-admin`。空库启动不创建该用户。
- 同一会话的两轮成功、失败不覆盖、忙时 `conflict` 仍然成立。图的节点和边无改动。
- 工作台未登录不能发送。登录后侧栏显示 `display_name`，并能创建会话。退出后列表消失。
- `main.py`、`runner.py` 和 `api/` 不引用 `sqlite3`。它们只调用第 2.5 节的方法。生产进程通过 `open_repository` 取得存储。
