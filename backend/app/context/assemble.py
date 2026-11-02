"""一轮里交给模型的消息。"""


def escape_teacher_text(text: str) -> str:
    return text.replace("</", "<\\/")


def assemble_model_input(
    system: str,
    prior_turns: list[tuple[str, str]],
    current_user: str,
    turn_messages: list[dict],
    context_digest: str = "",
    context_summary: str = "",
    context_goal: str = "",
    context_plan: bool = False,
) -> list[dict]:
    prefix = [{"role": "system", "content": system}]
    if context_digest:
        prefix.append({"role": "system", "content": context_digest})
    return context_messages(
        prefix,
        context_summary,
        prior_turns,
        current_user,
        turn_messages,
        goal=context_goal,
        plan=context_plan,
    )


def context_messages(
    prefix: list[dict],
    summary: str,
    prior_turns: list[tuple[str, str]],
    current_user: str | None,
    extra: list[dict] | None = None,
    *,
    goal: str = "",
    plan: bool = False,
) -> list[dict]:
    from app.context.goal import goal_message
    from app.context.plan import plan_message

    messages = list(prefix)
    if summary:
        messages.append({"role": "user", "content": escape_teacher_text(summary)})
    if goal:
        messages.append({"role": "user", "content": goal_message(goal)})
    plan_text = plan_message(plan)
    if plan_text:
        messages.append({"role": "user", "content": plan_text})
    for user_text, assistant_text in prior_turns:
        messages.append({"role": "user", "content": escape_teacher_text(user_text)})
        messages.append({"role": "assistant", "content": assistant_text})
    if current_user is not None:
        messages.append({"role": "user", "content": escape_teacher_text(current_user)})
    if extra:
        messages.extend(extra)
    return messages
