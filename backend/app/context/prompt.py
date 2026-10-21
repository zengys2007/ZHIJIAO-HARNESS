"""读取启动时的系统提示词。"""

from pathlib import Path

LIMIT = 4000


def load_system_prompt() -> str:
    path = Path(__file__).resolve().parents[1] / "prompts" / "system.md"
    text = path.read_text(encoding="utf-8").strip()
    if text == "" or len(text) > LIMIT:
        raise RuntimeError("system prompt must be 1 to 4000 characters")
    return text
