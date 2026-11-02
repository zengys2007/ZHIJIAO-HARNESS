"""模型节点：拼装消息，调用 complete，步数加一。"""

from app.context.assemble import assemble_model_input
from app.llm.protocol import AssistantMessage, ModelError


def make_model_node(registry, complete, system: str):
    def model_node(state: dict) -> dict:
        tools = registry.project()
        result = complete(
            assemble_model_input(
                system,
                list(state.get("prior") or []),
                state.get("current_user") or "",
                state["messages"],
                state.get("context_digest") or "",
                state.get("context_summary") or "",
                state.get("context_goal") or "",
                bool(state.get("context_plan")),
            ),
            tools or None,
        )
        if isinstance(result, ModelError):
            return {"stop": result.code}
        if not isinstance(result, AssistantMessage):
            return {"stop": "model_invalid_output"}
        tool_calls = [
            {"id": call.id, "name": call.name, "arguments": call.arguments}
            for call in result.tool_calls
        ]
        return {
            "messages": [{"role": "assistant", "content": result.content, "tool_calls": tool_calls}],
            "step_count": state["step_count"] + 1,
            "stop": "",
            "prompt_tokens": result.prompt_tokens or 0,
            "completion_tokens": result.completion_tokens or 0,
        }

    return model_node
