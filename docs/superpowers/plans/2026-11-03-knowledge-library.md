# 知识点库实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为知识点库补齐编辑、删除、先修环校验、批量导入与 SVG 图谱展示。

**Architecture:** 方案 A——沿用 `knowledge_points` 表的名称弱引用先修存储，不迁移 schema。环检测是纯函数模块（DFS 三色标记），服务层在编辑与批量导入时调用；批量导入整体单事务、成环回滚。前端在 TeachingPanel「知识点」Tab 内加列表编辑/删除、批量导入折叠区与图谱子视图。

**Tech Stack:** FastAPI + sqlite3（标准库）、React 19 + TypeScript、SVG 手绘图谱（无新依赖）。

**规格：** `docs/superpowers/specs/2026-11-03-knowledge-library.md`

## Global Constraints

- 不引入新依赖（后端与前端都不加包）
- 先修仍是名称列表（JSON 列），不做外键关联表
- 删除有成绩记录的知识点返回 409，不级联删成绩
- 所有新文案同时写进 `appearance.tsx` 的 zh 和 en 词表
- 环检测错误消息要含成环链（如「约分 → 通分 → 约分」）
- 每个任务结束时：`pytest backend/tests`（或对应单文件）与 `npm run typecheck` 必须过才提交
- 运行前端命令前先设 PATH：`$env:PATH = "C:\Users\zihan\tools\node-v24.22.1-win-x64;$env:PATH"`；前端目录 `frontend/`，后端测试目录 `backend/`
- 后端测试命令（PowerShell）：`C:\project\ZHIJIAO-HARNESS\backend\.venv\Scripts\python.exe -m pytest tests/ -v`（cwd 为 `backend/`）
- 提交信息用中文，一次提交一个任务

---

### Task 1: 环检测纯函数 `cycles.py`

**Files:**
- Create: `backend/app/teaching/cycles.py`
- Test: `backend/tests/test_knowledge.py`（新建）

**Interfaces:**
- Consumes: `app.storage.protocol.KnowledgePoint`（已存在：`id, owner_id, name, description, prerequisites: list[str]`）
- Produces: `find_cycle(points: list[KnowledgePoint]) -> list[str] | None`——入参是「假想保存后的全量点集」，返回成环链（首尾同名）或 None。后续 Task 2/3/4 的 API 层调用它。

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_knowledge.py`：

```python
"""知识点库：环检测、编辑、删除、批量导入。"""

import pytest

from app.storage.protocol import KnowledgePoint
from app.teaching.cycles import find_cycle


def _point(name: str, prerequisites: list[str]) -> KnowledgePoint:
    return KnowledgePoint(id=name, owner_id="u1", name=name, description="", prerequisites=prerequisites)


def test_find_cycle_returns_none_without_edges():
    points = [_point("约分", []), _point("通分", ["约分"])]

    assert find_cycle(points) is None


def test_find_cycle_detects_two_node_cycle():
    points = [_point("约分", ["通分"]), _point("通分", ["约分"])]

    cycle = find_cycle(points)

    assert cycle is not None
    assert cycle[0] == cycle[-1]
    assert set(cycle) == {"约分", "通分"}


def test_find_cycle_detects_self_loop():
    points = [_point("约分", ["约分"])]

    assert find_cycle(points) is not None
    assert find_cycle(points)[0] == "约分"


def test_find_cycle_detects_deep_chain_cycle():
    # 分数加减 -> 约分 -> 通分 -> 分数加减
    points = [
        _point("分数加减", ["通分"]),
        _point("约分", ["分数加减"]),
        _point("通分", ["约分"]),
    ]

    cycle = find_cycle(points)

    assert cycle is not None
    assert cycle[0] == cycle[-1]


def test_find_cycle_ignores_prerequisites_not_in_set():
    # 先修引用了库外的名（尚未自动补建的场景），视为无环
    points = [_point("约分", ["不存在的点"])]

    assert find_cycle(points) is None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `C:\project\ZHIJIAO-HARNESS\backend\.venv\Scripts\python.exe -m pytest tests/test_knowledge.py -v`（cwd `backend/`）
Expected: FAIL — `ModuleNotFoundError: No module named 'app.teaching.cycles'`

- [ ] **Step 3: 实现**

新建 `backend/app/teaching/cycles.py`：

```python
"""知识点先修关系的环检测。纯函数，不依赖存储。"""

from app.storage.protocol import KnowledgePoint


def find_cycle(points: list[KnowledgePoint]) -> list[str] | None:
    """检测先修图里的环。返回成环链（首尾同名，如 [约分, 通分, 约分]），无环返回 None。

    先修引用了点集之外的名时忽略该边——调用方负责先补建缺失点再检测。
    """
    names = {point.name for point in points}
    adjacency: dict[str, list[str]] = {
        point.name: [name for name in point.prerequisites if name in names and name != point.name or name == point.name]
        for point in points
    }
    # 自环要保留：先修含自身即成环。上面推导式里 name != point.name or name == point.name
    # 恒真，等价于保留所有指向点集内的边；这里显式重写以免歧义。
    adjacency = {
        point.name: [name for name in point.prerequisites if name in names]
        for point in points
    }

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {name: WHITE for name in names}
    stack: list[str] = []

    def visit(name: str) -> list[str] | None:
        color[name] = GRAY
        stack.append(name)
        for next_name in adjacency[name]:
            if color[next_name] == GRAY:
                index = stack.index(next_name)
                return [*stack[index:], next_name]
            if color[next_name] == WHITE:
                found = visit(next_name)
                if found is not None:
                    return found
        stack.pop()
        color[name] = BLACK
        return None

    for name in names:
        if color[name] == WHITE:
            found = visit(name)
            if found is not None:
                return found
    return None
```

注意：上面第一次的 adjacency 推导是笔误示例，实现时只保留第二次的干净版本：

```python
    adjacency = {
        point.name: [name for name in point.prerequisites if name in names]
        for point in points
    }
```

自环场景（`约分` 的先修含 `约分`）：`visit("约分")` 时把自身标 GRAY，遍历邻接遇到 GRAY 的自身，`stack.index` 找到，返回 `["约分", "约分"]`——符合测试。

- [ ] **Step 4: 运行测试确认通过**

Run: `C:\project\ZHIJIAO-HARNESS\backend\.venv\Scripts\python.exe -m pytest tests/test_knowledge.py -v`
Expected: 5 passed

- [ ] **Step 5: 提交**

```bash
git add backend/app/teaching/cycles.py backend/tests/test_knowledge.py
git commit -m "知识点环检测：三色 DFS 纯函数，返回成环链。"
```

---

### Task 2: 存储层编辑与删除

**Files:**
- Modify: `backend/app/storage/repository.py`（`create_knowledge_point` 之后，约 460 行处追加两个方法）
- Test: `backend/tests/test_knowledge.py`（追加）

**Interfaces:**
- Consumes: `NotFoundError`、`ConflictError`（`repository.py` 已 import）；`sqlite3`；`json`；`uuid4`；`_now()`（均已存在）
- Produces（repository 实例方法，Task 4 的 API 层调用）:
  - `update_knowledge_point(owner_id: str, point_id: str, name: str, description: str, prerequisites: list[str]) -> None`——点不存在/非本人抛 `NotFoundError`；新名与其他点重名抛 `ConflictError`；改名时同事务同步 `scores` 关联与所有点的先修引用。**注意：先修自动补建与环检测不在此层做**（API 层职责）。
  - `delete_knowledge_point(owner_id: str, point_id: str) -> None`——不存在/非本人抛 `NotFoundError`；有成绩记录抛 `ConflictError`；否则删除并从所有点的先修列表移除该名。

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_knowledge.py` 追加（文件顶部补 import）：

```python
from app.storage.repository import SqliteRepository


