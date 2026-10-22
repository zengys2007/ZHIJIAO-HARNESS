"""进程入口。挂上对话 API，并在进程内启动执行器。"""

import json
import re
import threading
import asyncio
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
import uvicorn

from app.api.errors import error_payload
from app.api.messages import RequestError, parse_create_conversation, parse_message
from app.api.probe import parse_probe
from app.api.views import conversation_payload, task_payload
from app.config import Settings, dotenv_llm, load_env_file, load_settings, process_llm
from app.context.prompt import load_system_prompt
from app.graph.build import build_graph
from app.llm.complete import make_complete
from app.llm.probe import probe_chat
from app.preview.serve import load_preview
from app.storage.files import FileStore
from app.storage.repository import ConflictError, NotFoundError, Repository
from app.tasks.runner import fail_stale_tasks, run_turn
from app.tools.registry import assert_projection_budget, production_registry

_TASK_ID = re.compile(r"^[0-9a-f]{32}$")


def create_app(settings: Settings | None = None, complete=None, probe=None, env_file=None) -> FastAPI:
    settings = settings or load_settings()
    if complete is None:
        if not settings.llm_api_key:
            raise RuntimeError("LLM_API_KEY is required")
        complete = make_complete(settings)
    if probe is None:
        probe = probe_chat
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    repository = Repository(settings.data_dir / "app.sqlite")
    store = FileStore(settings.data_dir)
    fail_stale_tasks(repository, store, datetime.now(timezone.utc))
    registry = production_registry()
    assert_projection_budget(registry)
    graph = build_graph(registry, complete, system=load_system_prompt())
    app = FastAPI()
    app.state.repository = repository
    app.state.files = store
    app.state.settings = settings
    app.state.env_file = env_file
    workbench = Path(__file__).resolve().parents[2] / "frontend" / "index.html"

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/")
    def workbench_page():
        return FileResponse(workbench)

    @app.post("/api/conversations")
    async def create_conversation(request: Request):
        raw = await request.body()
        body = None
        if raw:
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                return JSONResponse(error_payload("invalid_input"), status_code=400)
        try:
            parse_create_conversation(body)
        except RequestError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        return JSONResponse({"conversation_id": repository.create_conversation()}, status_code=201)

    @app.post("/api/conversations/{conversation_id}/messages")
    async def create_message(conversation_id: str, request: Request):
        if _TASK_ID.fullmatch(conversation_id) is None:
            return JSONResponse(error_payload("not_found"), status_code=404)
        try:
            body = json.loads(await request.body() or b"null")
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        try:
            content = parse_message(body)
            task = repository.submit_message(conversation_id, content)
        except RequestError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except NotFoundError:
            return JSONResponse(error_payload("not_found"), status_code=404)
        except ConflictError:
            return JSONResponse(error_payload("conflict"), status_code=409)
        threading.Thread(
            target=run_turn,
            args=(repository, store, graph, task.id),
            daemon=True,
        ).start()
        return JSONResponse(
            {"conversation_id": conversation_id, "task_id": task.id, "status": "pending"},
            status_code=202,
        )

    @app.get("/api/conversations/{conversation_id}")
    def read_conversation(conversation_id: str):
        if _TASK_ID.fullmatch(conversation_id) is None:
            return JSONResponse(error_payload("not_found"), status_code=404)
        tasks = repository.list_conversation_tasks(conversation_id)
        if tasks is None:
            return JSONResponse(error_payload("not_found"), status_code=404)
        return conversation_payload(conversation_id, tasks)

    @app.get("/api/tasks/{task_id}")
    def read_task(task_id: str):
        if _TASK_ID.fullmatch(task_id) is None:
            return JSONResponse(error_payload("not_found"), status_code=404)
        task = repository.get_task(task_id)
        if task is None:
            return JSONResponse(error_payload("not_found"), status_code=404)
        return task_payload(repository, task)

    @app.post("/api/llm/probe")
    async def probe_model(request: Request):
        try:
            body = json.loads(await request.body() or b"null")
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        try:
            parsed = parse_probe(body)
        except RequestError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        if parsed["source"] == "local":
            current = process_llm()
            base_url = current["base_url"]
            api_key = current["api_key"]
            model = current["model"]
            timeout = min(settings.llm_timeout_seconds, 15)
        else:
            file_values = dotenv_llm(app.state.env_file)
            base_url = parsed.get("base_url", file_values["base_url"])
            model = parsed.get("model", file_values["model"])
            api_key = parsed.get("api_key", file_values["api_key"])
            timeout = 15
        if not base_url or not api_key or not model:
            return {"reachable": False}
        reachable = await asyncio.to_thread(probe, base_url, api_key, model, timeout)
        return {"reachable": bool(reachable)}

    @app.get("/api/llm/config")
    def llm_config():
        environment = process_llm()
        dotenv = dotenv_llm(app.state.env_file)
        return {
            "environment": _public_llm(environment),
            "dotenv": _public_llm(dotenv),
        }

    def preview(artifact_id: str, version: int, relative_path: str = ""):
        result = load_preview(store, artifact_id, version, relative_path)
        if result.status != 200:
            return JSONResponse(error_payload("not_found"), status_code=404)
        return Response(content=result.body, headers=result.headers)

    app.add_api_route(
        "/api/artifacts/{artifact_id}/versions/{version}/preview/",
        preview,
        methods=["GET"],
    )
    app.add_api_route(
        "/api/artifacts/{artifact_id}/versions/{version}/preview/{relative_path:path}",
        preview,
        methods=["GET"],
    )
    return app


def main() -> None:
    load_env_file()
    uvicorn.run(create_app(), host="127.0.0.1", port=8000)


def _public_llm(values: dict[str, str]) -> dict:
    return {
        "base_url": values["base_url"],
        "model": values["model"],
        "has_api_key": bool(values["api_key"]),
    }


if __name__ == "__main__":
    main()
