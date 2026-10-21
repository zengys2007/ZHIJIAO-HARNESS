"""工具节点：一步只执行一个已注册且参数合法的调用。"""

from app.tools.protocol import Turn
from app.tools.schema import argument_errors


def make_tool_node(registry):
    def tool_node(state: dict) -> dict:
        calls = state["messages"][-1].get("tool_calls") or []
        if len(calls) != 1:
            call_id = calls[0]["id"] if calls else "none"
            return {"messages": [_tool_message(call_id, "", "一步只能调用一个工具")]}
        call = calls[0]
        tool = registry.get(call["name"])
        if tool is None:
            return {"messages": [_tool_message(call["id"], call["name"], f"{call['name']} 不在注册表里")]}
        arguments = call.get("arguments")
        errors = argument_errors(tool.parameters, arguments)
        if errors:
            return {
                "messages": [_tool_message(call["id"], tool.name, "参数不符合：" + "；".join(errors))]
            }
        turn = Turn(task_id=state["task_id"], candidate=state.get("candidate"), store=state["store"])
        text = tool.execute(arguments, turn)
        if tool.stop_after:
            return {
                "messages": [_tool_message(call["id"], tool.name, text)],
                "candidate": None,
                "stop": tool.stop_after,
            }
        return {
            "messages": [_tool_message(call["id"], tool.name, text)],
            "candidate": turn.candidate,
        }

    return tool_node


def _tool_message(call_id: str, name: str, content: str) -> dict:
    return {"role": "tool", "tool_call_id": call_id, "name": name, "content": content}