def _repo(tmp_path) -> tuple[SqliteRepository, str]:
    repo = SqliteRepository(tmp_path / "teach.db")
    user_id = "u1"
    repo.create_knowledge_point(user_id, "约分", "化简分数", [])
    repo.create_knowledge_point(user_id, "通分", "", ["约分"])
    return repo, user_id


def test_update_point_renames_references(tmp_path):
    repo, user_id = _repo(tmp_path)
    class_id = repo.create_class(user_id, "三年二班", ["小明"])
    repo.create_assignment(
        user_id,
        AssignmentInput(
            class_id=class_id,
            title="测验",
            kind="quiz",
            records=[("小明", [("约分", 60.0)])],
        ),
    )
    points_before = repo.load_teaching(user_id).knowledge_points
    target = next(item for item in points_before if item.name == "约分")

    repo.update_knowledge_point(user_id, target.id, "约分与化简", "化简分数", ["通分"])

    data = repo.load_teaching(user_id)
    names = {item.name for item in data.knowledge_points}
    assert "约分与化简" in names and "约分" not in names
    # score_cells 里的知识点名同步更新
    assert data.scores[0].knowledge_point_name == "约分与化简"
    # 通分的先修引用同步更新
    tongfen = next(item for item in data.knowledge_points if item.name == "通分")
    assert tongfen.prerequisites == ["约分与化简"]


def test_update_point_rejects_unknown_and_duplicate(tmp_path):
    repo, user_id = _repo(tmp_path)

    with pytest.raises(NotFoundError):
        repo.update_knowledge_point(user_id, "0" * 32, "新名", "", [])
    with pytest.raises(ConflictError):
        points = repo.load_teaching(user_id).knowledge_points
        repo.update_knowledge_point(user_id, points[0].id, "通分", "", [])


def test_update_point_isolated_between_owners(tmp_path):
    repo, user_id = _repo(tmp_path)
    points = repo.load_teaching(user_id).knowledge_points

    with pytest.raises(NotFoundError):
        repo.update_knowledge_point("别人", points[0].id, "新名", "", [])


def test_delete_point_removes_prerequisite_references(tmp_path):
    repo, user_id = _repo(tmp_path)
    points = repo.load_teaching(user_id).knowledge_points
    yuefen = next(item for item in points if item.name == "约分")

    repo.delete_knowledge_point(user_id, yuefen.id)

    data = repo.load_teaching(user_id)
    tongfen = next(item for item in data.knowledge_points)
    assert tongfen.prerequisites == []


def test_delete_point_with_scores_conflicts(tmp_path):
    repo, user_id = _repo(tmp_path)
    class_id = repo.create_class(user_id, "三年二班", ["小明"])
    repo.create_assignment(
        user_id,
        AssignmentInput(
            class_id=class_id,
            title="测验",
            kind="quiz",
            records=[("小明", [("约分", 60.0)])],
        ),
    )
    points = repo.load_teaching(user_id).knowledge_points
    yuefen = next(item for item in points if item.name == "约分")

    with pytest.raises(ConflictError):
        repo.delete_knowledge_point(user_id, yuefen.id)


def test_delete_point_rejects_unknown(tmp_path):
    repo, user_id = _repo(tmp_path)

    with pytest.raises(NotFoundError):
        repo.delete_knowledge_point(user_id, "0" * 32)
```

顶部 import 补充：

```python
from app.storage.protocol import AssignmentInput, KnowledgePoint
from app.storage.repository import SqliteRepository
```

并确认 `NotFoundError`、`ConflictError` 可从 `app.storage.repository` 导入——查看 `repository.py` 顶部 import（它们来自 `app.storage.errors` 或本文件定义，以实际为准，测试按实际来源 import）。

- [ ] **Step 2: 运行测试确认失败**

Run: `C:\project\ZHIJIAO-HARNESS\backend\.venv\Scripts\python.exe -m pytest tests/test_knowledge.py -v`
Expected: 新增 6 个用例 FAIL（`AttributeError: 'SqliteRepository' object has no attribute 'update_knowledge_point'`）

- [ ] **Step 3: 实现**

在 `repository.py` 的 `create_knowledge_point` 方法后追加：

```python
    def update_knowledge_point(
        self, owner_id: str, point_id: str, name: str, description: str, prerequisites: list[str]
    ) -> None:
        with self.transaction():
            row = self._conn.execute(
                "SELECT name FROM knowledge_points WHERE id = ? AND owner_id = ?",
                (point_id, owner_id),
            ).fetchone()
            if row is None:
                raise NotFoundError("knowledge point not found")
            old_name = row["name"]
            clash = self._conn.execute(
                "SELECT id FROM knowledge_points WHERE owner_id = ? AND name = ? AND id != ?",
                (owner_id, name, point_id),
            ).fetchone()
            if clash is not None:
                raise ConflictError("knowledge point name taken")
            self._conn.execute(
                "UPDATE knowledge_points SET name = ?, description = ?, prerequisites = ? WHERE id = ?",
                (name, description, json.dumps(list(prerequisites), ensure_ascii=False), point_id),
            )
            if old_name != name:
                # 同步成绩关联的名与所有点先修列表里的旧名
                self._conn.execute(
                    "UPDATE scores SET knowledge_point_name = ? WHERE knowledge_point_name = ? AND owner_id = ?",
                    (name, old_name, owner_id),
                )
                points = self._conn.execute(
                    "SELECT id, prerequisites FROM knowledge_points WHERE owner_id = ?",
                    (owner_id,),
                ).fetchall()
                for point_row in points:
                    names = json.loads(point_row["prerequisites"])
                    if old_name in names:
                        updated = [name if item == old_name else item for item in names]
                        self._conn.execute(
                            "UPDATE knowledge_points SET prerequisites = ? WHERE id = ?",
                            (json.dumps(updated, ensure_ascii=False), point_row["id"]),
                        )
```

**实现前必须核对**：`scores` 表是否有 `knowledge_point_name` 列与 `owner_id` 列。读 `repository.py` 的 `_create_schema`（约 740 行 `CREATE TABLE IF NOT EXISTS scores`）确认实际列名。若 scores 只存 `knowledge_point_id` 不存名（从 Task 前文读到的 INSERT 是 `INSERT INTO scores (id, assignment_id, student_id, knowledge_point_id, score)`），则**改名无需更新 scores 表**（名由 join 派生），删掉上面 `UPDATE scores ...` 那段，改成只同步其他点的先修列表；同时 `delete_knowledge_point` 的「有成绩记录」判断改为：

```python
            used = self._conn.execute(
                """
                SELECT 1 FROM scores WHERE knowledge_point_id = ? LIMIT 1
                """
                ,
                (point_id,),
            ).fetchone()
            if used is not None:
                raise ConflictError("knowledge point has scores")
