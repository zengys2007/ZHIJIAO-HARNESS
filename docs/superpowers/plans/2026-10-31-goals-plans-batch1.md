# 目标与计划管理 · 批 1 实现计划（目标树域 + 基础 GoalsView）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付「目标与计划管理」批 1——后端目标树存储与 API（含课标模板、层级校验、属主隔离），前端基础 GoalsView 并接入 PlusMenu「目标」入口。

**Architecture:** 独立领域模块（设计文档 `docs/superpowers/specs/2026-10-31-goals-plans-design.md`）：SQLite 新增 `goal_trees`/`goal_nodes` 两表进现有仓储；`app/api/goals.py` 承担请求解析与响应组装，路由定义在 `main.py` 的 `create_app` 内（沿用现有闭包风格）；课标骨架为 `app/goals/templates.py` 代码常量；前端新增 `types/goals.ts`、`api/goals.ts`、`pages/GoalsView.tsx`，Workbench 视图状态扩展 `"goals"` 分支。批 2（计划/映射）、批 3（AI 拆解/导出/快照）、批 4（可用性走查）各出后续计划。

**Tech Stack:** FastAPI + 标准库 sqlite3（现有）、React 19 + Vite + vitest + @testing-library/react（现有）。不新增任何依赖。

## Global Constraints

- 后端命令一律用 `backend\.venv\Scripts\python.exe`；前端命令在 `frontend/` 下执行
- Web 框架（fastapi）只出现在 `backend/app/main.py`；数据库驱动只在 `backend/app/storage/`
- 错误正文统一 `{"error": {code, message, retryable}}`（`app/api/errors.py` 的 `error_payload`）
- 跨属主访问一律 404 `not_found`；未登录 401 `unauthenticated`；层级/数量违规 400 `invalid_input`；删除被引用节点 409 `conflict`
- 层级规则：`semester`/`unit` 的 parent 为空；`lesson` 的 parent 必须是 `unit`；上限 semester ≤ 20、unit ≤ 30、每 unit 下 lesson ≤ 40
- 同一属主同学期允许多棵目标树（无唯一约束）
- 时间戳用仓储现有 `_now()`（UTC Z 格式）；id 用 `uuid4().hex`
- 前端不引入路由库与组件库；API 字段 snake_case 与后端一致
- 提交信息用中文；每个 Task 结束提交一次

---

### Task 1: 仓储——goal_trees / goal_nodes 表与 CRUD

**Files:**
- Modify: `backend/app/storage/protocol.py`（追加类型与协议方法）
- Modify: `backend/app/storage/repository.py`（追加 schema 与方法）
- Test: `backend/tests/goals/test_repository.py`（新建）

**Interfaces:**
- Consumes: 现有 `InputError`/`ConflictError`/`NotFoundError`、`transaction()`、`_now()`
- Produces: `GoalTree`、`GoalNode` dataclass；仓储方法 `create_goal_tree(owner_id, subject, grade, term, title) -> GoalTree`、`list_goal_trees(owner_id, subject=None, grade=None, term=None) -> list[GoalTree]`、`get_goal_tree_for_owner(tree_id, owner_id) -> GoalTree | None`、`rename_goal_tree(tree_id, owner_id, title) -> GoalTree | None`、`delete_goal_tree(tree_id, owner_id) -> bool`、`list_goal_nodes(tree_id, owner_id) -> list[GoalNode] | None`、`create_goal_node(tree_id, owner_id, parent_id, level, title, description, standard_refs, verify_criteria) -> GoalNode`、`update_goal_node(node_id, owner_id, title, description, standard_refs, verify_criteria) -> GoalNode | None`、`delete_goal_node(node_id, owner_id)`、`reorder_goal_node(node_id, owner_id, direction)`。Task 3 的 API 与 Task 5 的前端依赖这些签名。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/goals/test_repository.py`：

```python
"""goal_trees / goal_nodes 仓储行为。"""

import pytest

from app.storage.protocol import ConflictError, InputError, NotFoundError
from app.storage.repository import SqliteRepository


@pytest.fixture()
def repo(tmp_path):
    return SqliteRepository(tmp_path / "app.sqlite")


def _tree(repo, **overrides):
    params = {"subject": "数学", "grade": 7, "term": "上", "title": "七上数学"}
    params.update(overrides)
    return repo.create_goal_tree("owner-1", **params)


def test_create_and_list_goal_trees_filters_by_dimensions(repo):
    _tree(repo)
    _tree(repo, subject="语文", title="七上语文")
    _tree(repo, grade=8, title="八上数学")

    all_trees = repo.list_goal_trees("owner-1")
    assert len(all_trees) == 3  # 同学期多份并存，无唯一约束

    math = repo.list_goal_trees("owner-1", subject="数学", grade=7, term="上")
    assert [t.title for t in math] == ["七上数学"]
    assert repo.list_goal_trees("owner-1", subject="英语") == []


def test_goal_trees_are_isolated_by_owner(repo):
    tree = _tree(repo)
    assert repo.get_goal_tree_for_owner(tree.id, "owner-2") is None
    assert repo.list_goal_trees("owner-2") == []
    assert repo.delete_goal_tree(tree.id, "owner-2") is False
    assert repo.rename_goal_tree(tree.id, "owner-2", "x") is None
    assert repo.list_goal_nodes(tree.id, "owner-2") is None


def test_goal_node_hierarchy_rules(repo):
    tree = _tree(repo)
    root = repo.create_goal_node(
        tree.id, "owner-1", None, "semester", "总目标一", "描述", [], "标准"
    )
    unit = repo.create_goal_node(
        tree.id, "owner-1", None, "unit", "第一单元", "描述", [], "标准"
    )
    lesson = repo.create_goal_node(
        tree.id, "owner-1", unit.id, "lesson", "第 1 课时", "描述", [], "标准"
    )
    nodes = repo.list_goal_nodes(tree.id, "owner-1")
    assert {n.id for n in nodes} == {root.id, unit.id, lesson.id}
    assert lesson.parent_id == unit.id

    # lesson 不能挂根；semester/unit 不能挂别的节点
    with pytest.raises(InputError):
        repo.create_goal_node(tree.id, "owner-1", None, "lesson", "x", "x", [], "x")
    with pytest.raises(InputError):
        repo.create_goal_node(tree.id, "owner-1", root.id, "unit", "x", "x", [], "x")
    # lesson 只能挂 unit
    with pytest.raises(InputError):
        repo.create_goal_node(tree.id, "owner-1", root.id, "lesson", "x", "x", [], "x")
    with pytest.raises(NotFoundError):
        repo.create_goal_node(tree.id, "owner-1", "missing", "lesson", "x", "x", [], "x")


def test_goal_node_limits(repo):
    tree = _tree(repo)
    for i in range(20):
        repo.create_goal_node(tree.id, "owner-1", None, "semester", f"总{i}", "", [], "")
    with pytest.raises(ConflictError):
        repo.create_goal_node(tree.id, "owner-1", None, "semester", "超", "", [], "")

    unit = repo.create_goal_node(tree.id, "owner-1", None, "unit", "单元", "", [], "")
    for i in range(40):
        repo.create_goal_node(tree.id, "owner-1", unit.id, "lesson", f"课{i}", "", [], "")
    with pytest.raises(ConflictError):
        repo.create_goal_node(tree.id, "owner-1", unit.id, "lesson", "超", "", [], "")


def test_update_delete_and_reorder_goal_nodes(repo):
    tree = _tree(repo)
    unit = repo.create_goal_node(tree.id, "owner-1", None, "unit", "单元", "d", ["A"], "c")
    a = repo.create_goal_node(tree.id, "owner-1", unit.id, "lesson", "甲", "", [], "")
    b = repo.create_goal_node(tree.id, "owner-1", unit.id, "lesson", "乙", "", [], "")

    updated = repo.update_goal_node(unit.id, "owner-1", "第一单元", "新描述", ["A", "B"], "新标准")
    assert (updated.title, updated.description, updated.standard_refs, updated.verify_criteria) == (
        "第一单元", "新描述", ["A", "B"], "新标准"
    )
    assert repo.update_goal_node(unit.id, "owner-2", "x", "x", [], "x") is None

    # 有子节点时删除被拒
    with pytest.raises(ConflictError):
        repo.delete_goal_node(unit.id, "owner-1")

    # 重排：甲乙互换
    repo.reorder_goal_node(b.id, "owner-1", "up")
    nodes = {n.id: n for n in repo.list_goal_nodes(tree.id, "owner-1")}
    assert nodes[b.id].sort_order < nodes[a.id].sort_order

    repo.delete_goal_node(a.id, "owner-1")
    repo.delete_goal_node(b.id, "owner-1")
    repo.delete_goal_node(unit.id, "owner-1")  # 子节点清空后可删
    assert repo.list_goal_nodes(tree.id, "owner-1") == []


def test_delete_goal_tree_cascades(repo):
    tree = _tree(repo)
    repo.create_goal_node(tree.id, "owner-1", None, "unit", "单元", "", [], "")
    assert repo.delete_goal_tree(tree.id, "owner-1") is True
    assert repo.get_goal_tree_for_owner(tree.id, "owner-1") is None
    assert repo.list_goal_nodes(tree.id, "owner-1") is None


def test_rename_goal_tree(repo):
    tree = _tree(repo)
    renamed = repo.rename_goal_tree(tree.id, "owner-1", "七上数学-草稿")
    assert renamed.title == "七上数学-草稿"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.\.venv\Scripts\python.exe -m pytest tests/goals/test_repository.py -v`（cwd `backend/`）
Expected: FAIL，`AttributeError: 'SqliteRepository' object has no attribute 'create_goal_tree'`

- [ ] **Step 3: 实现协议类型**

在 `backend/app/storage/protocol.py` 的 `ConversationSummary` 定义之后追加：

```python
GOAL_LEVELS = {"semester", "unit", "lesson"}


@dataclass
class GoalTree:
    id: str
    owner_id: str
    subject: str
    grade: int
    term: str
    title: str
    created_at: str
    updated_at: str


@dataclass
class GoalNode:
    id: str
    tree_id: str
    parent_id: str | None
    level: str
    title: str
    description: str
    standard_refs: list
    verify_criteria: str
    sort_order: int
    created_at: str
    updated_at: str
```

并在 `Repository` 协议里（`artifact_view` 之后、`transaction` 之前）追加方法签名：

```python
    def create_goal_tree(self, owner_id: str, subject: str, grade: int, term: str, title: str) -> GoalTree: ...

    def list_goal_trees(
        self, owner_id: str, subject: str | None = None, grade: int | None = None, term: str | None = None
    ) -> list[GoalTree]: ...

    def get_goal_tree_for_owner(self, tree_id: str, owner_id: str) -> GoalTree | None: ...

    def rename_goal_tree(self, tree_id: str, owner_id: str, title: str) -> GoalTree | None: ...

    def delete_goal_tree(self, tree_id: str, owner_id: str) -> bool: ...

    def list_goal_nodes(self, tree_id: str, owner_id: str) -> list[GoalNode] | None: ...

    def create_goal_node(
        self,
        tree_id: str,
        owner_id: str,
        parent_id: str | None,
        level: str,
        title: str,
        description: str,
        standard_refs: list,
        verify_criteria: str,
    ) -> GoalNode: ...

    def update_goal_node(
        self,
        node_id: str,
        owner_id: str,
        title: str,
        description: str,
        standard_refs: list,
        verify_criteria: str,
    ) -> GoalNode | None: ...

    def delete_goal_node(self, node_id: str, owner_id: str) -> None: ...

    def reorder_goal_node(self, node_id: str, owner_id: str, direction: str) -> None: ...
