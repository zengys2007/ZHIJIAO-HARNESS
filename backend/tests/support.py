"""测试里用来发布普通页面的工具。不是产品功能。"""

from uuid import uuid4

from app.tools.protocol import Tool
from app.validation.page import validate_page

PLAIN_PAGE = "<!DOCTYPE html><html><body><p>课堂页面</p></body></html>"
BROKEN_PAGE = (
    "<!DOCTYPE html><html><body>"
    "<script src=\"https://evil.example/a.js\"></script>"
    "<p>课堂页面</p></body></html>"
)


def make_page_tool(*, valid: bool = True) -> Tool:
    def execute(arguments, turn):
        html = PLAIN_PAGE if valid else BROKEN_PAGE
        files = [{"path": "index.html", "content": html, "media_type": "text/html"}]
        result = validate_page(files)
        if not result.ok:
            return "校验未通过：" + "；".join(result.errors)
        turn.store.write_candidate(turn.task_id, [{"path": "index.html", "content": html}])
        turn.candidate = {
            "artifact_id": uuid4().hex,
            "title": arguments.get("title", "课堂页面"),
            "tool_name": "page_fixture",
            "preset": None,
            "files": [{"path": "index.html", "media_type": "text/html", "role": "entry"}],
            "arguments": arguments,
        }
        return "校验通过，本轮结束且没有新的工具调用时会发布"

    return Tool(
        name="page_fixture",
        description="测试用页面工具。",
        parameters={
            "type": "object",
            "additionalProperties": False,
            "required": ["title"],
            "properties": {"title": {"type": "string", "minLength": 1}},
        },
        execute=execute,
    )