```

并把测试里 `data.scores[0].knowledge_point_name` 的断言改为查 `load_teaching` 后的 `knowledge_point_id` 对应名（`ScoreCell.knowledge_point_name` 由 `load_teaching` 的 join 派生，改名后自动正确——直接断言 `data.scores[0].knowledge_point_name == "约分与化简"` 即可，无需任何 UPDATE）。

```python
    def delete_knowledge_point(self, owner_id: str, point_id: str) -> None:
        with self.transaction():
            row = self._conn.execute(
                "SELECT name FROM knowledge_points WHERE id = ? AND owner_id = ?",
                (point_id, owner_id),
            ).fetchone()
            if row is None:
                raise NotFoundError("knowledge point not found")
            # 有成绩引用则拦截（以实际 schema 为准：按 knowledge_point_id 或 knowledge_point_name）
            used = self._conn.execute(
                "SELECT 1 FROM scores WHERE knowledge_point_id = ? LIMIT 1",
                (point_id,),
            ).fetchone()
            if used is not None:
                raise ConflictError("knowledge point has scores")
            name = row["name"]
            self._conn.execute("DELETE FROM knowledge_points WHERE id = ?", (point_id,))
            points = self._conn.execute(
                "SELECT id, prerequisites FROM knowledge_points WHERE owner_id = ?",
                (owner_id,),
            ).fetchall()
            for point_row in points:
                names = json.loads(point_row["prerequisites"])
                if name in names:
                    updated = [item for item in names if item != name]
                    self._conn.execute(
                        "UPDATE knowledge_points SET prerequisites = ? WHERE id = ?",
                        (json.dumps(updated, ensure_ascii=False), point_row["id"]),
                    )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `C:\project\ZHIJIAO-HARNESS\backend\.venv\Scripts\python.exe -m pytest tests/test_knowledge.py -v`
Expected: 全部 passed（含 Task 1 的 5 个）

- [ ] **Step 5: 提交**

```bash
git add backend/app/storage/repository.py backend/tests/test_knowledge.py
git commit -m "知识点存储层：编辑改名同步先修引用，删除拦截有成绩的点并清理引用。"
```

---

### Task 3: 存储层批量导入

**Files:**
- Modify: `backend/app/storage/repository.py`（`delete_knowledge_point` 后追加）
- Test: `backend/tests/test_knowledge.py`（追加）

**Interfaces:**
- Consumes: Task 2 的方法签名；`_ensure_knowledge_point`（已存在）
- Produces: `batch_create_knowledge_points(owner_id: str, entries: list[tuple[str, str, list[str]]]) -> tuple[int, list[dict], list[str]]`——返回 `(created 数, skipped 明细 [{line, name, reason}], ensured_prereqs 自动补建的先修名列表)`。整批单事务；**入库后整图环检测，成环抛 `RequestError`（来自 `app.api.messages`，带成环链消息）并回滚**。调用方（Task 4 的 parse 层）保证 entries 的名称合法、行号从 1 计。

- [ ] **Step 1: 写失败测试**

在 `test_knowledge.py` 追加：

```python
def test_batch_import_creates_and_skips_duplicates(tmp_path):
    repo, user_id = _repo(tmp_path)  # 已有 约分、通分

    created, skipped, ensured = repo.batch_create_knowledge_points(
        user_id,
        [
            (1, "分数乘除", "乘除混合", ["约分"]),
            (2, "约分", "重复", []),
            (3, "分数比较", "", ["分数乘除", "不存在的先修"]),
        ],
    )

    assert created == 2
    assert skipped == [{"line": 2, "name": "约分", "reason": "重名"}]
    assert ensured == ["不存在的先修"]
    names = {item.name: item for item in repo.load_teaching(user_id).knowledge_points}
    assert names["分数比较"].prerequisites == ["分数乘除", "不存在的先修"]
    assert names["不存在的先修"].description == ""


def test_batch_import_rolls_back_on_cycle(tmp_path):
    repo, user_id = _repo(tmp_path)

    with pytest.raises(RequestError) as exc_info:
        repo.batch_create_knowledge_points(
            user_id,
            [
                (1, "甲", "", ["乙"]),
                (2, "乙", "", ["甲"]),
            ],
        )

    assert "甲" in str(exc_info.value.public_message)
    names = {item.name for item in repo.load_teaching(user_id).knowledge_points}
    assert "甲" not in names and "乙" not in names
```

顶部补 `from app.api.messages import RequestError`（若 RequestError 构造签名是 `RequestError(code, public_message=...)`，存储层改用 `RequestError("cycle", public_message=...)`——以 `app/api/messages.py` 实际定义为准）。

**设计决策（写进实现）**：`batch_create_knowledge_points` 直接收 `list[tuple[int, str, str, list[str]]]`（行号, 名称, 说明, 先修）——比 Task 3 Interfaces 里写的三元组多一个行号，以测试为准（测试传四元组）。**环检测在事务内进行**：全部插入后 `load` 本 owner 的点集（事务内可读到未提交数据）调 `find_cycle`，成环抛错让事务回滚。

- [ ] **Step 2: 运行测试确认失败**

Run: `C:\project\ZHIJIAO-HARNESS\backend\.venv\Scripts\python.exe -m pytest tests/test_knowledge.py -v`
Expected: 新增 2 个用例 FAIL（`AttributeError: ... no attribute 'batch_create_knowledge_points'`）

- [ ] **Step 3: 实现**

在 `repository.py` 追加（import 处补 `from app.teaching.cycles import find_cycle`；若不想让存储层依赖 api.messages，可用普通 `ValueError` 并由 API 层转译——**选 ValueError 方案**，避免存储层耦合 Web 层。测试相应 `pytest.raises(ValueError)`）：

```python
    def batch_create_knowledge_points(
        self, owner_id: str, entries: list[tuple[int, str, str, list[str]]]
    ) -> tuple[int, list[dict], list[str]]:
        """批量建点。entries 是 (行号, 名称, 说明, 先修)。

        返回 (created, skipped, ensured_prereqs)。整批单事务；成环抛 ValueError（含成环链）并整批回滚。
        """
        created = 0
        skipped: list[dict] = []
        ensured: list[str] = []
        with self.transaction():
            now = _now()
            existing = {
                row["name"]
                for row in self._conn.execute(
                    "SELECT name FROM knowledge_points WHERE owner_id = ?", (owner_id,)
                )
            }
            for line, name, description, prerequisites in entries:
                if name in existing:
                    skipped.append({"line": line, "name": name, "reason": "重名"})
                    continue
                self._conn.execute(
                    """
                    INSERT INTO knowledge_points (id, owner_id, name, description, prerequisites, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        uuid4().hex,
                        owner_id,
                        name,
                        description,
                        json.dumps(list(prerequisites), ensure_ascii=False),
                        now,
                    ),
                )
                existing.add(name)
                created += 1
                for prereq_name in prerequisites:
                    if prereq_name not in existing:
                        self._ensure_knowledge_point(owner_id, prereq_name, now)
                        existing.add(prereq_name)
                        ensured.append(prereq_name)
            points = [
                KnowledgePoint(
                    id=row["id"],
                    owner_id=row["owner_id"],
                    name=row["name"],
                    description=row["description"],
                    prerequisites=json.loads(row["prerequisites"]),
                )
                for row in self._conn.execute(
                    "SELECT * FROM knowledge_points WHERE owner_id = ? ORDER BY created_at, id",
                    (owner_id,),
                )
            ]
            cycle = find_cycle(points)
            if cycle is not None:
                raise ValueError("先修关系成环：" + " → ".join(cycle))
        return created, skipped, ensured
```

