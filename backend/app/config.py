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
    auth_secret: str = ""
    auth_admin_password: str = ""


_filled_from_file: dict[str, str] = {}


def load_env_file(path: Path | None = None) -> None:
    for key, value in read_dotenv_values(path).items():
        if key and key not in os.environ:
            os.environ[key] = value
            _filled_from_file[key] = value


def read_dotenv_values(path: Path | None = None) -> dict[str, str]:
    env_path = default_env_path() if path is None else path
    if not env_path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def default_env_path() -> Path:
    return Path(__file__).resolve().parents[2] / ".env"


def process_llm() -> dict[str, str]:
    return {
        "base_url": _process_value("LLM_BASE_URL"),
        "api_key": _process_value("LLM_API_KEY"),
        "model": _process_value("LLM_MODEL"),
    }


def _process_value(name: str) -> str:
    current = os.environ.get(name, "").strip()
    if name in _filled_from_file and current == _filled_from_file[name]:
        return ""
    return current


def dotenv_llm(path: Path | None = None) -> dict[str, str]:
    values = read_dotenv_values(path)
    return {
        "base_url": values.get("LLM_BASE_URL", "").strip(),
        "api_key": values.get("LLM_API_KEY", "").strip(),
        "model": values.get("LLM_MODEL", "").strip(),
    }


def load_settings() -> Settings:
    raw = os.environ.get("DATA_DIR", "data")
    base_url = os.environ.get("LLM_BASE_URL", "").strip()
    api_key = os.environ.get("LLM_API_KEY", "").strip()
    model = os.environ.get("LLM_MODEL", "").strip()
    if not base_url or not api_key or not model:
        raise RuntimeError("LLM_BASE_URL, LLM_API_KEY and LLM_MODEL are required")
    auth_secret = os.environ.get("AUTH_SECRET", "").strip()
    if len(auth_secret) < 16:
        raise RuntimeError("AUTH_SECRET must be at least 16 characters")
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
        auth_secret=auth_secret,
        auth_admin_password=os.environ.get("AUTH_ADMIN_PASSWORD", ""),
    )
