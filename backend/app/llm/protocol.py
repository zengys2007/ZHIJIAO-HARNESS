"""complete 的返回结构。业务代码不引用供应商 SDK。"""

from dataclasses import dataclass


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class AssistantMessage:
    content: str
    tool_calls: list[ToolCall]
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


@dataclass
class ModelError:
    code: str
    message: str
