"""模型连通性请求的字段校验。不引用 Web 框架。"""

from urllib.parse import urlparse

from app.api.messages import RequestError


def parse_probe(body: object) -> dict:
    if not isinstance(body, dict) or "source" not in body:
        raise RequestError("invalid probe")
    source = body["source"]
    if source == "local" and set(body) == {"source"}:
        return {"source": "local"}
    if source == "dotenv" and set(body) <= {"source", "base_url", "model", "api_key"}:
        parsed = {"source": "dotenv"}
        for field in ("base_url", "model", "api_key"):
            if field not in body:
                continue
            value = body[field]
            if not isinstance(value, str):
                raise RequestError("invalid probe")
            parsed[field] = value.strip()
        if "base_url" in parsed and parsed["base_url"] and not _http_origin(parsed["base_url"]):
            raise RequestError("invalid probe")
        if any(len(parsed.get(field, "")) > limit for field, limit in (("base_url", 2000), ("model", 200), ("api_key", 500))):
            raise RequestError("invalid probe")
        return parsed
    raise RequestError("invalid probe")


def _http_origin(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and parsed.netloc != "" and parsed.username is None and parsed.password is None