```

同时在文件顶部 import 处把 `GoalTree`、`GoalNode` 加入需要导出的名字（该文件本身即定义处，无需额外 import）。

- [ ] **Step 4: 实现 SqliteRepository 方法**

在 `backend/app/storage/repository.py`：

4a. 顶部常量区（`LOCAL_ADMIN` 之后）追加：

```python
MAX_SEMESTER_NODES = 20
MAX_UNIT_NODES = 30
MAX_LESSON_NODES = 40
```

4b. import 行把 `GOAL_LEVELS, GoalNode, GoalTree` 加进 `from app.storage.protocol import (...)`。

4c. `SqliteRepository` 类内、`artifact_view` 方法之后追加（`transaction` 之前）：

```python
    # ===== 目标与计划：目标树 =====

    def create_goal_tree(self, owner_id: str, subject: str, grade: int, term: str, title: str) -> GoalTree:
        tree_id = uuid4().hex
        now = _now()
        with self.transaction():
            self._conn.execute(
                """
                INSERT INTO goal_trees (id, owner_id, subject, grade, term, title, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (tree_id, owner_id, subject, grade, term, title, now, now),
            )
        return GoalTree(
            id=tree_id, owner_id=owner_id, subject=subject, grade=grade, term=term,
            title=title, created_at=now, updated_at=now,
        )

    def list_goal_trees(
        self, owner_id: str, subject: str | None = None, grade: int | None = None, term: str | None = None
    ) -> list[GoalTree]:
        clauses = ["owner_id = ?"]
        params: list = [owner_id]
        if subject is not None:
            clauses.append("subject = ?")
            params.append(subject)
        if grade is not None:
            clauses.append("grade = ?")
            params.append(grade)
        if term is not None:
            clauses.append("term = ?")
            params.append(term)
        rows = self._conn.execute(
            f"SELECT * FROM goal_trees WHERE {' AND '.join(clauses)} ORDER BY updated_at DESC, id DESC",
            params,
        ).fetchall()
        return [_goal_tree(row) for row in rows]

    def get_goal_tree_for_owner(self, tree_id: str, owner_id: str) -> GoalTree | None:
        row = self._conn.execute(
            "SELECT * FROM goal_trees WHERE id = ? AND owner_id = ?", (tree_id, owner_id)
        ).fetchone()
        return _goal_tree(row) if row else None

    def rename_goal_tree(self, tree_id: str, owner_id: str, title: str) -> GoalTree | None:
        with self.transaction():
            found = self._conn.execute(
                "SELECT id FROM goal_trees WHERE id = ? AND owner_id = ?", (tree_id, owner_id)
            ).fetchone()
            if found is None:
                return None
            self._conn.execute(
                "UPDATE goal_trees SET title = ?, updated_at = ? WHERE id = ?",
                (title, _now(), tree_id),
            )
        return self.get_goal_tree_for_owner(tree_id, owner_id)

    def delete_goal_tree(self, tree_id: str, owner_id: str) -> bool:
        with self.transaction():
            found = self._conn.execute(
                "SELECT id FROM goal_trees WHERE id = ? AND owner_id = ?", (tree_id, owner_id)
            ).fetchone()
            if found is None:
                return False
            self._conn.execute("DELETE FROM goal_nodes WHERE tree_id = ?", (tree_id,))
            self._conn.execute("DELETE FROM goal_trees WHERE id = ?", (tree_id,))
        return True

    def list_goal_nodes(self, tree_id: str, owner_id: str) -> list[GoalNode] | None:
        if self.get_goal_tree_for_owner(tree_id, owner_id) is None:
            return None
        rows = self._conn.execute(
            """
            SELECT * FROM goal_nodes WHERE tree_id = ?
            ORDER BY parent_id IS NOT NULL, parent_id, sort_order, created_at, id
            """,
            (tree_id,),
        ).fetchall()
        return [_goal_node(row) for row in rows]

    def create_goal_node(
        self,
        tree_id: str,
        owner_id: str,
        parent_id: str | None,
        level: str,
        title: str,
        description: str,
        standard_refs: list,
        verify_criteria: str,
    ) -> GoalNode:
        if level not in GOAL_LEVELS:
            raise InputError("invalid goal level")
        node_id = uuid4().hex
        now = _now()
        with self.transaction():
            if self.get_goal_tree_for_owner(tree_id, owner_id) is None:
                raise NotFoundError("goal tree not found")
            if parent_id is None:
                if level not in ("semester", "unit"):
                    raise InputError("root goal nodes must be semester or unit")
                row = self._conn.execute(
                    "SELECT COUNT(*) AS c FROM goal_nodes WHERE tree_id = ? AND level = ?",
                    (tree_id, level),
                ).fetchone()
                limit = MAX_SEMESTER_NODES if level == "semester" else MAX_UNIT_NODES
                if int(row["c"]) >= limit:
                    raise ConflictError("goal node limit reached")
                sibling_where = "tree_id = ? AND parent_id IS NULL AND level = ?"
                sibling_params: tuple = (tree_id, level)
            else:
                parent = self._conn.execute(
                    "SELECT level FROM goal_nodes WHERE id = ? AND tree_id = ?", (parent_id, tree_id)
                ).fetchone()
                if parent is None:
                    raise NotFoundError("parent goal node not found")
                if parent["level"] != "unit" or level != "lesson":
                    raise InputError("lesson nodes can only sit under a unit")
                row = self._conn.execute(
                    "SELECT COUNT(*) AS c FROM goal_nodes WHERE parent_id = ?", (parent_id,)
                ).fetchone()
                if int(row["c"]) >= MAX_LESSON_NODES:
                    raise ConflictError("goal node limit reached")
                sibling_where = "parent_id = ?"
                sibling_params = (parent_id,)
            sort_row = self._conn.execute(
                f"SELECT COALESCE(MAX(sort_order), 0) + 1 AS s FROM goal_nodes WHERE {sibling_where}",
                sibling_params,
            ).fetchone()
            self._conn.execute(
                """
                INSERT INTO goal_nodes (
                  id, tree_id, parent_id, level, title, description,
                  standard_refs, verify_criteria, sort_order, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    node_id, tree_id, parent_id, level, title, description,
                    json.dumps(standard_refs, ensure_ascii=False), verify_criteria,
                    int(sort_row["s"]), now, now,
                ),
            )
            self._conn.execute(
                "UPDATE goal_trees SET updated_at = ? WHERE id = ?", (now, tree_id)
            )
        node = self._goal_node_by_id(node_id)
        if node is None:
            raise RuntimeError("goal node insert failed")
        return node

    def update_goal_node(
        self,
        node_id: str,
        owner_id: str,
        title: str,
        description: str,
        standard_refs: list,
        verify_criteria: str,
    ) -> GoalNode | None:
        now = _now()
        with self.transaction():
            row = self._conn.execute(
                """
                SELECT goal_nodes.id FROM goal_nodes
                JOIN goal_trees ON goal_trees.id = goal_nodes.tree_id
                WHERE goal_nodes.id = ? AND goal_trees.owner_id = ?
                """,
                (node_id, owner_id),
            ).fetchone()
            if row is None:
                return None
            self._conn.execute(
                """
                UPDATE goal_nodes
                SET title = ?, description = ?, standard_refs = ?, verify_criteria = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    title, description,
                    json.dumps(standard_refs, ensure_ascii=False), verify_criteria, now, node_id,
                ),
            )
            self._conn.execute(
                "UPDATE goal_trees SET updated_at = ? WHERE id = (SELECT tree_id FROM goal_nodes WHERE id = ?)",
                (now, node_id),
            )
        return self._goal_node_by_id(node_id)

    def delete_goal_node(self, node_id: str, owner_id: str) -> None:
        with self.transaction():
            row = self._conn.execute(
                """
                SELECT goal_nodes.id, goal_nodes.tree_id FROM goal_nodes
                JOIN goal_trees ON goal_trees.id = goal_nodes.tree_id
                WHERE goal_nodes.id = ? AND goal_trees.owner_id = ?
                """,
                (node_id, owner_id),
            ).fetchone()
            if row is None:
                raise NotFoundError("goal node not found")
            child = self._conn.execute(
                "SELECT id FROM goal_nodes WHERE parent_id = ? LIMIT 1", (node_id,)
            ).fetchone()
            if child is not None:
                raise ConflictError("goal node still has children")
            self._conn.execute("DELETE FROM goal_nodes WHERE id = ?", (node_id,))
            self._conn.execute(
                "UPDATE goal_trees SET updated_at = ? WHERE id = ?", (_now(), row["tree_id"])
            )

    def reorder_goal_node(self, node_id: str, owner_id: str, direction: str) -> None:
        if direction not in ("up", "down"):
            raise InputError("invalid direction")
        with self.transaction():
            row = self._conn.execute(
                """
                SELECT goal_nodes.* FROM goal_nodes
                JOIN goal_trees ON goal_trees.id = goal_nodes.tree_id
                WHERE goal_nodes.id = ? AND goal_trees.owner_id = ?
                """,
                (node_id, owner_id),
            ).fetchone()
            if row is None:
                raise NotFoundError("goal node not found")
            if row["parent_id"] is None:
                sibling_where = "tree_id = ? AND parent_id IS NULL AND level = ?"
                sibling_params: tuple = (row["tree_id"], row["level"])
            else:
                sibling_where = "parent_id = ?"
                sibling_params = (row["parent_id"],)
            cmp_op = "<" if direction == "up" else ">"
            order = "DESC" if direction == "up" else "ASC"
            neighbor = self._conn.execute(
                f"""
                SELECT id, sort_order FROM goal_nodes
                WHERE {sibling_where} AND sort_order {cmp_op} ?
                ORDER BY sort_order {order}, created_at {order}, id {order}
                LIMIT 1
                """,
                sibling_params + (row["sort_order"],),
            ).fetchone()
            if neighbor is None:
                return  # 已在边界，静默成功
            now = _now()
            self._conn.execute(
                "UPDATE goal_nodes SET sort_order = ? WHERE id = ?", (neighbor["sort_order"], node_id)
            )
            self._conn.execute(
                "UPDATE goal_nodes SET sort_order = ? WHERE id = ?", (row["sort_order"], neighbor["id"])
            )
            self._conn.execute(
                "UPDATE goal_trees SET updated_at = ? WHERE id = ?", (now, row["tree_id"])
            )

    def _goal_node_by_id(self, node_id: str) -> GoalNode | None:
        row = self._conn.execute("SELECT * FROM goal_nodes WHERE id = ?", (node_id,)).fetchone()
        return _goal_node(row) if row else None
```

4d. `_create_schema` 的 executescript 里、`versions` 表之后追加：

```sql
            CREATE TABLE IF NOT EXISTS goal_trees (
              id TEXT PRIMARY KEY,
              owner_id TEXT NOT NULL,
              subject TEXT NOT NULL,
              grade INTEGER NOT NULL,
              term TEXT NOT NULL,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS goal_nodes (
              id TEXT PRIMARY KEY,
              tree_id TEXT NOT NULL,
              parent_id TEXT,
              level TEXT NOT NULL,
              title TEXT NOT NULL,
              description TEXT NOT NULL,
              standard_refs TEXT NOT NULL,
              verify_criteria TEXT NOT NULL,
              sort_order INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
```

4e. 文件底部工具函数区（`_conversation_title` 之后）追加：

```python
def _goal_tree(row: sqlite3.Row) -> GoalTree:
    return GoalTree(
        id=row["id"],
        owner_id=row["owner_id"],
        subject=row["subject"],
        grade=row["grade"],
        term=row["term"],
        title=row["title"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _goal_node(row: sqlite3.Row) -> GoalNode:
    return GoalNode(
        id=row["id"],
        tree_id=row["tree_id"],
        parent_id=row["parent_id"],
        level=row["level"],
        title=row["title"],
        description=row["description"],
        standard_refs=json.loads(row["standard_refs"]),
        verify_criteria=row["verify_criteria"],
        sort_order=row["sort_order"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
```

- [ ] **Step 5: 运行测试确认通过**

Run: `.\.venv\Scripts\python.exe -m pytest tests/goals/test_repository.py -v`（cwd `backend/`）
Expected: 7 passed

- [ ] **Step 6: 跑全量后端测试防回归**

Run: `.\.venv\Scripts\python.exe -m pytest -q`（cwd `backend/`）
Expected: 除既有的 `test_published_preview_is_isolated_from_the_workbench`（前端 SPA 迁移遗留，与本模块无关）外全部通过

- [ ] **Step 7: 提交**

```bash
git add backend/app/storage/protocol.py backend/app/storage/repository.py backend/tests/goals/test_repository.py
git commit -m "目标树存储：goal_trees/goal_nodes 表、层级校验与属主隔离"
```

---

### Task 2: 课标骨架模板

**Files:**
- Create: `backend/app/goals/__init__.py`（空文件，标记包）
- Create: `backend/app/goals/templates.py`
- Test: `backend/tests/goals/test_templates.py`

**Interfaces:**
- Produces: `SUBJECT_NAMES: tuple[str, ...]`（9 科中文名，Task 3 的 API 校验依赖）；`get_template(subject) -> dict | None`；`semester_seed(subject) -> list[dict]`（每项 `{title, description, verify_criteria}`，Task 3 的 `template_init` 依赖）

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/goals/test_templates.py`：

```python
"""课标骨架模板的结构完整性。"""

from app.goals.templates import SUBJECT_NAMES, get_template, semester_seed

EXPECTED_SUBJECTS = ("语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "道德与法治")


def test_nine_subjects_present():
    assert SUBJECT_NAMES == EXPECTED_SUBJECTS


def test_every_subject_has_at_least_three_domains():
    for subject in SUBJECT_NAMES:
        template = get_template(subject)
        assert template is not None, subject
        domains = template["domains"]
        assert len(domains) >= 3, subject
        for domain in domains:
            assert domain["name"], subject
            assert len(domain["themes"]) >= 1
            assert len(domain["competencies"]) >= 1
            assert domain["sample"]


def test_semester_seed_is_prefilled_draft():
    for subject in SUBJECT_NAMES:
        seed = semester_seed(subject)
        assert 3 <= len(seed) <= 8, subject
        for item in seed:
            assert item["title"] and item["description"] and item["verify_criteria"], subject


def test_unknown_subject_returns_none():
    assert get_template("书法") is None
    assert semester_seed("书法") == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.\.venv\Scripts\python.exe -m pytest tests/goals/test_templates.py -v`（cwd `backend/`）
Expected: FAIL，`ModuleNotFoundError: No module named 'app.goals'`

- [ ] **Step 3: 实现模板**

创建 `backend/app/goals/__init__.py`（空文件）与 `backend/app/goals/templates.py`：

```python
"""初中 9 科课标骨架。

结构维度提炼自 2022 版义务教育课程标准，只做参考脚手架，不含课标原文。
创建目标树时可用 semester_seed 预填学期总目标草稿，老师在此基础上改写。
"""

SUBJECT_NAMES = ("语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "道德与法治")

_TEMPLATES: dict[str, dict] = {
    "语文": {
        "domains": [
            {"name": "识字与写字", "themes": ["字词积累", "书写规范"], "competencies": ["语言运用"], "sample": "能正确读写并运用本学期要求积累的常用字词"},
            {"name": "阅读与鉴赏", "themes": ["现代文阅读", "文言文入门", "名著导读"], "competencies": ["思维能力", "审美创造"], "sample": "能概括文章主要内容，说出自己的阅读感受"},
            {"name": "表达与交流", "themes": ["书面写作", "口语交际"], "competencies": ["语言运用", "文化自信"], "sample": "能围绕主题写 500 字以上条理清楚的记叙文"},
            {"name": "梳理与探究", "themes": ["语文实践活动"], "competencies": ["思维能力"], "sample": "能围绕校园或社区问题完成一次小型调查并汇报"},
        ]
    },
    "数学": {
        "domains": [
            {"name": "数与代数", "themes": ["有理数", "整式与分式", "方程与不等式", "函数"], "competencies": ["运算能力", "抽象能力"], "sample": "能熟练进行有理数混合运算并说明算理"},
            {"name": "图形与几何", "themes": ["相交线与平行线", "三角形", "四边形", "圆"], "competencies": ["几何直观", "推理能力"], "sample": "能用基本事实证明简单的三角形全等"},
            {"name": "统计与概率", "themes": ["数据的收集与整理", "简单概率"], "competencies": ["数据观念"], "sample": "能用统计图表描述数据并得出结论"},
            {"name": "综合与实践", "themes": ["项目式学习"], "competencies": ["模型观念", "应用意识"], "sample": "能建立一次函数模型解决行程类实际问题"},
        ]
    },
    "英语": {
        "domains": [
            {"name": "听说", "themes": ["课堂用语", "日常话题对话"], "competencies": ["语言能力"], "sample": "能就熟悉话题进行 5 句以上的连续对话"},
            {"name": "读写", "themes": ["语篇阅读", "应用文写作"], "competencies": ["语言能力", "思维品质"], "sample": "能读懂 200 词左右的记叙文并抓住要点"},
            {"name": "语言知识", "themes": ["核心词汇", "基础语法"], "competencies": ["语言能力"], "sample": "能正确使用一般过去时描述已发生的事"},
            {"name": "文化意识", "themes": ["中外文化习俗比较"], "competencies": ["文化意识"], "sample": "能用简单英语介绍一个中外节日"},
        ]
    },
    "物理": {
        "domains": [
            {"name": "物质", "themes": ["物态变化", "物质的属性"], "competencies": ["物理观念"], "sample": "能举例说明生活里的熔化与凝固现象"},
            {"name": "运动与相互作用", "themes": ["机械运动", "力与运动", "压强与浮力"], "competencies": ["物理观念", "科学思维"], "sample": "能用惯性解释乘车刹车时的身体前倾"},
            {"name": "能量", "themes": ["声与光", "内能与热机", "电与磁", "电能输送"], "competencies": ["能量观念", "科学探究"], "sample": "能设计电路并用电流表电压表验证串并联规律"},
        ]
    },
    "化学": {
        "domains": [
            {"name": "物质的性质与变化", "themes": ["物理/化学变化", "空气与氧气", "碳及其氧化物"], "competencies": ["化学观念"], "sample": "能区分物理变化与化学变化并举例说明"},
            {"name": "物质构成的奥秘", "themes": ["分子与原子", "元素与化学式", "质量守恒"], "competencies": ["微粒观念", "科学思维"], "sample": "能依据质量守恒定律解释常见反应的质量关系"},
            {"name": "化学与社会", "themes": ["燃烧与灭火", "金属材料", "溶液"], "competencies": ["科学态度与责任"], "sample": "能说出灭火原理并检查家庭火灾隐患"},
            {"name": "科学探究", "themes": ["实验基本操作"], "competencies": ["科学探究"], "sample": "能规范完成氧气制取与性质检验的分组实验"},
        ]
    },
    "生物": {
        "domains": [
            {"name": "生物体的结构层次", "themes": ["细胞", "组织器官系统"], "competencies": ["结构与功能观"], "sample": "能说出动植物细胞结构的异同"},
            {"name": "生物与环境", "themes": ["生态系统", "食物链与食物网"], "competencies": ["进化与适应观"], "sample": "能分析一条食物链中生物数量变化的相互影响"},
            {"name": "生物圈中的绿色植物", "themes": ["光合作用与呼吸作用"], "competencies": ["科学探究"], "sample": "能设计对照实验验证光照影响光合作用"},
            {"name": "健康地生活", "themes": ["人体生理", "传染病与免疫"], "competencies": ["社会责任"], "sample": "能说明接种疫苗预防传染病的道理"},
        ]
    },
    "历史": {
        "domains": [
            {"name": "中国古代史", "themes": ["史前与先秦", "秦汉统一", "隋唐宋元明清"], "competencies": ["时空观念", "家国情怀"], "sample": "能按顺序列出秦到清的主要朝代并各举一项制度"},
            {"name": "中国近现代史", "themes": ["近代化探索", "新民主主义革命", "新中国建设"], "competencies": ["史料实证", "家国情怀"], "sample": "能用两则史料说明洋务运动的影响"},
            {"name": "世界史", "themes": ["古代文明", "近现代格局"], "competencies": ["历史解释"], "sample": "能比较两次工业革命对世界格局的不同影响"},
        ]
    },
    "地理": {
        "domains": [
            {"name": "地球与地图", "themes": ["地球运动", "地图三要素"], "competencies": ["区域认知", "综合思维"], "sample": "能在等高线地形图上识别山脊与山谷"},
            {"name": "世界地理", "themes": ["海陆分布", "气候类型", "居民与聚落"], "competencies": ["综合思维"], "sample": "能举例说明纬度位置对气温的影响"},
            {"name": "中国地理", "themes": ["疆域与人口", "自然环境与自然资源", "区域差异"], "competencies": ["区域认知", "人地协调观"], "sample": "能说出我国地势三级阶梯对河流流向的影响"},
        ]
    },
    "道德与法治": {
        "domains": [
            {"name": "生命安全与健康教育", "themes": ["悦纳自我", "远离伤害"], "competencies": ["道德修养", "健全人格"], "sample": "能说出应对校园欺凌的两条正确做法"},
            {"name": "法治教育", "themes": ["宪法是根本法", "未成年人保护", "预防犯罪"], "competencies": ["法治观念"], "sample": "能结合案例说明宪法为什么是根本法"},
            {"name": "国情与责任", "themes": ["集体生活", "社会责任", "国家认同"], "competencies": ["责任意识", "政治认同"], "sample": "能举一个例子说明个人如何在集体中承担责任"},
            {"name": "道德修养", "themes": ["诚信友善", "家庭美德"], "competencies": ["道德修养"], "sample": "能讲述一次自己践行诚信的经历"},
        ]
    },
}


def get_template(subject: str) -> dict | None:
    return _TEMPLATES.get(subject)


def semester_seed(subject: str) -> list[dict]:
    """按学科素养维度返回学期总目标预填草稿。"""
    template = get_template(subject)
    if template is None:
        return []
    seed: list[dict] = []
    for domain in template["domains"]:
        competencies = "、".join(domain["competencies"])
        seed.append(
            {
                "title": f"{domain['name']}：学期总目标",
                "description": f"围绕{domain['name']}（涉及主题：{'、'.join(domain['themes'])}），参考：{domain['sample']}。",
                "verify_criteria": f"对应素养维度：{competencies}。学期末可通过课堂表现与作业证据核验达成情况。",
            }
        )
    return seed
```

- [ ] **Step 4: 运行测试确认通过**

Run: `.\.venv\Scripts\python.exe -m pytest tests/goals/test_templates.py -v`（cwd `backend/`）
Expected: 4 passed

- [ ] **Step 5: 提交**

```bash
git add backend/app/goals/__init__.py backend/app/goals/templates.py backend/tests/goals/test_templates.py
git commit -m "内置初中 9 科课标骨架模板与学期目标预填草稿"
```

---

### Task 3: API——目标树端点

**Files:**
- Create: `backend/app/api/goals.py`（请求解析与响应组装，不含 Web 框架）
- Modify: `backend/app/main.py`（create_app 内追加路由）
- Test: `backend/tests/goals/test_api.py`

**Interfaces:**
- Consumes: Task 1 的仓储方法、Task 2 的 `SUBJECT_NAMES`/`semester_seed`、`main.py` 现有 `require_user`/`error_payload`/`repository`
- Produces: REST 端点（Task 5 前端依赖）：
  - `GET /api/goal-trees?subject=&grade=&term=` → `{"trees": [tree_view...]}`
  - `POST /api/goal-trees` body `{subject, grade, term, title, template_init?}` → 201 `tree_view`
  - `GET /api/goal-trees/{id}` → `{"tree": tree_view, "nodes": [node_view...]}`
  - `PATCH /api/goal-trees/{id}` body `{title}` → `tree_view`
  - `DELETE /api/goal-trees/{id}` → 204
  - `POST /api/goal-trees/{id}/nodes` body `{parent_id, level, title, description, verify_criteria, standard_refs}` → 201 `node_view`
  - `PATCH /api/goal-nodes/{id}` 同字段 → `node_view`
  - `DELETE /api/goal-nodes/{id}` → 204
  - `POST /api/goal-nodes/{id}/reorder` body `{direction}` → `{"ok": true}`
  - `tree_view`：`{tree_id, subject, grade, term, title, created_at, updated_at}`；`node_view`：`{node_id, tree_id, parent_id, level, title, description, standard_refs, verify_criteria, sort_order, created_at, updated_at}`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/goals/test_api.py`：

```python
"""目标树 API：鉴权、属主隔离、层级校验、模板预填。"""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _client(tmp_path):
    return TestClient(create_app(Settings(data_dir=tmp_path, auth_secret="test-secret-value"), complete=_idle))


def _idle(messages, tools):
    from app.llm.protocol import AssistantMessage

    return AssistantMessage(content="好", tool_calls=[])


def _register(client, username="teacher-a"):
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": "password123", "display_name": username},
    )
    assert response.status_code == 201
    return response.json()


def _create_tree(client, **overrides):
    body = {"subject": "数学", "grade": 7, "term": "上", "title": "七上数学"}
    body.update(overrides)
    return client.post("/api/goal-trees", json=body)


def test_goal_routes_require_login(tmp_path):
    client = _client(tmp_path)
    assert client.get("/api/goal-trees").status_code == 401
    assert client.post("/api/goal-trees", json={}).status_code == 401


def test_create_list_get_tree(tmp_path):
    client = _client(tmp_path)
    _register(client)

    created = _create_tree(client)
    assert created.status_code == 201
    tree = created.json()
    assert tree["subject"] == "数学" and tree["title"] == "七上数学"

    listed = client.get("/api/goal-trees", params={"subject": "数学"}).json()["trees"]
    assert [t["tree_id"] for t in listed] == [tree["tree_id"]]

    detail = client.get(f"/api/goal-trees/{tree['tree_id']}")
    assert detail.status_code == 200
    assert detail.json()["nodes"] == []


def test_create_tree_rejects_bad_dimensions(tmp_path):
    client = _client(tmp_path)
    _register(client)
    assert _create_tree(client, subject="书法").status_code == 400
    assert _create_tree(client, grade=10).status_code == 400
    assert _create_tree(client, term="全学年").status_code == 400
    assert _create_tree(client, title="  ").status_code == 400


def test_template_init_prefills_semester_nodes(tmp_path):
    client = _client(tmp_path)
    _register(client)
    tree = _create_tree(client, template_init=True).json()
    nodes = client.get(f"/api/goal-trees/{tree['tree_id']}").json()["nodes"]
    assert len(nodes) >= 3
    assert all(n["level"] == "semester" for n in nodes)


def test_owner_isolation_returns_404(tmp_path):
    client = _client(tmp_path)
    _register(client, "teacher-a")
    tree = _create_tree(client).json()
    client.post("/api/auth/logout")

    _register(client, "teacher-b")
    assert client.get(f"/api/goal-trees/{tree['tree_id']}").status_code == 404
    assert client.patch(f"/api/goal-trees/{tree['tree_id']}", json={"title": "x"}).status_code == 404
    assert client.delete(f"/api/goal-trees/{tree['tree_id']}").status_code == 404
    assert (
        client.post(
            f"/api/goal-trees/{tree['tree_id']}/nodes",
            json={"parent_id": None, "level": "unit", "title": "x", "description": "", "verify_criteria": "", "standard_refs": []},
        ).status_code
        == 404
    )


def test_node_crud_and_hierarchy_errors(tmp_path):
    client = _client(tmp_path)
    _register(client)
    tree = _create_tree(client).json()

    def make_node(**overrides):
        body = {
            "parent_id": None, "level": "unit", "title": "第一单元",
            "description": "d", "verify_criteria": "c", "standard_refs": ["数与代数"],
        }
        body.update(overrides)
        return client.post(f"/api/goal-trees/{tree['tree_id']}/nodes", json=body)

    unit = make_node().json()
    assert unit["level"] == "unit" and unit["standard_refs"] == ["数与代数"]

    lesson = make_node(parent_id=unit["node_id"], level="lesson", title="第 1 课时").json()
    assert lesson["parent_id"] == unit["node_id"]

    assert make_node(parent_id=None, level="lesson").status_code == 400
    assert make_node(parent_id=unit["node_id"], level="semester").status_code == 400
    assert make_node(parent_id="0" * 32, level="lesson").status_code == 404

    patched = client.patch(
        f"/api/goal-nodes/{lesson['node_id']}",
        json={"title": "第 1 课时：有理数", "description": "新", "verify_criteria": "新", "standard_refs": []},
    )
    assert patched.status_code == 200 and patched.json()["title"] == "第 1 课时：有理数"

    # 有子节点 → 409
    assert client.delete(f"/api/goal-nodes/{unit['node_id']}").status_code == 409
    assert client.delete(f"/api/goal-nodes/{lesson['node_id']}").status_code == 204
    assert client.delete(f"/api/goal-nodes/{unit['node_id']}").status_code == 204

    # 重排：边界处静默成功
    assert client.post(f"/api/goal-nodes/{unit['node_id']}/reorder", json={"direction": "up"}).status_code == 200
    assert client.post(f"/api/goal-nodes/{unit['node_id']}/reorder", json={"direction": "跳"}).status_code == 400


def test_rename_and_delete_tree(tmp_path):
    client = _client(tmp_path)
    _register(client)
    tree = _create_tree(client).json()
    renamed = client.patch(f"/api/goal-trees/{tree['tree_id']}", json={"title": "七上数学-草稿"})
    assert renamed.status_code == 200 and renamed.json()["title"] == "七上数学-草稿"
    assert client.delete(f"/api/goal-trees/{tree['tree_id']}").status_code == 204
    assert client.get(f"/api/goal-trees/{tree['tree_id']}").status_code == 404
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.\.venv\Scripts\python.exe -m pytest tests/goals/test_api.py -v`（cwd `backend/`）
Expected: FAIL，404（路由不存在）

- [ ] **Step 3: 实现解析与视图模块**

创建 `backend/app/api/goals.py`：

```python
"""目标树的请求解析与响应组装。不引入 Web 框架。"""

from app.goals.templates import SUBJECT_NAMES, semester_seed
from app.storage.protocol import GoalNode, GoalTree

GOAL_GRADES = (7, 8, 9)
GOAL_TERMS = ("上", "下")
MAX_TITLE_CHARS = 100
MAX_TEXT_CHARS = 2000
MAX_REFS = 20


class GoalRequestError(ValueError):
    """请求体不合法。public_message 直接进错误正文。"""

    def __init__(self, public_message: str):
        super().__init__(public_message)
        self.public_message = public_message


def _text(body: dict, key: str, *, required: bool = True, limit: int = MAX_TEXT_CHARS) -> str:
    value = body.get(key)
    if value is None:
        if required:
            raise GoalRequestError(f"请填写{key}。")
        return ""
    if not isinstance(value, str):
        raise GoalRequestError(f"{key} 需要是文本。")
    stripped = value.strip()
    if required and stripped == "":
        raise GoalRequestError(f"请填写{key}。")
    if len(stripped) > limit:
        raise GoalRequestError(f"{key} 超过 {limit} 字。")
    return stripped


def parse_create_tree(body) -> tuple[str, int, str, str, bool]:
    if not isinstance(body, dict):
        raise GoalRequestError("请求体需要是对象。")
    subject = body.get("subject")
    if subject not in SUBJECT_NAMES:
        raise GoalRequestError("请选择初中九科之一。")
    grade = body.get("grade")
    if grade not in GOAL_GRADES:
        raise GoalRequestError("年级需是 7、8 或 9。")
    term = body.get("term")
    if term not in GOAL_TERMS:
        raise GoalRequestError("学期需是「上」或「下」。")
    title = _text(body, "title", limit=MAX_TITLE_CHARS)
    template_init = body.get("template_init") is True
    return subject, grade, term, title, template_init


def parse_update_tree(body) -> str:
    if not isinstance(body, dict):
        raise GoalRequestError("请求体需要是对象。")
    return _text(body, "title", limit=MAX_TITLE_CHARS)


def parse_create_node(body) -> dict:
    if not isinstance(body, dict):
        raise GoalRequestError("请求体需要是对象。")
    parent_id = body.get("parent_id")
    if parent_id is not None and (not isinstance(parent_id, str) or parent_id == ""):
        raise GoalRequestError("parent_id 需要是合法 id 或 null。")
    level = body.get("level")
    if level not in ("semester", "unit", "lesson"):
        raise GoalRequestError("目标层级需是 semester、unit 或 lesson。")
    return {
        "parent_id": parent_id,
        "level": level,
        "title": _text(body, "title", limit=MAX_TITLE_CHARS),
        "description": _text(body, "description", required=False),
        "verify_criteria": _text(body, "verify_criteria", required=False),
        "standard_refs": _refs(body),
    }


def parse_update_node(body) -> dict:
    if not isinstance(body, dict):
        raise GoalRequestError("请求体需要是对象。")
    return {
        "title": _text(body, "title", limit=MAX_TITLE_CHARS),
        "description": _text(body, "description", required=False),
        "verify_criteria": _text(body, "verify_criteria", required=False),
        "standard_refs": _refs(body),
    }


def parse_reorder(body) -> str:
    if not isinstance(body, dict):
        raise GoalRequestError("请求体需要是对象。")
    direction = body.get("direction")
    if direction not in ("up", "down"):
        raise GoalRequestError("direction 需是 up 或 down。")
    return direction


def _refs(body: dict) -> list[str]:
    value = body.get("standard_refs")
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_REFS:
        raise GoalRequestError(f"standard_refs 最多 {MAX_REFS} 项。")
    refs: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip() or len(item) > 100:
            raise GoalRequestError("standard_refs 里每一项需是 100 字以内的文本。")
        refs.append(item.strip())
    return refs


def tree_view(tree: GoalTree) -> dict:
    return {
        "tree_id": tree.id,
        "subject": tree.subject,
        "grade": tree.grade,
        "term": tree.term,
        "title": tree.title,
        "created_at": tree.created_at,
        "updated_at": tree.updated_at,
    }


def node_view(node: GoalNode) -> dict:
    return {
        "node_id": node.id,
        "tree_id": node.tree_id,
        "parent_id": node.parent_id,
        "level": node.level,
        "title": node.title,
        "description": node.description,
        "standard_refs": node.standard_refs,
        "verify_criteria": node.verify_criteria,
        "sort_order": node.sort_order,
        "created_at": node.created_at,
        "updated_at": node.updated_at,
    }
```

- [ ] **Step 4: 在 create_app 里挂路由**

`backend/app/main.py`：

4a. 文件顶部 import 区追加：

```python
from app.api.errors import error_payload
from app.api.goals import (
    GoalRequestError,
    node_view,
    parse_create_node,
    parse_create_tree,
    parse_reorder,
    parse_update_node,
    parse_update_tree,
    tree_view,
)
from app.goals.templates import semester_seed
from app.storage.protocol import ConflictError, InputError, NotFoundError
```

（若 `error_payload` 等名字已有 import，合并进现有行，不要重复。）

4b. `create_app` 内、现有 `/` 路由之后追加路由定义：

```python
    @app.get("/api/goal-trees")
    def list_goal_trees(
        request: Request,
        subject: str | None = None,
        grade: int | None = None,
        term: str | None = None,
    ):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        trees = repository.list_goal_trees(user.id, subject=subject, grade=grade, term=term)
        return {"trees": [tree_view(t) for t in trees]}

    @app.post("/api/goal-trees")
    async def create_goal_tree(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            subject, grade, term, title, template_init = parse_create_tree(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except GoalRequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        tree = repository.create_goal_tree(user.id, subject, grade, term, title)
        if template_init:
            for seed in semester_seed(subject):
                repository.create_goal_node(
                    tree.id, user.id, None, "semester",
                    seed["title"], seed["description"], [], seed["verify_criteria"],
                )
        return JSONResponse(tree_view(tree), status_code=201)

    @app.get("/api/goal-trees/{tree_id}")
    def read_goal_tree(tree_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        tree = repository.get_goal_tree_for_owner(tree_id, user.id)
        if tree is None:
            return JSONResponse(error_payload("not_found", "没有找到这份目标树。"), status_code=404)
        nodes = repository.list_goal_nodes(tree_id, user.id) or []
        return {"tree": tree_view(tree), "nodes": [node_view(n) for n in nodes]}

    @app.patch("/api/goal-trees/{tree_id}")
    async def update_goal_tree(tree_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            title = parse_update_tree(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except GoalRequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        tree = repository.rename_goal_tree(tree_id, user.id, title)
        if tree is None:
            return JSONResponse(error_payload("not_found", "没有找到这份目标树。"), status_code=404)
        return tree_view(tree)

    @app.delete("/api/goal-trees/{tree_id}")
    def delete_goal_tree(tree_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        if not repository.delete_goal_tree(tree_id, user.id):
            return JSONResponse(error_payload("not_found", "没有找到这份目标树。"), status_code=404)
        return Response(status_code=204)

    @app.post("/api/goal-trees/{tree_id}/nodes")
    async def create_goal_node(tree_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            fields = parse_create_node(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except GoalRequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        try:
            node = repository.create_goal_node(tree_id, user.id, **fields)
        except NotFoundError:
            return JSONResponse(error_payload("not_found", "没有找到这份目标树或上级目标。"), status_code=404)
        except InputError as exc:
            return JSONResponse(error_payload("invalid_input", _goal_rule_message(exc)), status_code=400)
        except ConflictError:
            return JSONResponse(error_payload("conflict", "这一层的目标数量已达上限。"), status_code=409)
        return JSONResponse(node_view(node), status_code=201)

    @app.patch("/api/goal-nodes/{node_id}")
    async def update_goal_node(node_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            fields = parse_update_node(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except GoalRequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        node = repository.update_goal_node(node_id, user.id, **fields)
        if node is None:
            return JSONResponse(error_payload("not_found", "没有找到这条目标。"), status_code=404)
        return node_view(node)

    @app.delete("/api/goal-nodes/{node_id}")
    def delete_goal_node(node_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            repository.delete_goal_node(node_id, user.id)
        except NotFoundError:
            return JSONResponse(error_payload("not_found", "没有找到这条目标。"), status_code=404)
        except ConflictError:
            return JSONResponse(error_payload("conflict", "先删除或移走这条目标下的子目标。"), status_code=409)
        return Response(status_code=204)

    @app.post("/api/goal-nodes/{node_id}/reorder")
    async def reorder_goal_node(node_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            direction = parse_reorder(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except GoalRequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        try:
            repository.reorder_goal_node(node_id, user.id, direction)
        except NotFoundError:
            return JSONResponse(error_payload("not_found", "没有找到这条目标。"), status_code=404)
        except InputError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        return {"ok": True}
```

4c. `create_app` 外或文件底部加规则消息翻译：

```python
_GOAL_RULE_MESSAGES = {
    "root goal nodes must be semester or unit": "学期总目标和单元直接挂在根上，课时目标需要挂在单元下。",
    "lesson nodes can only sit under a unit": "课时目标只能挂在单元下。",
    "invalid goal level": "目标层级不合法。",
}


def _goal_rule_message(exc: InputError) -> str:
    return _GOAL_RULE_MESSAGES.get(str(exc), "目标层级或位置不合法。")
```

- [ ] **Step 5: 运行测试确认通过**

Run: `.\.venv\Scripts\python.exe -m pytest tests/goals/test_api.py -v`（cwd `backend/`）
Expected: 7 passed

- [ ] **Step 6: 全量回归**

Run: `.\.venv\Scripts\python.exe -m pytest -q`（cwd `backend/`）
Expected: 仅既有 `test_preview.py::test_published_preview_is_isolated_from_the_workbench` 1 例失败（与本次无关）

- [ ] **Step 7: 提交**

```bash
git add backend/app/api/goals.py backend/app/main.py backend/tests/goals/test_api.py
git commit -m "目标树 API：CRUD、层级校验、模板预填与属主隔离"
```

---

### Task 4: 前端类型与 API 客户端

**Files:**
- Create: `frontend/src/types/goals.ts`
- Create: `frontend/src/api/goals.ts`
- Modify: `frontend/src/api/http.ts`（导出 `request` 与 `ID`，供 goals 客户端复用）
- Test: `frontend/src/api/goals.test.ts`

**Interfaces:**
- Consumes: `http.ts` 的 `request`/`ApiRequestError`/`DisconnectError`
- Produces: Task 5 依赖的 `GoalsApi`（见下）与 `defaultGoalsApi` 实例

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/api/goals.test.ts`：

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, DisconnectError } from "./http";
import { defaultGoalsApi } from "./goals";

function mockFetch(payload: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("goals api", () => {
  it("列出目标树并透传过滤参数", async () => {
    const fetchMock = mockFetch({
      trees: [{ tree_id: "a".repeat(32), subject: "数学", grade: 7, term: "上", title: "七上数学", created_at: "t", updated_at: "t" }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const trees = await defaultGoalsApi.listGoalTrees({ subject: "数学" });
    expect(trees).toHaveLength(1);
    expect(trees[0].title).toBe("七上数学");
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://local");
    expect(url.searchParams.get("subject")).toBe("数学");
  });

  it("创建目标树（含 template_init）", async () => {
    const fetchMock = mockFetch({ tree_id: "b".repeat(32), subject: "语文", grade: 8, term: "下", title: "八下语文", created_at: "t", updated_at: "t" }, 201);
    vi.stubGlobal("fetch", fetchMock);
    const tree = await defaultGoalsApi.createGoalTree({ subject: "语文", grade: 8, term: "下", title: "八下语文", template_init: true });
    expect(tree.tree_id).toBe("b".repeat(32));
    const init = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(init.template_init).toBe(true);
  });

  it("读取整树（节点 + 树）", async () => {
    vi.stubGlobal("fetch", mockFetch({
      tree: { tree_id: "c".repeat(32), subject: "数学", grade: 7, term: "上", title: "t", created_at: "t", updated_at: "t" },
      nodes: [{
        node_id: "d".repeat(32), tree_id: "c".repeat(32), parent_id: null, level: "unit",
        title: "第一单元", description: "", standard_refs: [], verify_criteria: "",
        sort_order: 1, created_at: "t", updated_at: "t",
      }],
    }));
    const detail = await defaultGoalsApi.getGoalTree("c".repeat(32));
    expect(detail.nodes[0].level).toBe("unit");
  });

  it("错误正文转 ApiRequestError", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: { code: "invalid_input", message: "请选择初中九科之一。", retryable: false } }, 400));
    await expect(defaultGoalsApi.createGoalTree({ subject: "书法", grade: 7, term: "上", title: "x" }))
      .rejects.toBeInstanceOf(ApiRequestError);
  });

  it("后端未启动时抛 DisconnectError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    await expect(defaultGoalsApi.listGoalTrees({})).rejects.toBeInstanceOf(DisconnectError);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/api/goals.test.ts`（cwd `frontend/`）
Expected: FAIL，`Failed to resolve import "./goals"`

- [ ] **Step 3: 导出 http.ts 内部工具**

`frontend/src/api/http.ts` 两处修改：

3a. `const ID = ...` 改为：

```typescript
export const ID = /^[0-9a-f]{32}$/;
```

3b. `async function request(` 改为：

```typescript
export async function request(
```

- [ ] **Step 4: 实现类型与客户端**

创建 `frontend/src/types/goals.ts`：

```typescript
/** 与后端 app/api/goals.py 的 tree_view / node_view 一致。 */

export const GOAL_SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "道德与法治"] as const;
export const GOAL_GRADES = [7, 8, 9] as const;
export const GOAL_TERMS = ["上", "下"] as const;

export type GoalSubject = (typeof GOAL_SUBJECTS)[number];
export type GoalLevel = "semester" | "unit" | "lesson";

export interface GoalTree {
  tree_id: string;
  subject: string;
  grade: number;
  term: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface GoalNode {
  node_id: string;
  tree_id: string;
  parent_id: string | null;
  level: GoalLevel;
  title: string;
  description: string;
  standard_refs: string[];
  verify_criteria: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface GoalTreeDetail {
  tree: GoalTree;
  nodes: GoalNode[];
}

export interface CreateTreeInput {
  subject: string;
  grade: number;
  term: string;
  title: string;
  template_init?: boolean;
}

export interface CreateNodeInput {
  parent_id: string | null;
  level: GoalLevel;
  title: string;
  description?: string;
  verify_criteria?: string;
  standard_refs?: string[];
}

export interface UpdateNodeInput {
  title: string;
  description?: string;
  verify_criteria?: string;
  standard_refs?: string[];
}

export interface GoalsApi {
  listGoalTrees(filter: { subject?: string; grade?: number; term?: string }): Promise<GoalTree[]>;
  createGoalTree(input: CreateTreeInput): Promise<GoalTree>;
  getGoalTree(treeId: string): Promise<GoalTreeDetail>;
  renameGoalTree(treeId: string, title: string): Promise<GoalTree>;
  deleteGoalTree(treeId: string): Promise<void>;
  createGoalNode(treeId: string, input: CreateNodeInput): Promise<GoalNode>;
  updateGoalNode(nodeId: string, input: UpdateNodeInput): Promise<GoalNode>;
  deleteGoalNode(nodeId: string): Promise<void>;
  reorderGoalNode(nodeId: string, direction: "up" | "down"): Promise<void>;
}
```

创建 `frontend/src/api/goals.ts`：

```typescript
import { ApiRequestError, DisconnectError, ID, request } from "./http";
import type {
  CreateNodeInput,
  CreateTreeInput,
  GoalNode,
  GoalTree,
  GoalTreeDetail,
  GoalsApi,
  UpdateNodeInput,
} from "../types/goals";

export const defaultGoalsApi: GoalsApi = {
  listGoalTrees: async (filter) => {
    const params = new URLSearchParams();
    if (filter.subject) params.set("subject", filter.subject);
    if (filter.grade !== undefined) params.set("grade", String(filter.grade));
    if (filter.term) params.set("term", filter.term);
    const query = params.toString();
    const body = await request(`/api/goal-trees${query ? `?${query}` : ""}`);
    const record = recordOf(body) as { trees?: unknown };
    return Array.isArray(record.trees) ? record.trees.map(readTree) : [];
  },
  createGoalTree: async (input) => readTree(await request("/api/goal-trees", {
    method: "POST",
    body: JSON.stringify(input),
  })),
  getGoalTree: async (treeId) => {
    const body = await request(`/api/goal-trees/${treeId}`);
    const record = recordOf(body);
    const nodes = record.nodes;
    if (!Array.isArray(nodes)) throw malformed();
    return { tree: readTree(record.tree), nodes: nodes.map(readNode) };
  },
  renameGoalTree: async (treeId, title) => readTree(await request(`/api/goal-trees/${treeId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  })),
  deleteGoalTree: async (treeId) => {
    await request(`/api/goal-trees/${treeId}`, { method: "DELETE" });
  },
  createGoalNode: async (treeId, input) => readNode(await request(`/api/goal-trees/${treeId}/nodes`, {
    method: "POST",
    body: JSON.stringify(input),
  })),
  updateGoalNode: async (nodeId, input) => readNode(await request(`/api/goal-nodes/${nodeId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })),
  deleteGoalNode: async (nodeId) => {
    await request(`/api/goal-nodes/${nodeId}`, { method: "DELETE" });
  },
  reorderGoalNode: async (nodeId, direction) => {
    await request(`/api/goal-nodes/${nodeId}/reorder`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    });
  },
};

function readTree(value: unknown): GoalTree {
  const r = recordOf(value);
  if (typeof r.tree_id !== "string" || !ID.test(r.tree_id)) throw malformed();
  return {
    tree_id: r.tree_id,
    subject: typeof r.subject === "string" ? r.subject : "",
    grade: typeof r.grade === "number" ? r.grade : 0,
    term: typeof r.term === "string" ? r.term : "",
    title: typeof r.title === "string" ? r.title : "",
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

function readNode(value: unknown): GoalNode {
  const r = recordOf(value);
  if (typeof r.node_id !== "string" || !ID.test(r.node_id)) throw malformed();
  const level = r.level;
  if (level !== "semester" && level !== "unit" && level !== "lesson") throw malformed();
  return {
    node_id: r.node_id,
    tree_id: typeof r.tree_id === "string" ? r.tree_id : "",
    parent_id: typeof r.parent_id === "string" ? r.parent_id : null,
    level,
    title: typeof r.title === "string" ? r.title : "",
    description: typeof r.description === "string" ? r.description : "",
    standard_refs: Array.isArray(r.standard_refs) ? r.standard_refs.filter((x): x is string => typeof x === "string") : [],
    verify_criteria: typeof r.verify_criteria === "string" ? r.verify_criteria : "",
    sort_order: typeof r.sort_order === "number" ? r.sort_order : 0,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw malformed();
  return value as Record<string, unknown>;
}

function malformed(): ApiRequestError {
  return new ApiRequestError("internal", "系统出错了，可以再发一次。", true, 200);
}

export { ApiRequestError, DisconnectError };
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/api/goals.test.ts`（cwd `frontend/`）
Expected: 5 passed

- [ ] **Step 6: 类型检查**

Run: `npm run typecheck`（cwd `frontend/`）
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add frontend/src/types/goals.ts frontend/src/api/goals.ts frontend/src/api/goals.test.ts frontend/src/api/http.ts
git commit -m "前端目标树类型与 API 客户端"
```

---

### Task 5: GoalsView 组件

**Files:**
- Create: `frontend/src/pages/GoalsView.tsx`
- Modify: `frontend/src/styles.css`（追加 goals 样式）
- Test: `frontend/src/pages/GoalsView.test.tsx`

**Interfaces:**
- Consumes: Task 4 的 `GoalsApi`/类型
- Produces: `GoalsView`，props `{ api: GoalsApi; onBack: () => void }`（Task 6 集成依赖）

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/pages/GoalsView.test.tsx`：

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GoalsView } from "./GoalsView";
import type { GoalNode, GoalTree, GoalsApi } from "../types/goals";
import type { AuthUser } from "../types/api";

const TREE: GoalTree = {
  tree_id: "a".repeat(32), subject: "数学", grade: 7, term: "上",
  title: "七上数学", created_at: "t1", updated_at: "t2",
};

const SEMESTER: GoalNode = {
  node_id: "b".repeat(32), tree_id: TREE.tree_id, parent_id: null, level: "semester",
  title: "数与代数：学期总目标", description: "d", standard_refs: [], verify_criteria: "c",
  sort_order: 1, created_at: "t1", updated_at: "t1",
};

const UNIT: GoalNode = {
  node_id: "c".repeat(32), tree_id: TREE.tree_id, parent_id: null, level: "unit",
  title: "第一单元 有理数", description: "", standard_refs: [], verify_criteria: "",
  sort_order: 2, created_at: "t1", updated_at: "t1",
};

const LESSON: GoalNode = {
  node_id: "d".repeat(32), tree_id: TREE.tree_id, parent_id: UNIT.node_id, level: "lesson",
  title: "第 1 课时 正数与负数", description: "", standard_refs: [], verify_criteria: "",
  sort_order: 1, created_at: "t1", updated_at: "t1",
};

function makeApi(overrides: Partial<GoalsApi> = {}): GoalsApi {
  return {
    listGoalTrees: vi.fn().mockResolvedValue([TREE]),
    createGoalTree: vi.fn(),
    getGoalTree: vi.fn().mockResolvedValue({ tree: TREE, nodes: [SEMESTER, UNIT, LESSON] }),
    renameGoalTree: vi.fn(),
    deleteGoalTree: vi.fn().mockResolvedValue(undefined),
    createGoalNode: vi.fn(),
    updateGoalNode: vi.fn(),
    deleteGoalNode: vi.fn().mockResolvedValue(undefined),
    reorderGoalNode: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("GoalsView", () => {
  it("列出目标树，打开后按「学期总目标/单元」分组展示三级", async () => {
    const api = makeApi();
    render(<GoalsView api={api} onBack={() => {}} />);
    expect(await screen.findByText("七上数学")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "打开" }));
    expect(await screen.findByText("数与代数：学期总目标")).toBeTruthy();
    expect(screen.getByText("第一单元 有理数")).toBeTruthy();
    expect(screen.getByText("第 1 课时 正数与负数")).toBeTruthy();
  });

  it("选中节点后可编辑保存", async () => {
    const updateGoalNode = vi.fn().mockResolvedValue({ ...UNIT, title: "第一单元（改）" });
    const api = makeApi({ updateGoalNode });
    render(<GoalsView api={api} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "打开" }));
    await userEvent.click(await screen.findByText("第一单元 有理数"));
    const title = screen.getByLabelText("标题") as HTMLInputElement;
    await userEvent.clear(title);
    await userEvent.type(title, "第一单元（改）");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateGoalNode).toHaveBeenCalledWith(UNIT.node_id, {
      title: "第一单元（改）", description: "", verify_criteria: "", standard_refs: [],
    }));
  });

  it("删除被引用节点时展示后端冲突信息", async () => {
    const api = makeApi({
      deleteGoalNode: vi.fn().mockRejectedValue(
        Object.assign(new Error(), { code: "conflict", message: "先删除或移走这条目标下的子目标。", retryable: false, status: 409 }),
      ),
    });
    render(<GoalsView api={api} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "打开" }));
    await userEvent.click(await screen.findByText("第一单元 有理数"));
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(await screen.findByText("先删除或移走这条目标下的子目标。")).toBeTruthy();
  });

  it("在单元下创建课时目标", async () => {
    const createGoalNode = vi.fn().mockResolvedValue(LESSON);
    const api = makeApi({ createGoalNode });
    render(<GoalsView api={api} onBack={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "打开" }));
    await userEvent.click(await screen.findByText("第一单元 有理数"));
    await userEvent.click(screen.getByRole("button", { name: "加课时目标" }));
    const title = screen.getByLabelText("标题") as HTMLInputElement;
    await userEvent.type(title, "第 2 课时 数轴");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(createGoalNode).toHaveBeenCalledWith(TREE.tree_id, {
      parent_id: UNIT.node_id, level: "lesson", title: "第 2 课时 数轴",
      description: "", verify_criteria: "", standard_refs: [],
    }));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/pages/GoalsView.test.tsx`（cwd `frontend/`）
Expected: FAIL，`Failed to resolve import "./GoalsView"`

- [ ] **Step 3: 实现 GoalsView**

创建 `frontend/src/pages/GoalsView.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GOAL_GRADES, GOAL_SUBJECTS, GOAL_TERMS,
  type GoalNode, type GoalTree, type GoalTreeDetail, type GoalsApi,
} from "../types/goals";

type Props = {
  api: GoalsApi;
  onBack: () => void;
};

type Draft = {
  nodeId: string | null;
  parentId: string | null;
  level: "semester" | "unit" | "lesson";
  title: string;
  description: string;
  verifyCriteria: string;
};

const LEVEL_LABELS: Record<GoalNode["level"], string> = {
  semester: "学期总目标",
  unit: "单元",
  lesson: "课时目标",
};

/** 目标视图：左侧目标树列表/树形结构，右侧节点编辑。 */
export function GoalsView({ api, onBack }: Props) {
  const [trees, setTrees] = useState<GoalTree[]>([]);
  const [detail, setDetail] = useState<GoalTreeDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTree, setNewTree] = useState({ subject: "数学", grade: 7, term: "上", title: "", templateInit: true });

  const refreshTrees = useCallback(async () => {
    try {
      setTrees(await api.listGoalTrees({}));
    } catch {
      setBanner("目标树列表加载失败，可以稍后再试。");
    }
  }, [api]);

  useEffect(() => {
    void refreshTrees();
  }, [refreshTrees]);

  const nodesByParent = useMemo(() => {
    const map = new Map<string | null, GoalNode[]>();
    if (!detail) return map;
    for (const node of detail.nodes) {
      const list = map.get(node.parent_id) ?? [];
      list.push(node);
      map.set(node.parent_id, list);
    }
    return map;
  }, [detail]);

  const semesterNodes = nodesByParent.get(null)?.filter((n) => n.level === "semester") ?? [];
  const unitNodes = nodesByParent.get(null)?.filter((n) => n.level === "unit") ?? [];

  async function openTree(treeId: string) {
    setBanner(null);
    setSelected(null);
    setDraft(null);
    try {
      setDetail(await api.getGoalTree(treeId));
    } catch {
      setBanner("目标树读取失败，可以稍后再试。");
    }
  }

  async function createTree() {
    if (!newTree.title.trim()) {
      setBanner("请先填写目标树标题。");
      return;
    }
    setBusy(true);
    try {
      const tree = await api.createGoalTree({
        subject: newTree.subject, grade: newTree.grade, term: newTree.term,
        title: newTree.title.trim(), template_init: newTree.templateInit,
      });
      setCreating(false);
      setNewTree((s) => ({ ...s, title: "" }));
      await refreshTrees();
      await openTree(tree.tree_id);
    } catch (error) {
      setBanner(readMessage(error, "创建失败，可以稍后再试。"));
    } finally {
      setBusy(false);
    }
  }

  function selectNode(node: GoalNode) {
    setSelected(node.node_id);
    setDraft({
      nodeId: node.node_id, parentId: node.parent_id, level: node.level,
      title: node.title, description: node.description, verifyCriteria: node.verify_criteria,
    });
  }

  function startCreateChild(parent: GoalNode | null, level: Draft["level"]) {
    setDraft({
      nodeId: null, parentId: parent ? parent.node_id : null, level,
      title: "", description: "", verifyCriteria: "",
    });
  }

  async function saveDraft() {
    if (!draft || !detail) return;
    if (!draft.title.trim()) {
      setBanner("请填写标题。");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: draft.title.trim(), description: draft.description.trim(),
        verify_criteria: draft.verifyCriteria.trim(), standard_refs: [],
      };
      if (draft.nodeId === null) {
        await api.createGoalNode(detail.tree.tree_id, {
          parent_id: draft.parentId, level: draft.level,
          title: payload.title, description: payload.description,
          verify_criteria: payload.verify_criteria, standard_refs: [],
        });
      } else {
        await api.updateGoalNode(draft.nodeId, payload);
      }
      setDraft(null);
      setSelected(null);
      await openTree(detail.tree.tree_id);
    } catch (error) {
      setBanner(readMessage(error, "保存失败，可以稍后再试。"));
    } finally {
      setBusy(false);
    }
  }

  async function removeNode(node: GoalNode) {
    if (!detail) return;
    setBusy(true);
    try {
      await api.deleteGoalNode(node.node_id);
      if (selected === node.node_id) {
        setSelected(null);
        setDraft(null);
      }
      await openTree(detail.tree.tree_id);
    } catch (error) {
      setBanner(readMessage(error, "删除失败，可以稍后再试。"));
    } finally {
      setBusy(false);
    }
  }

  async function move(node: GoalNode, direction: "up" | "down") {
    if (!detail) return;
    try {
      await api.reorderGoalNode(node.node_id, direction);
      await openTree(detail.tree.tree_id);
    } catch {
      setBanner("调整顺序失败，可以稍后再试。");
    }
  }

  return (
    <section className="goals" aria-label="目标管理">
      <header className="goals-header">
        <button type="button" className="goals-back" onClick={detail ? () => { setDetail(null); setSelected(null); setDraft(null); } : onBack}>
          {detail ? "返回列表" : "返回对话"}
        </button>
        <h1 className="goals-title">{detail ? `${detail.tree.title}（${detail.tree.subject} · ${detail.tree.grade}年级${detail.tree.term}学期）` : "目标管理"}</h1>
        {detail ? (
          <div className="goals-actions">
            <button type="button" onClick={() => startCreateChild(null, "semester")}>加总目标</button>
            <button type="button" onClick={() => startCreateChild(null, "unit")}>加单元</button>
          </div>
        ) : (
          <button type="button" className="goals-new" onClick={() => setCreating((c) => !c)}>新建目标树</button>
        )}
      </header>

      {banner ? <p className="goals-banner" role="alert">{banner}</p> : null}

      {detail ? (
        <div className="goals-body">
          <div className="goals-tree" aria-label="目标树">
            <p className="goals-group-label">学期总目标</p>
            <NodeRow nodes={semesterNodes} onSelect={selectNode} onCreate={() => startCreateChild(null, "semester")} createLabel="加总目标" onMove={move} onDelete={removeNode} selected={selected} />
            <p className="goals-group-label">单元</p>
            {unitNodes.length === 0 ? <p className="goals-empty">还没有单元。点右上「加单元」开始拆解。</p> : null}
            {unitNodes.map((unit) => (
              <div key={unit.node_id} className="goals-unit">
                <NodeRow nodes={[unit]} onSelect={selectNode} onCreate={() => startCreateChild(unit, "lesson")} createLabel="加课时目标" onMove={move} onDelete={removeNode} selected={selected} />
                <div className="goals-lessons">
                  <NodeRow nodes={nodesByParent.get(unit.node_id) ?? []} onSelect={selectNode} onCreate={() => startCreateChild(unit, "lesson")} createLabel="加课时目标" onMove={move} onDelete={removeNode} selected={selected} />
                </div>
              </div>
            ))}
          </div>
          <div className="goals-editor">
            {draft ? (
              <form
                className="goals-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDraft();
                }}
              >
                <p className="goals-form-heading">
                  {draft.nodeId === null ? `新建${LEVEL_LABELS[draft.level]}` : `编辑${LEVEL_LABELS[draft.level]}`}
                </p>
                <label>
                  标题
                  <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required maxLength={100} />
                </label>
                <label>
                  描述
                  <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={2000} />
                </label>
                <label>
                  可验证达成标准
                  <textarea rows={3} value={draft.verifyCriteria} onChange={(e) => setDraft({ ...draft, verifyCriteria: e.target.value })} maxLength={2000} />
                </label>
                <div className="goals-form-actions">
                  <button type="submit" disabled={busy}>保存</button>
                  <button type="button" onClick={() => { setDraft(null); setSelected(null); }}>取消</button>
                </div>
              </form>
            ) : (
              <p className="goals-hint">从左侧选择一条目标进行编辑，或新建目标。</p>
            )}
          </div>
        </div>
      ) : (
        <div className="goals-list">
          {creating ? (
            <form
              className="goals-form goals-create"
              onSubmit={(event) => {
                event.preventDefault();
                void createTree();
              }}
            >
              <p className="goals-form-heading">新建目标树</p>
              <label>
                学科
                <select value={newTree.subject} onChange={(e) => setNewTree({ ...newTree, subject: e.target.value })}>
                  {GOAL_SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>
                年级
                <select value={newTree.grade} onChange={(e) => setNewTree({ ...newTree, grade: Number(e.target.value) })}>
                  {GOAL_GRADES.map((g) => <option key={g} value={g}>{g} 年级</option>)}
                </select>
              </label>
              <label>
                学期
                <select value={newTree.term} onChange={(e) => setNewTree({ ...newTree, term: e.target.value })}>
                  {GOAL_TERMS.map((t) => <option key={t} value={t}>{t}学期</option>)}
                </select>
              </label>
              <label>
                标题
                <input value={newTree.title} onChange={(e) => setNewTree({ ...newTree, title: e.target.value })} placeholder="如：七上数学-草稿" maxLength={100} required />
              </label>
              <label className="goals-check">
                <input type="checkbox" checked={newTree.templateInit} onChange={(e) => setNewTree({ ...newTree, templateInit: e.target.checked })} />
                按课标骨架预填学期总目标草稿
              </label>
              <div className="goals-form-actions">
                <button type="submit" disabled={busy}>创建</button>
                <button type="button" onClick={() => setCreating(false)}>取消</button>
              </div>
            </form>
          ) : null}
          {trees.length === 0 && !creating ? <p className="goals-empty">还没有目标树。点「新建目标树」，选学科后会自动预填课标骨架草稿。</p> : null}
          <ul>
            {trees.map((tree) => (
              <li key={tree.tree_id} className="goals-tree-item">
                <span className="goals-tree-name">{tree.title}</span>
                <span className="goals-tree-meta">{tree.subject} · {tree.grade} 年级{tree.term}学期</span>
                <button type="button" onClick={() => void openTree(tree.tree_id)}>打开</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function NodeRow({ nodes, onSelect, onCreate, createLabel, onMove, onDelete, selected }: {
  nodes: GoalNode[];
  onSelect: (node: GoalNode) => void;
  onCreate: () => void;
  createLabel: string;
  onMove: (node: GoalNode, direction: "up" | "down") => void;
  onDelete: (node: GoalNode) => void;
  selected: string | null;
}) {
  return (
    <ul className="goals-nodes">
      {nodes.map((node, index) => (
        <li key={node.node_id} className={`goals-node ${selected === node.node_id ? "is-selected" : ""}`}>
          <button type="button" className="goals-node-title" onClick={() => onSelect(node)}>
            <span className="goals-node-level">{LEVEL_LABELS[node.level]}</span>
            {node.title}
          </button>
          <span className="goals-node-ops">
            <button type="button" aria-label="上移" disabled={index === 0} onClick={() => onMove(node, "up")}>↑</button>
            <button type="button" aria-label="下移" disabled={index === nodes.length - 1} onClick={() => onMove(node, "down")}>↓</button>
            <button type="button" onClick={() => onDelete(node)}>删除</button>
          </span>
        </li>
      ))}
      <li>
        <button type="button" className="goals-node-add" onClick={onCreate}>{createLabel}</button>
      </li>
    </ul>
  );
}

function readMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}
```

- [ ] **Step 4: 追加样式**

在 `frontend/src/styles.css` 末尾追加：

```css
/* ===== 目标管理 ===== */
.goals { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 16px; gap: 12px; }
.goals-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.goals-title { font-size: 16px; margin: 0; flex: 1; }
.goals-banner { margin: 0; padding: 8px 12px; border-radius: 8px; background: #fdecea; color: #b3261e; }
.goals-body { display: flex; gap: 16px; flex: 1; min-height: 0; }
.goals-tree { flex: 1; overflow-y: auto; border: 1px solid #e3e8e5; border-radius: 10px; padding: 12px; }
.goals-editor { flex: 1; overflow-y: auto; }
.goals-group-label { margin: 8px 0 4px; font-size: 12px; color: #6b7770; }
.goals-unit { margin: 4px 0 12px; }
.goals-lessons { margin-left: 20px; }
.goals-nodes { list-style: none; margin: 0; padding: 0; }
.goals-node { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.goals-node.is-selected .goals-node-title { outline: 2px solid #2f6f4f; }
.goals-node-title { flex: 1; text-align: left; background: none; border: none; cursor: pointer; padding: 6px 8px; border-radius: 6px; display: flex; gap: 8px; align-items: center; }
.goals-node-title:hover { background: #f0f4f2; }
.goals-node-level { font-size: 11px; color: #6b7770; border: 1px solid #d7ded9; border-radius: 4px; padding: 0 4px; white-space: nowrap; }
.goals-node-ops { display: flex; gap: 4px; }
.goals-node-add { background: none; border: 1px dashed #b7c2bb; border-radius: 6px; color: #4a5a50; cursor: pointer; padding: 2px 10px; }
.goals-form { display: flex; flex-direction: column; gap: 10px; max-width: 420px; }
.goals-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #3d4a42; }
.goals-form input, .goals-form textarea, .goals-form select { font: inherit; padding: 6px 8px; border: 1px solid #c9d2cc; border-radius: 6px; }
.goals-form-actions { display: flex; gap: 8px; }
.goals-check { flex-direction: row !important; align-items: center; gap: 8px !important; }
.goals-list ul { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.goals-tree-item { display: flex; align-items: center; gap: 12px; border: 1px solid #e3e8e5; border-radius: 8px; padding: 10px 12px; }
.goals-tree-name { font-weight: 600; }
.goals-tree-meta { color: #6b7770; font-size: 12px; flex: 1; }
.goals-empty, .goals-hint { color: #6b7770; font-size: 13px; }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/pages/GoalsView.test.tsx`（cwd `frontend/`）
Expected: 4 passed

- [ ] **Step 6: 类型检查 + 全量前端测试**

Run: `npm run typecheck && npm test`（cwd `frontend/`）
Expected: 均无错误（既有测试不回归）

- [ ] **Step 7: 提交**

```bash
git add frontend/src/pages/GoalsView.tsx frontend/src/pages/GoalsView.test.tsx frontend/src/styles.css
git commit -m "GoalsView：目标树分组展示、节点编辑与排序"
```

---

### Task 6: Workbench 集成——「目标」入口与视图切换

**Files:**
- Modify: `frontend/src/components/PlusMenu.tsx`（goal 项接真实回调）
- Modify: `frontend/src/pages/Workbench.tsx`（视图状态 + goals 分支）
- Test: `frontend/src/pages/Workbench.test.tsx`（追加用例）

**Interfaces:**
- Consumes: Task 5 的 `GoalsView`、Task 4 的 `defaultGoalsApi`
- Produces: 用户可见入口——PlusMenu「目标」项切换到 GoalsView

- [ ] **Step 1: 写失败测试**

在 `frontend/src/pages/Workbench.test.tsx` 末尾追加（沿用该文件现有的 render/userEvent 导入与 fake api 构造方式；`fakeApi` 指该文件里已有的注入对象，按实际命名替换为文件中的现有变量名）：

```typescript
it("点「＋」菜单的「目标」进入目标管理视图", async () => {
  const goalsApi = {
    listGoalTrees: async () => [],
    createGoalTree: async () => { throw new Error("不应调用"); },
    getGoalTree: async () => { throw new Error("不应调用"); },
    renameGoalTree: async () => { throw new Error("不应调用"); },
    deleteGoalTree: async () => {},
    createGoalNode: async () => { throw new Error("不应调用"); },
    updateGoalNode: async () => { throw new Error("不应调用"); },
    deleteGoalNode: async () => {},
    reorderGoalNode: async () => {},
  };
  render(<Workbench api={fakeApi} goalsApi={goalsApi} />);
  await userEvent.click(await screen.findByRole("button", { name: /＋/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: /目标/ }));
  expect(await screen.findByRole("region", { name: "目标管理" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "返回对话" }));
  expect(screen.queryByRole("region", { name: "目标管理" })).toBeNull();
});
```

注意：若该测试文件的既有用例通过 `props.api` 注入假 API，此处沿用同一构造；`goalsApi` 是本任务给 `Workbench` 新增的可选 prop（见 Step 3），默认值 `defaultGoalsApi`。登录流程按该文件已有用例的方式先完成（注册/登录 stub 或直接注入 `getCurrentUser`）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/pages/Workbench.test.tsx`（cwd `frontend/`）
Expected: 新用例 FAIL（menuitem「目标」点击后仍停留在对话视图）

- [ ] **Step 3: 实现**

3a. `frontend/src/components/PlusMenu.tsx`：

Props 增加：

```typescript
  /** 打开目标管理视图 */
  onOpenGoals: () => void;
```

解构参数加入 `onOpenGoals`；`handleItemClick` 里、`kind === "model"` 分支之后追加：

```typescript
    if (item.key === "goal") {
      onOpenGoals();
      setOpen(false);
      return;
    }
```

3b. `frontend/src/pages/Workbench.tsx`：

- 顶部 import 追加：

```typescript
import GoalsView from "./GoalsView";
import { defaultGoalsApi } from "../api/goals";
import type { GoalsApi } from "../types/goals";
```

（若该项目禁用 default import 风格，改用 `import { GoalsView } from "./GoalsView";`，与现有组件导入风格一致——以文件里 `Sidebar` 的导入写法为准。）

- `Props` 追加：

```typescript
  /** 测试注入：目标管理 API。默认走后端 */
  goalsApi?: GoalsApi;
```

- 视图状态（原 `useState<"chat" | "settings">("chat")`）改为：

```typescript
  const [view, setView] = useState<"chat" | "settings" | "goals">("chat");
```

- `WorkbenchScreen` 内取用：`const goalsApi = props.goalsApi ?? defaultGoalsApi;`（按该文件现有 props 解构习惯放置）。

- `<main className="main">` 区域，`view === "settings" ? ...` 分支之前插入 goals 分支（保持 settings/chat 原逻辑不动）：

```tsx
        {view === "goals" ? (
          <GoalsView api={goalsApi} onBack={() => setView("chat")} />
        ) : view === "settings" ? (
```

（即把原来的 `view === "settings" ? (` 前面加上述三元分支，原分支链保持不变。）

- `<PlusMenu ...>` 调用处追加 prop：

```tsx
                  onOpenGoals={() => setView("goals")}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/pages/Workbench.test.tsx`（cwd `frontend/`）
Expected: 全部通过（含既有用例）

- [ ] **Step 5: 类型检查 + 全量前端测试**

Run: `npm run typecheck && npm test`（cwd `frontend/`）
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/PlusMenu.tsx frontend/src/pages/Workbench.tsx frontend/src/pages/Workbench.test.tsx
git commit -m "工作台接入目标入口：PlusMenu「目标」切换 GoalsView"
```

---

### Task 7: 文档同步与批 1 收尾

**Files:**
- Modify: `docs/architecture.md`（目录清单）
- Modify: `docs/superpowers/specs/2026-10-21-later-roadmap.md`（第 0 节增补）
- Modify: `AGENTS.md`（3.1 当前事项提及）

**Interfaces:**
- Consumes: 无
- Produces: 文档与代码一致，满足 AGENTS.md 第 8 节「先改规范再改代码」的补记

- [ ] **Step 1: architecture.md 增补目录**

`## 2. 后端` 的目录树里，`auth/` 块之后追加：

```text
      goals/
        templates.py            初中 9 科课标骨架常量
```

`api/` 块内追加一行：

```text
      goals.py                  目标树的请求解析与响应组装
```

`## 4. 前端` 的目录树 `api/` 描述后追加：

```text
    types/goals.ts       目标树类型（与后端 tree_view/node_view 一致）
    pages/GoalsView.tsx  目标管理视图
```

- [ ] **Step 2: later-roadmap.md 第 0 节增补**

在「## 0. 当前决定（2026-10-22）」段末追加一段：

```markdown
2026-10-31 增补：用户明确要求新增「目标与计划管理」独立模块，与阶段一并行推进、互不阻塞。设计见 [目标与计划管理设计](2026-10-31-goals-plans-design.md)，按四批交付：批 1 目标树与基础视图，批 2 计划与映射，批 3 AI 拆解/导出/定稿快照，批 4 可用性走查。本模块不改动对话图、工具注册表与任务四态。
```

- [ ] **Step 3: AGENTS.md 3.1 提及**

`### 3.1 MVP 优先` 中「当前要做的是教师登录……」段后追加一句：

```markdown
2026-10-31 起并行推进「目标与计划管理」模块（用户明确要求），范围与批次以 `docs/superpowers/specs/2026-10-31-goals-plans-design.md` 为准；它不改动对话图与工具注册表。
```

- [ ] **Step 4: 全量回归**

后端：`.\.venv\Scripts\python.exe -m pytest -q`（cwd `backend/`）——仅既有 preview 1 例失败
前端：`npm run typecheck && npm test`（cwd `frontend/`）——全部通过

- [ ] **Step 5: 手动冒烟（可选但推荐）**

后端 `.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory` 启动 + 前端 `npm run dev`，浏览器注册账号 → ＋ 菜单点「目标」→ 新建目标树（勾选预填）→ 确认学期总目标草稿出现 → 加单元 → 单元下加课时 → 编辑保存 → 上移/下移 → 删除课时 → 返回对话。

- [ ] **Step 6: 提交**

```bash
git add docs/architecture.md docs/superpowers/specs/2026-10-21-later-roadmap.md AGENTS.md
git commit -m "文档同步：目标与计划管理批 1 目录与路线增补"
```

---

## 自审记录（已执行）

1. **规格覆盖**：批 1 范围 = 设计文档第 8 节批次 1（数据模型、目标树 CRUD、课标模板、属主隔离、基础 GoalsView）——Tasks 1-6 全覆盖；计划条目/映射（批 2）、AI 拆解/导出/快照（批 3）、走查（批 4）明确不在本计划。同学期多棵树（设计第 1 节修订）由 `test_create_and_list_goal_trees_filters_by_dimensions` 覆盖。
2. **占位符扫描**：Task 6 Step 1 的 `fakeApi` 引用了目标文件既有变量——这是对现有测试文件的引用而非占位符，已注明「按实际命名替换」；其余步骤均含完整代码。
3. **类型一致性**：仓储签名（Task 1）↔ API 调用（Task 3 Step 4b）↔ 前端 `GoalsApi`（Task 4）↔ GoalsView props（Task 5/6）字段名逐一核对一致（`tree_id`/`node_id`/`parent_id`/`standard_refs`/`verify_criteria`/`sort_order`）。
