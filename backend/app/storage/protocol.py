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


@dataclass
class TeachingClass:
    id: str
    owner_id: str
    name: str
    created_at: str


@dataclass
class StudentRecord:
    id: str
    class_id: str
    name: str


@dataclass
class KnowledgePoint:
    id: str
    owner_id: str
    name: str
    description: str
    prerequisites: list


@dataclass
class Assignment:
    id: str
    owner_id: str
    class_id: str
    title: str
    kind: str
    created_at: str


@dataclass
class ScoreCell:
    assignment_id: str
    student_name: str
    knowledge_point_id: str
    knowledge_point_name: str
    score: float


@dataclass
class TeachingDocument:
    id: str
    owner_id: str
    doc_type: str
    title: str
    content: str
    created_at: str


@dataclass
class TeachingData:
    """一位教师的全部教学上下文，供洞察计算和模型摘要使用。"""

    classes: list[TeachingClass]
    students: list[StudentRecord]
    knowledge_points: list[KnowledgePoint]
    assignments: list[Assignment]
    scores: list[ScoreCell]
    documents: list[TeachingDocument]


EMPTY_TEACHING = TeachingData(
    classes=[], students=[], knowledge_points=[], assignments=[], scores=[], documents=[]
)


@dataclass
class AssignmentInput:
    """一次作业/测验的成绩录入：学生名 -> [(知识点名, 得分)]。"""

    class_id: str
    title: str
    kind: str
    records: list


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

    def succeeded_turn_records(self, conversation_id: str) -> list[tuple[str, str, str]]: ...

    def get_context_state(self, conversation_id: str) -> tuple[str, str, int | None]: ...

    def save_context_summary(self, conversation_id: str, summary: str, until_task_id: str) -> None: ...

    def save_context_usage(self, conversation_id: str, used_tokens: int) -> None: ...

    def get_goal(self, conversation_id: str) -> str: ...

    def save_goal(self, conversation_id: str, owner_id: str, goal: str) -> str | None: ...

    def get_plan_mode(self, conversation_id: str) -> bool: ...

    def save_plan_mode(self, conversation_id: str, owner_id: str, enabled: bool) -> bool | None: ...

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

    def transaction(self) -> Iterator[None]: ...

    def create_task(self, raw_request: str, preset_hint: str | None) -> Task: ...

    def create_class(self, owner_id: str, name: str, student_names: list[str]) -> str: ...

    def create_knowledge_point(
        self, owner_id: str, name: str, description: str, prerequisites: list[str]
    ) -> str: ...

    def create_assignment(self, owner_id: str, assignment: AssignmentInput) -> str: ...

    def create_document(self, owner_id: str, doc_type: str, title: str, content: str) -> str: ...

    def load_teaching(self, owner_id: str) -> TeachingData: ...

    def get_conversation_owner(self, conversation_id: str) -> str | None: ...
