"""产物字段和 capabilities 的唯一定义。"""

ARTIFACT_TYPE = "interactive-page"
CAPABILITIES = ["preview", "revise", "export"]


def artifact_view(
    *,
    artifact_id: str,
    title: str,
    version: int,
    tool_name: str,
    preset: str | None,
    files: list[dict],
    metadata: dict,
) -> dict:
    return {
        "artifact_id": artifact_id,
        "artifact_type": ARTIFACT_TYPE,
        "title": title,
        "version": version,
        "tool_name": tool_name,
        "preset": preset,
        "files": files,
        "metadata": metadata,
        "capabilities": list(CAPABILITIES),
    }
