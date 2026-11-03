"""提问模式挂在交接摘要之后。打开时只回答问题，不交付成品。"""

from app.llm.usage import count_messages_locally

ASK_LEAD = "当前处于提问模式：只回答教师的问题，不要交付试题、评语或课件成品。"


def ask_message(enabled: bool) -> str:
    return ASK_LEAD if enabled else ""


def ask_tokens(enabled: bool, count_tokens=count_messages_locally) -> int:
    text = ask_message(enabled)
    if text == "":
        return 0
    base = [{"role": "system", "content": " "}]
    extra = [{"role": "user", "content": text}]
    return count_tokens(base + extra) - count_tokens(base)
