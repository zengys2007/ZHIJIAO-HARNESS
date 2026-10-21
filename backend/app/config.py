"""只从环境变量读取配置。"""

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""
    llm_timeout_seconds: int = 60


def load_settings() -> Settings:
    raw = os.environ.get("DATA_DIR", "data")
    base_url = os.environ.get("LLM_BASE_URL", "").strip()
    api_key = os.environ.get("LLM_API_KEY", "").strip()
    model = os.environ.get("LLM_MODEL", "").strip()
    if not base_url or not api_key or not model:
        raise RuntimeError("LLM_BASE_URL, LLM_API_KEY and LLM_MODEL are required")
    timeout_raw = os.environ.get("LLM_TIMEOUT_SECONDS", "60")
    try:
        timeout = int(timeout_raw)
    except ValueError as exc:
        raise RuntimeError("LLM_TIMEOUT_SECONDS must be an integer") from exc
    return Settings(
        data_dir=Path(raw).expanduser().resolve(),
        llm_base_url=base_url,
        llm_api_key=api_key,
        llm_model=model,
        llm_timeout_seconds=timeout,
    )