测试里 `pytest.raises(RequestError)` 相应改成 `pytest.raises(ValueError)` 并断言 `"甲" in str(exc_info.value)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `C:\project\ZHIJIAO-HARNESS\backend\.venv\Scripts\python.exe -m pytest tests/test_knowledge.py -v`
Expected: 全部 passed

- [ ] **Step 5: 提交**

```bash
git add backend/app/storage/repository.py backend/tests/test_knowledge.py
git commit -m "知识点批量导入：单事务整批入库、重名跳过、自动补建先修、成环整批回滚。"
```

---

### Task 4: API 层——编辑/删除/批量导入三个路由

**Files:**
- Modify: `backend/app/api/teaching.py`（追加三个 parse 函数）
- Modify: `backend/app/main.py`（`create_teaching_point` 路由后追加三个路由，约 383 行处）
- Test: `backend/tests/test_knowledge.py`（追加 API 测试）

**Interfaces:**
- Consumes: Task 2/3 的 repository 方法；`find_cycle`；`parse_create_point` 里的 `_point_name` 校验；`error_payload`、`require_user`、`RequestError`、`NotFoundError`、`ConflictError`（main.py 已有）
- Produces（前端 Task 6 用）:
  - `PUT /api/teaching/points/{point_id}`：body `{name, description, prerequisites}`，200 `{}`；404/409/400
  - `DELETE /api/teaching/points/{point_id}`：204；404/409
  - `POST /api/teaching/points/batch`：body `{text}`，200 `{created, skipped: [{line, name, reason}], ensured_prereqs: [str]}`；400

- [ ] **Step 1: 写失败测试**

在 `test_knowledge.py` 追加（复用 `_two_teachers` 模式——该函数在 `test_teaching.py`，把同样实现复制过来或从 test_teaching import；**选择复制**，保持测试文件独立）：

```python
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.llm.protocol import AssistantMessage


def _client_pair(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, auth_secret="s3cret"), complete=_stub_complete)
    alice = TestClient(app)
    alice.post("/api/auth/register", json={"username": "alice", "password": "correct-horse", "display_name": "甲"})
    return alice


def _stub_complete(messages, tools):
    return AssistantMessage(content="好", tool_calls=[])


def _create_point(client, name="约分", prerequisites=None) -> str:
    response = client.post(
        "/api/teaching/points",
        json={"name": name, "description": "", "prerequisites": prerequisites or []},
    )
    assert response.status_code == 201
    return response.json()["point_id"]


def test_api_update_point_rejects_cycle(tmp_path):
    alice = _client_pair(tmp_path)
    _create_point(alice, "约分", [])
    tongfen = _create_point(alice, "通分", ["约分"])

    # 把约分的先修改成通分 -> 约分->通分->约分 成环
    points = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    yuefen_id = points["约分"]["point_id"]

    response = alice.put(
        f"/api/teaching/points/{yuefen_id}",
        json={"name": "约分", "description": "", "prerequisites": ["通分"]},
    )

    assert response.status_code == 400
    assert "约分" in response.json()["message"]
    # 原数据未被破坏
    points_after = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    assert points_after["约分"]["prerequisites"] == []
    assert points_after["通分"]["prerequisites"] == ["约分"]
    # 未用到的 tongfen 变量消除告警
    assert tongfen


def test_api_update_point_ok_and_not_found(tmp_path):
    alice = _client_pair(tmp_path)
    point_id = _create_point(alice, "约分", [])

    ok = alice.put(
        f"/api/teaching/points/{point_id}",
        json={"name": "约分与化简", "description": "新说明", "prerequisites": []},
    )
    assert ok.status_code == 200
    missing = alice.put(
        "/api/teaching/points/" + "0" * 32,
        json={"name": "新名", "description": "", "prerequisites": []},
    )
    assert missing.status_code == 404


def test_api_delete_point(tmp_path):
    alice = _client_pair(tmp_path)
    point_id = _create_point(alice, "约分", [])
    _create_point(alice, "通分", ["约分"])

    ok = alice.delete(f"/api/teaching/points/{point_id}")
    assert ok.status_code == 204
    points = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    assert "约分" not in points
    assert points["通分"]["prerequisites"] == []

    missing = alice.delete(f"/api/teaching/points/{point_id}")
    assert missing.status_code == 404


def test_api_delete_point_with_scores_conflicts(tmp_path):
    alice = _client_pair(tmp_path)
    class_response = alice.post(
        "/api/teaching/classes", json={"name": "三年二班", "students": ["小明"]}
    )
    class_id = class_response.json()["class_id"]
    alice.post(
        "/api/teaching/assignments",
        json={
            "class_id": class_id,
            "title": "测验",
            "kind": "quiz",
            "records": [{"student": "小明", "scores": {"约分": 60}}],
        },
    )
    points = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}

    response = alice.delete(f"/api/teaching/points/{points['约分']['point_id']}")

    assert response.status_code == 409


