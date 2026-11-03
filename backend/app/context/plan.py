"""计划正文挂在交接摘要之后。草稿只修订计划，确认后的一轮才要求交付成品。"""

from app.context.assemble import escape_teacher_text
from app.llm.usage import count_messages_locally

DRAFT_LEAD = (
    "当前处于计划模式：只修订下面的计划，不要交付试题、评语或课件成品。\n"
    "这一轮不要用短标题、表格、加粗或井号。方案用 A、B、C，不要写成方案一。\n"
    "至少写两套，每套严格三行，行首不要加符号：\n"
    "方案 A：名称\n"
    "适合：一句话\n"
    "步骤：一句话\n"
    "全部写完后，最后单独一行写：推荐：方案 A\n"
    "方案正文里不要出现「推荐」。"
)
DELIVER_LEAD = "教师已选定下面这一套方案。只按这一套生成可直接使用的成品，不要混用其他方案，也不要再改写成新计划。"
BODY_LABEL = "计划正文："
PLAN_EMPTY = "还没有可确认的计划，先写出计划再生成。"
PLAN_NOT_DRAFT = "先进入计划模式再改计划。"
PLAN_TOO_LARGE = "这份计划占的上下文已经放不下输出，缩短后再保存。"


def plan_message(status: str, body: str) -> str:
    text = body.strip()
    if status == "draft":
        if text == "":
            return DRAFT_LEAD
        return f"{DRAFT_LEAD}\n{BODY_LABEL}\n{escape_teacher_text(text)}"
    if status == "approved" and text:
        return f"{DELIVER_LEAD}\n{BODY_LABEL}\n{escape_teacher_text(text)}"
    return ""


def plan_tokens(status: str, body: str, count_tokens=count_messages_locally) -> int:
    text = plan_message(status, body)
    if text == "":
        return 0
    base = [{"role": "system", "content": " "}]
    extra = [{"role": "user", "content": text}]
    return count_tokens(base + extra) - count_tokens(base)
