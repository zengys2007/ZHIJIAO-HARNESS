"""读取启动时的系统提示词。"""

from pathlib import Path

def load_system_prompt() -> str:
    path = Path(__file__).resolve().parents[1] / "prompts" / "system.md"
    text = path.read_text(encoding="utf-8").strip()
    if text == "":
        raise RuntimeError("system prompt must not be empty")
    return text
