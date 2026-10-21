"""条件边：无工具调用、ask_teacher、满 6 步。"""

STEP_LIMIT = 6


def route_after_model(state: dict) -> str:
    if state.get("stop"):
        return "end"
    messages = state.get("messages") or []
    if not messages:
        return "end"
    last = messages[-1]
    if last.get("role") == "assistant" and last.get("tool_calls"):
        return "tools"
    return "end"


def route_after_tools(state: dict) -> str:
    if state.get("stop") or state.get("step_count", 0) >= STEP_LIMIT:
        return "end"
    return "model"
