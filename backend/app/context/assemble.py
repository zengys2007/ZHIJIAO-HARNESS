"""一轮里交给模型的消息。"""

HISTORY_LIMIT = 12000


def escape_teacher_text(text: str) -> str:
    return text.replace("</", "<\\/")


def assemble_model_input(
    system: str,
    prior_turns: list[tuple[str, str]],
    current_user: str,
    turn_messages: list[dict],
) -> list[dict]:
    messages: list[dict] = [{"role": "system", "content": system}]
    for user_text, assistant_text in _trim_turns(prior_turns, HISTORY_LIMIT):
        messages.append({"role": "user", "content": escape_teacher_text(user_text)})
        messages.append({"role": "assistant", "content": assistant_text})
    messages.append({"role": "user", "content": escape_teacher_text(current_user)})
    messages.extend(turn_messages)
    return messages


def _trim_turns(turns: list[tuple[str, str]], limit: int) -> list[tuple[str, str]]:
    kept = list(turns)
    while kept and sum(len(user) + len(assistant) for user, assistant in kept) > limit:
        kept.pop(0)
    return kept
