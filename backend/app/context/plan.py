"""计划模式挂在目标之后，用固定说明占用上下文。"""

from app.llm.usage import count_messages_locally

PLAN_MESSAGE = (
    "当前处于计划模式：先写出可审阅的计划，等教师确认后再生成具体成品；不要跳过计划直接交付。"
)


def plan_message(enabled: bool) -> str:
    return PLAN_MESSAGE if enabled else ""


def plan_tokens(enabled: bool, count_tokens=count_messages_locally) -> int:
    text = plan_message(enabled)
    if text == "":
        return 0
    base = [{"role": "system", "content": " "}]
    extra = [{"role": "user", "content": text}]
    return count_tokens(base + extra) - count_tokens(base)
