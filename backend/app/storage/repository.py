"""任务、会话事件、产物和版本。数据库驱动只出现在这个目录。"""

import json
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.artifacts.contract import ARTIFACT_TYPE, artifact_view
from app.tasks.states import transition as change_status

EVENT_TYPES = {"user_message", "assistant_message", "tool_result", "artifact_published"}
MAX_REQUEST_CHARS = 4000


class InputError(ValueError):
    code = "invalid_input"


class ConflictError(Exception):
    code = "conflict"


class NotFoundError(Exception):
    code = "not_found"


@dataclass
class Task:
    id: str
    status: str
    step_count: int
    error_code: str | None
    error_message: str | None
    artifact_id: str | None
    version: int | None
    conversation_id: str | None
    reply: str | None
    raw_request: str
    preset_hint: str | None
    created_at: str
    updated_at: str


@dataclass
class Event:
    seq: int
    type: str
    payload: dict
    created_at: str


@dataclass
class VersionRecord:
    artifact_id: str
    version: int
    task_id: str
    title: str
    tool_name: str
    preset: str | None
    files: list
    metadata: dict
    arguments: dict


class Repository:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        self._depth = 0
        self._create_schema()

    def create_task(self, raw_request: str, preset_hint: str | None) -> Task:
        if not isinstance(raw_request, str) or raw_request.strip() == "" or len(raw_request) > MAX_REQUEST_CHARS:
            raise InputError("invalid task request")
        if preset_hint is not None:
            raise InputError("invalid preset hint")
        now = _now()
        task_id = uuid4().hex
        with self.transaction():
            self._conn.execute(
                """
                INSERT INTO tasks (
                  id, status, step_count, error_code, error_message,
                  artifact_id, version, raw_request, preset_hint, created_at, updated_at
                ) VALUES (?, 'pending', 0, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
                """,
                (task_id, raw_request, preset_hint, now, now),
            )
        task = self.get_task(task_id)
        if task is None:
            raise RuntimeError("task insert failed")
        return task

    def get_task(self, task_id: str) -> Task | None:
        row = self._conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return _task(row) if row else None

    def create_conversation(self) -> str:
        conversation_id = uuid4().hex
        with self.transaction():
            self._conn.execute(
                "INSERT INTO conversations (id, created_at) VALUES (?, ?)",
                (conversation_id, _now()),
            )
        return conversation_id

    def submit_message(self, conversation_id: str, content: str) -> Task:
        if not isinstance(content, str):
            raise InputError("invalid task request")
        text = content.strip()
        if text == "" or len(text) > MAX_REQUEST_CHARS:
            raise InputError("invalid task request")
        task_id = uuid4().hex
        now = _now()
        with self.transaction():
            found = self._conn.execute(
                "SELECT id FROM conversations WHERE id = ?",
                (conversation_id,),
            ).fetchone()
            if found is None:
                raise NotFoundError("conversation not found")
            open_task = self._conn.execute(
                """
                SELECT id FROM tasks
                WHERE conversation_id = ? AND status IN ('pending', 'running')
                """,
                (conversation_id,),
            ).fetchone()
            if open_task is not None:
                raise ConflictError("conversation is busy")
            self._conn.execute(
                """
                INSERT INTO tasks (
                  id, status, step_count, error_code, error_message,
                  artifact_id, version, raw_request, preset_hint,
                  conversation_id, reply, created_at, updated_at
                ) VALUES (?, 'pending', 0, NULL, NULL, NULL, NULL, ?, NULL, ?, NULL, ?, ?)
                """,
                (task_id, text, conversation_id, now, now),
            )
        task = self.get_task(task_id)
        if task is None:
            raise RuntimeError("task insert failed")
        return task

    def succeeded_turns(self, conversation_id: str) -> list[tuple[str, str]]:
        rows = self._conn.execute(
            """
            SELECT raw_request, reply FROM tasks
            WHERE conversation_id = ? AND status = 'succeeded'
            ORDER BY created_at, id
            """,
            (conversation_id,),
        ).fetchall()
        return [(row["raw_request"], row["reply"] or "") for row in rows]

    def list_conversation_tasks(self, conversation_id: str) -> list[Task] | None:
        found = self._conn.execute(
            "SELECT id FROM conversations WHERE id = ?",
            (conversation_id,),
        ).fetchone()
        if found is None:
            return None
        rows = self._conn.execute(
            "SELECT * FROM tasks WHERE conversation_id = ? ORDER BY created_at, id",
            (conversation_id,),
        ).fetchall()
        return [_task(row) for row in rows]

    def set_step_count(self, task_id: str, step_count: int) -> None:
        with self.transaction():
            current = self.get_task(task_id)
            if current is None or current.status != "running":
                raise ValueError("step count can only change while running")
            self._conn.execute(
                "UPDATE tasks SET step_count = ?, updated_at = ? WHERE id = ?",
                (step_count, _now(), task_id),
            )

    def transition(
        self,
        task_id: str,
        new_status: str,
        *,
        step_count: int | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        artifact_id: str | None = None,
        version: int | None = None,
        reply: str | None = None,
    ) -> None:
        with self.transaction():
            current = self.get_task(task_id)
            if current is None:
                raise KeyError(task_id)
            change_status(current.status, new_status)
            fields = ["status = ?", "updated_at = ?"]
            params: list = [new_status, _now()]
            if step_count is not None:
                fields.append("step_count = ?")
                params.append(step_count)
            if error_code is not None:
                fields.append("error_code = ?")
                params.append(error_code)
            if error_message is not None:
                fields.append("error_message = ?")
                params.append(error_message)
            if artifact_id is not None:
                fields.append("artifact_id = ?")
                params.append(artifact_id)
            if version is not None:
                fields.append("version = ?")
                params.append(version)
            if reply is not None:
                fields.append("reply = ?")
                params.append(reply)
            params.append(task_id)
            self._conn.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", params)

    def append_event(self, task_id: str, event_type: str, payload: dict) -> Event:
        if event_type not in EVENT_TYPES:
            raise ValueError(f"unknown event type: {event_type}")
        with self.transaction():
            row = self._conn.execute(
                "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            seq = int(row["seq"])
            created_at = _now()
            self._conn.execute(
                "INSERT INTO events (task_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                (task_id, seq, event_type, json.dumps(payload, ensure_ascii=False), created_at),
            )
        return Event(seq=seq, type=event_type, payload=payload, created_at=created_at)

    def list_events(self, task_id: str) -> list[Event]:
        rows = self._conn.execute(
            "SELECT seq, type, payload, created_at FROM events WHERE task_id = ? ORDER BY seq",
            (task_id,),
        ).fetchall()
        return [
            Event(seq=row["seq"], type=row["type"], payload=json.loads(row["payload"]), created_at=row["created_at"])
            for row in rows
        ]

    def last_event(self, task_id: str) -> Event | None:
        events = self.list_events(task_id)
        return events[-1] if events else None

    def list_running(self) -> list[Task]:
        rows = self._conn.execute("SELECT * FROM tasks WHERE status = 'running'").fetchall()
        return [_task(row) for row in rows]

    def insert_published_version(
        self,
        *,
        artifact_id: str,
        version: int,
        task_id: str,
        title: str,
        tool_name: str,
        preset: str | None,
        files: list,
        metadata: dict,
        arguments: dict,
    ) -> None:
        now = _now()
        with self.transaction():
            self._conn.execute(
                "INSERT INTO artifacts (id, artifact_type, title, created_at) VALUES (?, ?, ?, ?)",
                (artifact_id, ARTIFACT_TYPE, title, now),
            )
            self._conn.execute(
                """
                INSERT INTO versions (
                  artifact_id, version, task_id, title, tool_name, preset,
                  files, metadata, arguments, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    artifact_id,
                    version,
                    task_id,
                    title,
                    tool_name,
                    preset,
                    json.dumps(files, ensure_ascii=False),
                    json.dumps(metadata, ensure_ascii=False),
                    json.dumps(arguments, ensure_ascii=False),
                    now,
                ),
            )

    def get_version(self, artifact_id: str, version: int) -> VersionRecord | None:
        row = self._conn.execute(
            "SELECT * FROM versions WHERE artifact_id = ? AND version = ?",
            (artifact_id, version),
        ).fetchone()
        if row is None:
            return None
        return VersionRecord(
            artifact_id=row["artifact_id"],
            version=row["version"],
            task_id=row["task_id"],
            title=row["title"],
            tool_name=row["tool_name"],
            preset=row["preset"],
            files=json.loads(row["files"]),
            metadata=json.loads(row["metadata"]),
            arguments=json.loads(row["arguments"]),
        )

    def artifact_view(self, artifact_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT version FROM versions WHERE artifact_id = ? ORDER BY version DESC LIMIT 1",
            (artifact_id,),
        ).fetchone()
        if row is None:
            return None
        record = self.get_version(artifact_id, row["version"])
        if record is None:
            return None
        return artifact_view(
            artifact_id=record.artifact_id,
            title=record.title,
            version=record.version,
            tool_name=record.tool_name,
            preset=record.preset,
            files=record.files,
            metadata=record.metadata,
        )

    @contextmanager
    def transaction(self):
        with self._lock:
            outermost = self._depth == 0
            if outermost:
                self._conn.execute("BEGIN IMMEDIATE")
            self._depth += 1
            try:
                yield
            except Exception:
                self._depth -= 1
                if outermost:
                    self._conn.rollback()
                raise
            else:
                self._depth -= 1
                if outermost:
                    self._conn.commit()

    def _create_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY,
              status TEXT NOT NULL,
              step_count INTEGER NOT NULL,
              error_code TEXT,
              error_message TEXT,
              artifact_id TEXT,
              version INTEGER,
              raw_request TEXT NOT NULL,
              preset_hint TEXT,
              conversation_id TEXT,
              reply TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
              task_id TEXT NOT NULL,
              seq INTEGER NOT NULL,
              type TEXT NOT NULL,
              payload TEXT NOT NULL,
              created_at TEXT NOT NULL,
              PRIMARY KEY (task_id, seq)
            );
            CREATE TABLE IF NOT EXISTS artifacts (
              id TEXT PRIMARY KEY,
              artifact_type TEXT NOT NULL,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS versions (
              artifact_id TEXT NOT NULL,
              version INTEGER NOT NULL,
              task_id TEXT NOT NULL,
              title TEXT NOT NULL,
              tool_name TEXT NOT NULL,
              preset TEXT,
              files TEXT NOT NULL,
              metadata TEXT NOT NULL,
              arguments TEXT NOT NULL,
              created_at TEXT NOT NULL,
              PRIMARY KEY (artifact_id, version)
            );
            """
        )


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _task(row: sqlite3.Row) -> Task:
    return Task(
        id=row["id"],
        status=row["status"],
        step_count=row["step_count"],
        error_code=row["error_code"],
        error_message=row["error_message"],
        artifact_id=row["artifact_id"],
        version=row["version"],
        raw_request=row["raw_request"],
        preset_hint=row["preset_hint"],
        conversation_id=row["conversation_id"],
        reply=row["reply"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
