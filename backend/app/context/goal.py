"""会话目标挂在交接摘要之后，并按 token 占用上下文。"""

from app.context.assemble import escape_teacher_text
from app.llm.usage import count_messages_locally

GOAL_LABEL = "当前会话目标："
GOAL_TOO_LARGE = "这个目标占的上下文已经放不下输出，缩短后再保存。"


def goal_message(text: str) -> str:
    return GOAL_LABEL + escape_teacher_text(text)


def goal_tokens(text: str, count_tokens=count_messages_locally) -> int:
    if text == "":
        return 0
    base = [{"role": "system", "content": " "}]
    extra = [{"role": "user", "content": goal_message(text)}]
    return count_tokens(base + extra) - count_tokens(base)
