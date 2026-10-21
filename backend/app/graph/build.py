"""编译 StateGraph。编译时不带检查点，节点不带重试策略。"""

from langgraph.graph import END, START, StateGraph

from app.graph.edges import route_after_model, route_after_tools
from app.graph.model_node import make_model_node
from app.graph.state import GraphState
from app.graph.tool_node import make_tool_node

SYSTEM_LIMIT = 4000
RECURSION_LIMIT = 20


def build_graph(registry, complete, *, system: str):
    if len(system) > SYSTEM_LIMIT:
        raise ValueError("system prompt exceeds 4000 characters")
    graph = StateGraph(GraphState)
    graph.add_node("model", make_model_node(registry, complete, system))
    graph.add_node("tools", make_tool_node(registry))
    graph.add_edge(START, "model")
    graph.add_conditional_edges("model", route_after_model, {"tools": "tools", "end": END})
    graph.add_conditional_edges("tools", route_after_tools, {"model": "model", "end": END})
    return graph.compile()


def invoke_graph(graph, state: dict) -> dict:
    return graph.invoke(state, {"recursion_limit": RECURSION_LIMIT})
