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
    context_ask: str = "",
    context_plan: str = "",
    knowledge_digest: str = "",
) -> list[dict]:
    prefix = [{"role": "system", "content": system}]
    if context_digest:
        prefix.append({"role": "system", "content": context_digest})
    if knowledge_digest:
        prefix.append({"role": "system", "content": knowledge_digest})
    return context_messages(
        prefix,
        context_summary,
        prior_turns,
        current_user,
        turn_messages,
        ask=context_ask,
        plan=context_plan,
    )


def context_messages(
    prefix: list[dict],
    summary: str,
    prior_turns: list[tuple[str, str]],
    current_user: str | None,
    extra: list[dict] | None = None,
    *,
    ask: str = "",
    plan: str = "",
) -> list[dict]:
    messages = list(prefix)
    if summary:
        messages.append({"role": "user", "content": escape_teacher_text(summary)})
    if ask:
        messages.append({"role": "user", "content": ask})
    if plan:
        messages.append({"role": "system", "content": plan})
    for user_text, assistant_text in prior_turns:
        messages.append({"role": "user", "content": escape_teacher_text(user_text)})
        messages.append({"role": "assistant", "content": assistant_text})
    if current_user is not None:
        messages.append({"role": "user", "content": escape_teacher_text(current_user)})
    if extra:
        messages.extend(extra)
    return messages