def test_api_batch_import(tmp_path):
    alice = _client_pair(tmp_path)

    response = alice.post(
        "/api/teaching/points/batch",
        json={"text": "分数加减 | 同分母加减 | \n约分 | 化简分数 | 分数加减\n\n通分 | ｜ 全角分隔 | 约分,约分"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["created"] == 3
    assert body["skipped"] == []
    assert body["ensured_prereqs"] == []
    points = {item["name"]: item for item in alice.get("/api/teaching/overview").json()["knowledge_points"]}
    assert points["通分"]["prerequisites"] == ["约分"]


def test_api_batch_import_skips_existing(tmp_path):
    alice = _client_pair(tmp_path)
    _create_point(alice, "约分", [])

    response = alice.post(
        "/api/teaching/points/batch",
        json={"text": "约分 | 重复 | \n通分 | | 约分"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["created"] == 1
    assert body["skipped"] == [{"line": 1, "name": "约分", "reason": "重名"}]
    assert body["ensured_prereqs"] == []


def test_api_batch_import_rejects_oversize(tmp_path):
    alice = _client_pair(tmp_path)

    response = alice.post(
        "/api/teaching/points/batch",
        json={"text": "甲 | | \n" * 20000},
    )

    assert response.status_code == 400


def test_api_batch_import_rolls_back_cycle(tmp_path):
    alice = _client_pair(tmp_path)

    response = alice.post(
        "/api/teaching/points/batch",
        json={"text": "甲 | | 乙\n乙 | | 甲"},
    )

    assert response.status_code == 400
    overview = alice.get("/api/teaching/overview").json()
    assert overview["knowledge_points"] == []
```

注意全角分隔符测试：第三行 `通分 | ｜ 全角分隔 | 约分,约分` 中第二个字段是 `｜ 全角分隔`——**修正测试**：全角分隔符只在字段间分隔用（`通分 ｜ | 约分`），字段内容不含分隔符。改第三行为 `"通分｜｜约分,约分"`（全角管道、全角空字段），并断言 `points["通分"]["prerequisites"] == ["约分"]`（先修内重复的 `约分,约分` 去重）。

- [ ] **Step 2: 运行测试确认失败**

Run: `C:\project\ZHIJIAO-HARNESS\backend\.venv\Scripts\python.exe -m pytest tests/test_knowledge.py -v`
Expected: 新增 8 个用例 FAIL（404 Not Found——路由不存在）

- [ ] **Step 3: 实现**

`app/api/teaching.py` 追加（复用已有 `_point_name`）：

```python
MAX_BATCH_CHARS = 100_000
BATCH_LINE_MESSAGE = "每行写成「名称 | 说明 | 先修1,先修2」，说明和先修可以留空。"


def parse_update_point(body: object) -> tuple[str, str, list[str]]:
    """与 parse_create_point 相同的结构校验。"""
    return parse_create_point(body)


def parse_batch_points(body: object) -> list[tuple[int, str, str, list[str]]]:
    """解析批量导入文本。每行「名称 | 说明 | 先修1,先修2」，行内分隔符 | 或 ｜，先修分隔 , ， 、。"""
    if not isinstance(body, dict) or not set(body) <= {"text"}:
        raise RequestError("fields", public_message=UNKNOWN_FIELD_MESSAGE)
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        raise RequestError("text", public_message=BATCH_LINE_MESSAGE)
    if len(text) > MAX_BATCH_CHARS:
        raise RequestError("text", public_message="批量导入文本不超过 10 万字符。")
    entries: list[tuple[int, str, str, list[str]]] = []
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        parts = [part.strip() for part in re.split(r"[|｜]", line)]
        if len(parts) > 3:
            raise RequestError("text", public_message=BATCH_LINE_MESSAGE)
        name = _point_name(parts[0])
        description = ""
        prerequisites: list[str] = []
        if len(parts) >= 2 and parts[1]:
            description = parts[1]
            if len(description) > 500:
                raise RequestError("description", public_message="说明写成不超过 500 个字。")
        if len(parts) == 3 and parts[2]:
            seen: set[str] = set()
            for item in re.split(r"[,，、]", parts[2]):
                if not item.strip():
                    continue
                point_name = _point_name(item.strip())
                if point_name not in seen:
                    seen.add(point_name)
                    prerequisites.append(point_name)
        entries.append((line_number, name, description, prerequisites))
    if not entries:
        raise RequestError("text", public_message="没有可导入的行。")
    return entries
```

`app/main.py` 在 `create_teaching_point` 路由（约 383 行 `return JSONResponse({"point_id": point_id}, status_code=201)` 之后）追加：

```python
    @app.put("/api/teaching/points/{point_id}")
    async def update_teaching_point(point_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            name, description, prerequisites = parse_update_point(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except RequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        try:
            data = repository.load_teaching(user.id)
            target = next((item for item in data.knowledge_points if item.id == point_id), None)
            if target is None:
                return JSONResponse(error_payload("not_found"), status_code=404)
            # 假想保存后的全量点集：先自动补建缺失先修（内存中），再做环检测
            imagined = []
            existing_names = {item.name for item in data.knowledge_points if item.id != point_id}
            imagined_names = set(existing_names)
            imagined.append(
                KnowledgePoint(id=point_id, owner_id=user.id, name=name, description=description, prerequisites=prerequisites)
            )
            imagined.extend(item for item in data.knowledge_points if item.id != point_id)
            for prereq_name in prerequisites:
                if prereq_name not in imagined_names and prereq_name != name:
                    imagined.append(
                        KnowledgePoint(
                            id=f"new:{prereq_name}",
                            owner_id=user.id,
                            name=prereq_name,
                            description="",
                            prerequisites=[],
                        )
                    )
                    imagined_names.add(prereq_name)
            cycle = find_cycle(imagined)
            if cycle is not None:
                return JSONResponse(
                    error_payload("cycle", "先修关系成环：" + " → ".join(cycle)),
                    status_code=400,
                )
            now = _now()
            with repository.transaction():
                for prereq_name in prerequisites:
                    if prereq_name != name:
                        repository._ensure_knowledge_point(user.id, prereq_name, now)
                repository.update_knowledge_point(user.id, point_id, name, description, prerequisites)
        except NotFoundError:
            return JSONResponse(error_payload("not_found"), status_code=404)
        except ConflictError:
            return JSONResponse(error_payload("conflict", "这个知识点名称已经存在。"), status_code=409)
        return {}

    @app.delete("/api/teaching/points/{point_id}")
    def delete_teaching_point(point_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            repository.delete_knowledge_point(user.id, point_id)
        except NotFoundError:
            return JSONResponse(error_payload("not_found"), status_code=404)
        except ConflictError:
            return JSONResponse(error_payload("conflict", "该知识点已有成绩记录，不能删除。"), status_code=409)
        return Response(status_code=204)

    @app.post("/api/teaching/points/batch")
    async def batch_import_points(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            entries = parse_batch_points(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except RequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        try:
            created, skipped, ensured = repository.batch_create_knowledge_points(user.id, entries)
        except ValueError as exc:
            return JSONResponse(error_payload("cycle", str(exc)), status_code=400)
        return {"created": created, "skipped": skipped, "ensured_prereqs": ensured}
```

main.py 需要：`from app.api.teaching import parse_update_point, parse_batch_points`（追加到现有 teaching import 行）、`from app.teaching.cycles import find_cycle`、`from app.storage.protocol import KnowledgePoint`、`_now`（查 main.py 是否已 import `_now`——repository 的 `_now` 是模块级私有函数，main 里改用 `from app.storage.repository import _now` 或在路由内用 `datetime` 生成；**选**：给 `update_teaching_point` 里用 `from datetime import datetime, timezone` 生成 `now = datetime.now(timezone.utc).isoformat()`）。

**路由顺序**：`POST /api/teaching/points/batch` 必须能匹配——FastAPI 中 `/points/batch`（POST）与 `/points`（POST）不冲突，但与 PUT/DELETE 的 `{point_id}` 路径参数在不同 method 下无冲突，无需调整顺序。

**私有方法耦合**：`repository._ensure_knowledge_point` 是私有方法，API 层直接调用不优雅。更好的做法是给 repository 加公开方法：

```python
    def ensure_knowledge_point(self, owner_id: str, name: str) -> str:
        """不存在则补建（描述为空、无先修），返回 point_id。须在 transaction 内调用。"""
        return self._ensure_knowledge_point(owner_id, name, _now())
```

API 层用 `repository.ensure_knowledge_point(user.id, prereq_name)`。**采用这个方案**，别在 main.py 调私有方法。

- [ ] **Step 4: 运行测试确认通过**

Run: `C:\project\ZHIJIAO-HARNESS\backend\.venv\Scripts\python.exe -m pytest tests/ -v`
Expected: 全部 passed（含既有 110+ 用例）

- [ ] **Step 5: 提交**

```bash
git add backend/app/api/teaching.py backend/app/main.py backend/app/storage/repository.py backend/tests/test_knowledge.py
git commit -m "知识点 API：编辑（环校验+自动补建先修）、删除（成绩拦截）、批量导入（解析+回滚）。"
```

---

### Task 5: 前端类型与 API 封装

**Files:**
- Modify: `frontend/src/types/api.ts`（`TeachingApi` 接口追加三个方法）
- Modify: `frontend/src/api/http.ts`（`teachingApi` 实现追加）
- Modify: `frontend/src/lib/appearance.tsx`（zh/en 词表追加）

**Interfaces:**
- Consumes: Task 4 的三个 HTTP 端点
- Produces（Task 6 组件用）:
  - `TeachingApi.updatePoint(pointId: string, name: string, description: string, prerequisites: string[]): Promise<void>`
  - `TeachingApi.deletePoint(pointId: string): Promise<void>`
  - `TeachingApi.batchImportPoints(text: string): Promise<{ created: number; skipped: { line: number; name: string; reason: string }[]; ensured_prereqs: string[] }>`
  - 词表 key（Task 6 直接 `t("...")`）：`editPoint`、`deletePoint`、`deletePointConfirm`、`deletePointBlocked`、`batchImport`、`batchImportPlaceholder`、`parsePreview`、`confirmImport`、`importResult`（含 `{created}` 插值语义——实现为函数拼接，词表只存模板）、`pointGraph`、`pointList`、`graphTooMany`、`saveChanges`、`cancelEdit`、`importCreated`、`importSkipped`、`importEnsured`

- [ ] **Step 1: 类型定义**

`types/api.ts` 的 `TeachingApi` 接口追加：

```typescript
  /** 编辑知识点：改名同步引用；先修引用不存在时后端自动补建 */
  updatePoint(pointId: string, name: string, description: string, prerequisites: string[]): Promise<void>;
  /** 删除知识点；有成绩记录时后端 409 */
  deletePoint(pointId: string): Promise<void>;
  /** 批量导入：每行「名称 | 说明 | 先修1,先修2」 */
  batchImportPoints(text: string): Promise<BatchImportResult>;
```

类型区追加：

```typescript
/** POST /api/teaching/points/batch 的返回 */
export type BatchImportResult = {
  created: number;
  skipped: { line: number; name: string; reason: string }[];
  ensured_prereqs: string[];
};
```

- [ ] **Step 2: API 实现**

`http.ts` 的 `teachingApi` 追加：

```typescript
  updatePoint: async (pointId, name, description, prerequisites) => {
    await request(`/api/teaching/points/${pointId}`, {
      method: "PUT",
      body: JSON.stringify({ name, description, prerequisites }),
    });
  },
  deletePoint: async (pointId) => {
    await request(`/api/teaching/points/${pointId}`, { method: "DELETE" });
  },
  batchImportPoints: async (text) => {
    const body = await request("/api/teaching/points/batch", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    const record = recordOf(body);
    return {
      created: typeof record.created === "number" ? record.created : 0,
      skipped: readList(record.skipped, (r) => ({
        line: typeof r.line === "number" ? r.line : 0,
        name: readText(r.name),
        reason: readText(r.reason),
      })),
      ensured_prereqs: Array.isArray(record.ensured_prereqs)
        ? record.ensured_prereqs.filter((s): s is string => typeof s === "string")
        : [],
    };
  },
```

核对 `request()` 对 204 的处理：读 `http.ts` 的 `request` 函数，若它对空 body `JSON.parse` 会抛错，需让 DELETE 的 204 走通（现有 logout 已处理 204——`readAuthResult` 前有 204 分支参考，照抄该模式；若 `request` 已统一容忍空 body 则无需改）。

- [ ] **Step 3: 词表**

`appearance.tsx` 的 `zh` 对象追加：

```typescript
  editPoint: "编辑",
  deletePoint: "删除",
  deletePointConfirm: "删除这个知识点？没有成绩记录才能删除。",
  deletePointBlocked: "该知识点已有成绩记录，不能删除。",
  batchImport: "批量导入",
  batchImportPlaceholder: "每行一个知识点：名称 | 说明 | 先修1,先修2\n例如：通分 | 化成同分母 | 约分,分数加减",
  parsePreview: "解析预览",
  confirmImport: "确认导入",
  importResult: "导入完成",
  importCreated: "新建",
  importSkipped: "跳过",
  importEnsured: "自动补建先修",
  pointGraph: "图谱",
  pointList: "列表",
  graphTooMany: "知识点较多，仅展示前 60 个。",
  saveChanges: "保存修改",
  cancelEdit: "取消",
```

`en` 对象追加对应英文：

```typescript
  editPoint: "Edit",
  deletePoint: "Delete",
  deletePointConfirm: "Delete this point? Only points without scores can be deleted.",
  deletePointBlocked: "This point has score records and cannot be deleted.",
  batchImport: "Batch import",
  batchImportPlaceholder: "One point per line: name | description | prereq1,prereq2\ne.g. Common denominator | same denominator | reduce,fraction add",
  parsePreview: "Preview",
  confirmImport: "Import",
  importResult: "Imported",
  importCreated: "created",
  importSkipped: "skipped",
  importEnsured: "auto-created prerequisites",
  pointGraph: "Graph",
  pointList: "List",
  graphTooMany: "Too many points; showing the first 60.",
  saveChanges: "Save",
  cancelEdit: "Cancel",
```

- [ ] **Step 4: typecheck**

Run: `$env:PATH = "C:\Users\zihan\tools\node-v24.22.1-win-x64;$env:PATH"; npm run typecheck`（cwd `frontend/`）
Expected: 0 错误（`TeachingApi` 实现与定义匹配）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/types/api.ts frontend/src/api/http.ts frontend/src/lib/appearance.tsx
git commit -m "知识点前端 API：编辑/删除/批量导入封装与中英文案。"
```

---

### Task 6: 前端组件——列表编辑/删除与批量导入

**Files:**
- Modify: `frontend/src/components/TeachingPanel.tsx`（`PointsView` 重写）
- Modify: `frontend/src/styles.css`（追加样式）

**Interfaces:**
- Consumes: Task 5 的 `updatePoint/deletePoint/batchImportPoints` 与词表；现有 `run()` 包装器（TeachingPanel 内已有）、`TeachingOverview`
- Produces: `PointsView` 对外签名不变（`{ api, overview, busy, run }`）；内部新增 `GraphView`（同文件函数组件，Task 7 使用）

- [ ] **Step 1: 重写 PointsView**

`TeachingPanel.tsx` 中替换整个 `PointsView`（保留原有单条创建表单，追加列表操作与批量导入）：

```tsx
function PointsView({
  api,
  overview,
  busy,
  run,
}: {
  api: TeachingApi;
  overview: TeachingOverview;
  busy: boolean;
  run: (action: () => Promise<void>, successMessage: string) => Promise<void>;
}) {
  const { t } = useAppearance();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prerequisites, setPrerequisites] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrerequisites, setEditPrerequisites] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [batchText, setBatchText] = useState("");
  const [batchPreview, setBatchPreview] = useState<{ line: number; name: string; prereqs: string[] }[] | null>(null);
  const [batchResult, setBatchResult] = useState<BatchImportResult | null>(null);
  const [view, setView] = useState<"list" | "graph">("list");

  function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const list = splitNames(prerequisites);
    void run(async () => {
      await api.createPoint(trimmedName, description.trim(), list);
      setName("");
      setDescription("");
      setPrerequisites("");
    }, "知识点已保存。");
  }

  function splitNames(text: string): string[] {
    return text
      .split(/[,，、]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  function startEdit(point: TeachingPointSummary) {
    setEditingId(point.point_id);
    setEditName(point.name);
    setEditDescription(point.description);
    setEditPrerequisites(point.prerequisites.join("，"));
    setEditError(null);
  }

  function saveEdit() {
    if (!editingId || !editName.trim()) return;
    void run(async () => {
      await api.updatePoint(editingId, editName.trim(), editDescription.trim(), splitNames(editPrerequisites));
      setEditingId(null);
    }, "知识点已更新。").catch(() => {
      // run 已把错误展示在全局 notice；这里保留表单展开
    });
  }

  async function removePoint(point: TeachingPointSummary) {
    if (!window.confirm(t("deletePointConfirm"))) return;
    await run(async () => {
      await api.deletePoint(point.point_id);
    }, "知识点已删除。").catch(() => {
      // 409 时 run 展示后端消息
    });
  }

  function parseBatch() {
    const lines = batchText
      .split("\n")
      .map((line, index) => ({ line: index + 1, text: line.trim() }))
      .filter((item) => item.text.length > 0);
    setBatchResult(null);
    setBatchPreview(
      lines.map((item) => {
        const parts = item.text.split(/[|｜]/).map((part) => part.trim());
        return {
          line: item.line,
          name: parts[0] ?? "",
          prereqs: parts.length >= 3 ? splitNames(parts[2]) : [],
        };
      }),
    );
  }

  function submitBatch() {
    if (!batchText.trim()) return;
    void run(async () => {
      const result = await api.batchImportPoints(batchText);
      setBatchResult(result);
      setBatchText("");
      setBatchPreview(null);
    }, t("importResult") + "。");
  }

  // 渲染结构（列表视图）：
  // 1) 原「新建知识点」表单（不动）
  // 2) <details className="teaching-batch"> 批量导入：textarea + 解析预览 + 确认导入 + 结果摘要
  // 3) 列表：每项「编辑」「删除」按钮；editingId 匹配项展开内联编辑表单
  // 4) 「列表 / 图谱」切换（图谱在 Task 7 接入，本任务先放切换按钮与占位）
  return (
    <div className="teaching-body">
      {/* 新建表单：原 submit 逻辑不变 */}
      {/* 批量导入、列表操作、视图切换按上述状态与函数实现 */}
    </div>
  );
}
```

上面是骨架；实现时**必须完整写出 JSX**（新建表单沿用现有代码，批量导入 details、列表 item 含编辑/删除按钮、内联编辑三输入框 + 保存/取消 + 错误行、视图切换两个按钮），不留注释占位。`run` 的签名以 `TeachingPanel.tsx` 现有实现为准（读文件确认——它可能不返回 Promise，若是 void 则 `saveEdit/removePoint` 里不用 `.catch`，改用 try/catch 包 await）。

- [ ] **Step 2: 样式**

`styles.css` 追加（沿用现有变量）：

```css
.teaching-batch {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--white);
  padding: 12px 14px;
}

.teaching-batch summary {
  cursor: pointer;
  font-size: 14px;
  color: var(--ink);
}

.teaching-batch textarea {
  width: 100%;
  min-height: 96px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--paper);
  font-size: 14px;
}

.teaching-batch .batch-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.teaching-item-actions {
  display: flex;
  gap: 6px;
}

.teaching-item-actions button {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--white);
  padding: 3px 10px;
  font-size: 13px;
  cursor: pointer;
}

.teaching-item-actions button:hover {
  border-color: var(--accent);
}

.point-edit-error {
  color: var(--danger);
  font-size: 13px;
}

.point-view-switch {
  display: inline-flex;
  gap: 4px;
  margin-bottom: 10px;
}
```

- [ ] **Step 3: typecheck + 既有测试**

Run: `$env:PATH = "C:\Users\zihan\tools\node-v24.22.1-win-x64;$env:PATH"; npm run typecheck; npm test`（cwd `frontend/`）
Expected: 0 错误；既有测试全过

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/TeachingPanel.tsx frontend/src/styles.css
git commit -m "知识点列表：内联编辑、删除确认与拦截提示、批量导入折叠区（预览+结果摘要）。"
```

---

### Task 7: 图谱视图 + 组件测试

**Files:**
- Create: `frontend/src/components/PointGraph.tsx`
- Modify: `frontend/src/components/TeachingPanel.tsx`（`PointsView` 视图切换接 `PointGraph`，删除 Task 6 占位）
- Test: `frontend/src/components/PointGraph.test.tsx`（新建）

**Interfaces:**
- Consumes: `TeachingPointSummary[]`；`useAppearance` 词表（`graphTooMany`、`editPoint`）
- Produces: `PointGraph({ points, onSelect }: { points: TeachingPointSummary[]; onSelect: (pointId: string) => void })`——SVG 分层依赖图；点击节点回调 pointId（TeachingPanel 用它切换到列表并展开编辑）

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/components/PointGraph.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PointGraph } from "./PointGraph";
import type { TeachingPointSummary } from "../types/api";

const points: TeachingPointSummary[] = [
  { point_id: "p1", name: "分数加减", description: "", prerequisites: [] },
  { point_id: "p2", name: "约分", description: "", prerequisites: ["分数加减"] },
  { point_id: "p3", name: "通分", description: "", prerequisites: ["约分"] },
];

describe("PointGraph", () => {
  it("按先修分层渲染节点与连线", () => {
    render(<PointGraph points={points} onSelect={() => {}} />);

    expect(screen.getByText("分数加减")).toBeTruthy();
    expect(screen.getByText("约分")).toBeTruthy();
    expect(screen.getByText("通分")).toBeTruthy();
    // 三层各一个点：svg 里应有 3 个节点矩形与 2 条先修连线
    const svg = document.querySelector("svg.point-graph");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("rect.point-node").length).toBe(3);
    expect(svg!.querySelectorAll("line.point-edge").length).toBe(2);
  });

  it("点击节点回调 pointId", () => {
    const onSelect = vi.fn();
    render(<PointGraph points={points} onSelect={onSelect} />);

    screen.getByText("约分").closest("g.point-node")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith("p2");
  });

  it("成环的点标红", () => {
    const cyclic: TeachingPointSummary[] = [
      { point_id: "a", name: "甲", description: "", prerequisites: ["乙"] },
      { point_id: "b", name: "乙", description: "", prerequisites: ["甲"] },
    ];
    render(<PointGraph points={cyclic} onSelect={() => {}} />);

    const svg = document.querySelector("svg.point-graph");
    const marked = svg!.querySelectorAll("rect.point-node.is-cyclic");
    expect(marked.length).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `$env:PATH = "C:\Users\zihan\tools\node-v24.22.1-win-x64;$env:PATH"; npm test -- PointGraph`（cwd `frontend/`）
Expected: FAIL — 无法解析 `./PointGraph`

- [ ] **Step 3: 实现 PointGraph**

新建 `frontend/src/components/PointGraph.tsx`：

```tsx
import { useMemo } from "react";
import type { TeachingPointSummary } from "../types/api";

const NODE_W = 96;
const NODE_H = 34;
const GAP_X = 28;
const GAP_Y = 64;
const PADDING = 16;
const MAX_NODES = 60;

type Layered = {
  point: TeachingPointSummary;
  layer: number;
  index: number;
  cyclic: boolean;
};

/** 拓扑分层：无先修（或先修都不可达）为第 0 层；层级 = 1 + 最深先修层级。成环点聚到最后一层标红。 */
function layout(points: TeachingPointSummary[]): { rows: Layered[][]; byId: Map<string, { x: number; y: number; layered: Layered }> } {
  const usable = points.slice(0, MAX_NODES);
  const byName = new Map(usable.map((p) => [p.name, p]));
  const layerOf = new Map<string, number>();
  const cyclicNames = new Set<string>();

  function resolve(name: string, visiting: Set<string>): number {
    if (layerOf.has(name)) return layerOf.get(name)!;
    const point = byName.get(name);
    if (!point) return -1;
    if (visiting.has(name)) {
      for (const item of visiting) cyclicNames.add(item);
      return 0;
    }
    visiting.add(name);
    let depth = 0;
    for (const prereq of point.prerequisites) {
      const prereqPoint = byName.get(prereq);
      if (prereqPoint) depth = Math.max(depth, resolve(prereq, visiting) + 1);
    }
    visiting.delete(name);
    layerOf.set(name, cyclicNames.has(name) ? Number.MAX_SAFE_INTEGER : depth);
    return depth;
  }

  for (const point of usable) resolve(point.name, new Set());

  const maxNormalLayer = Math.max(
    0,
    ...usable.filter((p) => !cyclicNames.has(p.name)).map((p) => layerOf.get(p.name) ?? 0),
  );
  const cyclicLayer = maxNormalLayer + 1;
  const rows: Layered[][] = [];
  for (const point of usable) {
    const layer = cyclicNames.has(point.name) ? cyclicLayer : layerOf.get(point.name) ?? 0;
    const row = (rows[layer] ??= []);
    row.push({ point, layer, index: row.length, cyclic: cyclicNames.has(point.name) });
  }

  const positions = new Map<string, { x: number; y: number; layered: Layered }>();
  rows.forEach((row, layer) => {
    row.forEach((layered) => {
      positions.set(layered.point.point_id, {
        x: PADDING + layered.index * (NODE_W + GAP_X),
        y: PADDING + layer * (NODE_H + GAP_Y),
        layered,
      });
    });
  });
  return { rows, byId: positions };
}

export function PointGraph({ points, onSelect }: { points: TeachingPointSummary[]; onSelect: (pointId: string) => void }) {
  const { rows, byId } = useMemo(() => layout(points), [points]);
  const truncated = points.length > MAX_NODES;
  const width = Math.max(...rows.map((row) => PADDING * 2 + row.length * (NODE_W + GAP_X) - GAP_X), 200);
  const height = PADDING * 2 + rows.length * (NODE_H + GAP_Y) - GAP_Y;

  const edges = points.slice(0, MAX_NODES).flatMap((point) =>
    point.prerequisites
      .map((prereqName) => {
        const from = [...byId.values()].find((pos) => pos.layered.point.name === prereqName);
        const to = byId.get(point.point_id);
        if (!from || !to) return null;
        return { from, to };
      })
      .filter((edge): edge is { from: { x: number; y: number }; to: { x: number; y: number } } => edge !== null),
  );

  return (
    <div className="point-graph-wrap">
      {truncated ? <p className="teaching-notice">知识点较多，仅展示前 60 个。</p> : null}
      <svg className="point-graph" width={width} height={Math.max(height, 120)} role="img" aria-label="知识点先修图谱">
        {edges.map((edge, i) => (
          <line
            key={i}
            className="point-edge"
            x1={edge.from.x + NODE_W / 2}
            y1={edge.from.y + NODE_H}
            x2={edge.to.x + NODE_W / 2}
            y2={edge.to.y}
          />
        ))}
        {rows.flatMap((row) =>
          row.map((layered) => {
            const pos = byId.get(layered.point.point_id)!;
            return (
              <g
                key={layered.point.point_id}
                className={"point-node" + (layered.cyclic ? " is-cyclic" : "")}
                transform={`translate(${pos.x}, ${pos.y})`}
                onClick={() => onSelect(layered.point.point_id)}
              >
                <rect className="point-node-box" width={NODE_W} height={NODE_H} rx={8} />
                <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle">
                  {layered.point.name}
                </text>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}
```

**注意**：测试断言的是 `rect.point-node`，而上面 JSX 的 rect 类名是 `point-node-box`（`g` 才是 `point-node`）。**统一为**：测试改断言 `g.point-node`（`svg.querySelectorAll("g.point-node").length === 3`、`g.point-node.is-cyclic`），与实现一致。连线数断言 `line.point-edge` 与实现一致。点击测试 `screen.getByText("约分").closest("g.point-node")` 与实现一致。

`TeachingPanel.tsx` 的 `PointsView` 视图切换处接入：

```tsx
{view === "graph" ? (
  <PointGraph
    points={overview.knowledge_points}
    onSelect={(pointId) => {
      const point = overview.knowledge_points.find((item) => item.point_id === pointId);
      if (point) {
        setView("list");
        startEdit(point);
      }
    }}
  />
) : (
  /* 列表视图 JSX */
)}
```

- [ ] **Step 4: 样式**

`styles.css` 追加：

```css
.point-graph-wrap {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--white);
  padding: 8px;
}

.point-graph .point-edge {
  stroke: var(--faint);
  stroke-width: 1.5;
}

.point-graph .point-node-box {
  fill: var(--user);
  stroke: var(--accent);
  stroke-width: 1;
}

.point-graph .point-node.is-cyclic .point-node-box {
  fill: var(--danger-bg);
  stroke: var(--danger);
}

.point-graph .point-node text {
  font-size: 13px;
  fill: var(--ink);
}

.point-graph .point-node {
  cursor: pointer;
}
```

- [ ] **Step 5: typecheck + 全部测试**

Run: `$env:PATH = "C:\Users\zihan\tools\node-v24.22.1-win-x64;$env:PATH"; npm run typecheck; npm test`（cwd `frontend/`）
Expected: 0 错误；全部通过（含 PointGraph 3 个新用例）

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/PointGraph.tsx frontend/src/components/PointGraph.test.tsx frontend/src/components/TeachingPanel.tsx frontend/src/styles.css
git commit -m "知识点图谱：拓扑分层 SVG，先修箭头连线，成环标红，点击节点进入编辑。"
```

---

### Task 8: 全量回归与验收核对

**Files:**
- 无新改动（只跑测试与手工核对）

- [ ] **Step 1: 后端全量**

Run: `C:\project\ZHIJIAO-HARNESS\backend\.venv\Scripts\python.exe -m pytest tests/ -v`（cwd `backend/`）
Expected: 全部通过（既有 110+ 加 test_knowledge.py 新增约 19 个）

- [ ] **Step 2: 前端全量**

Run: `$env:PATH = "C:\Users\zihan\tools\node-v24.22.1-win-x64;$env:PATH"; npm run typecheck; npm test`（cwd `frontend/`）
Expected: 0 错误；全部通过

- [ ] **Step 3: 对照规格验收清单**

逐条核对 `docs/superpowers/specs/2026-11-03-knowledge-library.md` 第 8 节：

1. 编辑已有成绩的知识点名称 → 学情洞察与成绩显示新名（test_update_point_renames_references 覆盖 join 派生名）
2. 成环 400 且消息含环链（test_api_update_point_rejects_cycle、test_api_batch_import_rolls_back_cycle）
3. 删除有成绩点 409（test_api_delete_point_with_scores_conflicts）
4. 5 行大纲导入重名跳过有明细（test_api_batch_import_skips_existing）
5. 图谱分层渲染箭头、点击节点可编辑（PointGraph 3 用例）
6. 既有测试全过（Step 1/2）

- [ ] **Step 4: 若有失败**

按 systematic-debugging 排查修复后重跑，不过不提交。

- [ ] **Step 5: 最终提交（如有修复）**

```bash
git add -A
git commit -m "知识点库回归修复。"
```

---

## Self-Review 记录

- **Spec 覆盖**：编辑（T2/T4）、改名同步（T2）、环校验（T1/T4）、删除拦截（T2/T4）、批量导入（T3/T4）、图谱（T7）、词表 zh/en（T5）、>60 截断（T7）、测试（各任务内嵌）——全覆盖。
- **类型一致性**：`batch_create_knowledge_points` 参数以 Task 3 测试的四元组 `(line, name, description, prerequisites)` 为准（Interfaces 处已显式修正）；`PointGraph` 断言统一为 `g.point-node`；`ensure_knowledge_point` 公开方法在 T4 定义、T4 使用。
- **占位符**：Task 6 Step 1 的 JSX 骨架注明「实现时必须完整写出」，这是给实现者的显式指令而非计划占位；其余步骤均有完整代码。
