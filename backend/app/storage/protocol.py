"""存储调用方使用的类型和方法。不含数据库驱动。"""

from dataclasses import dataclass
from typing import Iterator, Protocol


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


@dataclass
class User:
    id: str
    username: str
    display_name: str
    password_hash: str
    created_at: str


@dataclass
class Session:
    id: str
    user_id: str
    expires_at: str
    created_at: str


@dataclass
class ConversationSummary:
    conversation_id: str
    title: str
    created_at: str


class Repository(Protocol):
    def create_user(self, username: str, display_name: str, password_hash: str) -> User: ...

    def get_user(self, user_id: str) -> User | None: ...

    def get_user_by_username(self, username: str) -> User | None: ...

    def create_session(self, user_id: str, expires_at: str) -> Session: ...

    def get_session(self, session_id: str) -> Session | None: ...

    def delete_session(self, session_id: str) -> None: ...

    def create_conversation(self, owner_id: str) -> str: ...

    def list_conversations(self, owner_id: str) -> list[ConversationSummary]: ...

    def submit_message(self, conversation_id: str, content: str, owner_id: str) -> Task: ...

    def list_conversation_tasks(self, conversation_id: str, owner_id: str) -> list[Task] | None: ...

    def get_task(self, task_id: str) -> Task | None: ...

    def get_task_for_owner(self, task_id: str, owner_id: str) -> Task | None: ...

    def succeeded_turns(self, conversation_id: str) -> list[tuple[str, str]]: ...

    def set_step_count(self, task_id: str, step_count: int) -> None: ...

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
    ) -> None: ...

    def append_event(self, task_id: str, event_type: str, payload: dict) -> Event: ...

    def list_events(self, task_id: str) -> list[Event]: ...

    def last_event(self, task_id: str) -> Event | None: ...

    def list_running(self) -> list[Task]: ...

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
    ) -> None: ...

    def get_version(self, artifact_id: str, version: int) -> VersionRecord | None: ...

    def artifact_view(self, artifact_id: str) -> dict | None: ...

    def transaction(self) -> Iterator[None]: ...

    def create_task(self, raw_request: str, preset_hint: str | None) -> Task: ...
