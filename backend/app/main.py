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

from app.api.auth import (
    CREDENTIALS_MESSAGE,
    RESERVED_USERNAME,
    parse_login,
    parse_register,
    parse_resume,
)
from app.api.errors import error_payload
from app.api.goals import (
    GoalRequestError,
    node_view,
    parse_create_node,
    parse_create_tree,
    parse_grade_filter,
    parse_reorder,
    parse_update_node,
    parse_update_tree,
    tree_view,
)
from app.api.messages import RequestError, parse_create_conversation, parse_message
from app.api.probe import parse_probe
from app.api.teaching import (
    parse_create_assignment,
    parse_create_class,
    parse_create_document,
    parse_create_point,
)
from app.api.views import conversation_payload, task_payload
from app.auth.passwords import burn_password_check, hash_password, verify_password
from app.auth.remember import hash_remember_token, issue_remember_token, remember_expiry, remember_now
from app.auth.sessions import (
    COOKIE_MAX_AGE,
    COOKIE_NAME,
    parse_cookie,
    resolve_user,
    session_expiry,
    sign_cookie,
)
from app.config import Settings, dotenv_llm, load_env_file, load_settings, process_llm
from app.context.prompt import load_system_prompt
from app.goals.templates import semester_seed
from app.graph.build import build_graph
from app.llm.complete import make_complete
from app.llm.probe import probe_chat
from app.preview.serve import load_preview
from app.storage import open_repository
from app.storage.files import FileStore
from app.storage.protocol import ConflictError, InputError, NotFoundError, User
from app.tasks.runner import fail_stale_tasks, run_turn
from app.teaching.digest import build_digest
from app.teaching.insights import teaching_insights
from app.tools.registry import assert_projection_budget, production_registry

_TASK_ID = re.compile(r"^[0-9a-f]{32}$")


def create_app(settings: Settings | None = None, complete=None, probe=None, env_file=None) -> FastAPI:
    settings = settings or load_settings()
    auth_secret = settings.auth_secret.strip()
    if len(auth_secret) < 16:
        raise RuntimeError("AUTH_SECRET must be at least 16 characters")
    if complete is None:
        if not settings.llm_api_key:
            raise RuntimeError("LLM_API_KEY is required")
        complete = make_complete(settings)
    if probe is None:
        probe = probe_chat
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    repository = open_repository(settings)
    store = FileStore(settings.data_dir)
    fail_stale_tasks(repository, store, datetime.now(timezone.utc))
    registry = production_registry()
    assert_projection_budget(registry)
    system_prompt = load_system_prompt()
    graph = build_graph(registry, complete, system=system_prompt)
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

    def require_user(request: Request):
        user = resolve_user(repository, request.cookies.get(COOKIE_NAME), auth_secret)
        if user is None:
            return None, JSONResponse(error_payload("unauthenticated"), status_code=401)
        return user, None

    def issue_session(user: User, extra: dict | None = None) -> JSONResponse:
        expires_at, expires_unix = session_expiry()
        session = repository.create_session(user.id, expires_at)
        body = _public_user(user)
        if extra:
            body.update(extra)
        response = JSONResponse(body, status_code=200)
        response.set_cookie(
            key=COOKIE_NAME,
            value=sign_cookie(session.id, expires_unix, auth_secret),
            max_age=COOKIE_MAX_AGE,
            httponly=True,
            samesite="lax",
            path="/",
            secure=False,
        )
        return response

    def issue_remembered_session(user: User) -> JSONResponse:
        """签发会话 Cookie，并附带一枚新的记住此设备令牌。"""
        raw, digest = issue_remember_token()
        repository.create_remember_token(digest, user.id, remember_expiry())
        return issue_session(user, {"remember_token": raw})

    @app.post("/api/auth/register")
    async def register(request: Request):
        try:
            body = json.loads(await request.body() or b"null")
            username, password, display_name = parse_register(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except RequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        if username == RESERVED_USERNAME:
            return JSONResponse(error_payload("conflict", "这个用户名已经有人使用。"), status_code=409)
        try:
            user = repository.create_user(username, display_name, hash_password(password))
        except ConflictError:
            return JSONResponse(error_payload("conflict", "这个用户名已经有人使用。"), status_code=409)
        response = issue_remembered_session(user)
        response.status_code = 201
        return response

    @app.post("/api/auth/login")
    async def login(request: Request):
        try:
            body = json.loads(await request.body() or b"null")
            username, password = parse_login(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except RequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        user = repository.get_user_by_username(username)
        if user is None:
            burn_password_check(password)
            return JSONResponse(error_payload("invalid_input", CREDENTIALS_MESSAGE), status_code=400)
        if not verify_password(password, user.password_hash):
            return JSONResponse(error_payload("invalid_input", CREDENTIALS_MESSAGE), status_code=400)
        return issue_remembered_session(user)

    @app.post("/api/auth/resume")
    async def resume(request: Request):
        """免密恢复：用记住此设备的令牌换新会话。令牌轮换，旧令牌立即作废。"""
        try:
            body = json.loads(await request.body() or b"null")
            token = parse_resume(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except RequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        digest = hash_remember_token(token)
        user_id = repository.user_id_for_remember_token(digest, remember_now())
        user = repository.get_user(user_id) if user_id else None
        if user is None:
            if user_id:
                repository.delete_remember_token(digest)
            return JSONResponse(error_payload("unauthenticated"), status_code=401)
        repository.delete_remember_token(digest)
        return issue_remembered_session(user)

    @app.post("/api/auth/logout")
    def logout(request: Request):
        user, _denied = require_user(request)
        parsed = parse_cookie(request.cookies.get(COOKIE_NAME, ""), auth_secret)
        if user is not None and parsed is not None:
            repository.delete_session(parsed[0])
            response = Response(status_code=204)
        else:
            response = JSONResponse(error_payload("unauthenticated"), status_code=401)
        response.delete_cookie(COOKIE_NAME, path="/")
        return response

    @app.get("/api/auth/me")
    def read_me(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        return _public_user(user)

    @app.get("/api/conversations")
    def list_conversations(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        conversations = repository.list_conversations(user.id)
        return {
            "conversations": [
                {
                    "conversation_id": item.conversation_id,
                    "title": item.title,
                    "created_at": item.created_at,
                }
                for item in conversations
            ]
        }

    @app.post("/api/conversations")
    async def create_conversation(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
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
        return JSONResponse({"conversation_id": repository.create_conversation(user.id)}, status_code=201)

    @app.post("/api/conversations/{conversation_id}/messages")
    async def create_message(conversation_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        if _TASK_ID.fullmatch(conversation_id) is None:
            return JSONResponse(error_payload("not_found"), status_code=404)
        try:
            body = json.loads(await request.body() or b"null")
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        try:
            content, llm_source = parse_message(body)
        except RequestError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        turn_graph = graph
        if llm_source is not None:
            values = _llm_values_for_source(llm_source, app.state.env_file)
            if values is None:
                return JSONResponse(error_payload("invalid_input"), status_code=400)
            turn_settings = Settings(
                data_dir=settings.data_dir,
                llm_base_url=values["base_url"],
                llm_api_key=values["api_key"],
                llm_model=values["model"],
                llm_timeout_seconds=settings.llm_timeout_seconds,
                auth_secret=settings.auth_secret,
                auth_admin_password=settings.auth_admin_password,
            )
            turn_graph = build_graph(registry, make_complete(turn_settings), system=system_prompt)
        try:
            task = repository.submit_message(conversation_id, content, user.id)
        except NotFoundError:
            return JSONResponse(error_payload("not_found"), status_code=404)
        except ConflictError:
            return JSONResponse(error_payload("conflict"), status_code=409)
        threading.Thread(
            target=run_turn,
            args=(repository, store, turn_graph, task.id),
            daemon=True,
        ).start()
        return JSONResponse(
            {"conversation_id": conversation_id, "task_id": task.id, "status": "pending"},
            status_code=202,
        )

    @app.get("/api/conversations/{conversation_id}")
    def read_conversation(conversation_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        if _TASK_ID.fullmatch(conversation_id) is None:
            return JSONResponse(error_payload("not_found"), status_code=404)
        tasks = repository.list_conversation_tasks(conversation_id, user.id)
        if tasks is None:
            return JSONResponse(error_payload("not_found"), status_code=404)
        return conversation_payload(conversation_id, tasks)

    @app.get("/api/tasks/{task_id}")
    def read_task(task_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        if _TASK_ID.fullmatch(task_id) is None:
            return JSONResponse(error_payload("not_found"), status_code=404)
        task = repository.get_task_for_owner(task_id, user.id)
        if task is None:
            return JSONResponse(error_payload("not_found"), status_code=404)
        return task_payload(repository, task)

    @app.post("/api/llm/probe")
    async def probe_model(request: Request):
        _user, denied = require_user(request)
        if denied is not None:
            return denied
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
    def llm_config(request: Request):
        _user, denied = require_user(request)
        if denied is not None:
            return denied
        environment = process_llm()
        dotenv = dotenv_llm(app.state.env_file)
        return {
            "environment": _public_llm(environment),
            "dotenv": _public_llm(dotenv),
        }

    @app.get("/api/goal-trees")
    def list_goal_trees(
        request: Request,
        subject: str | None = None,
        grade: str | None = None,
        term: str | None = None,
    ):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            grade_filter = parse_grade_filter(grade)
        except GoalRequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        trees = repository.list_goal_trees(user.id, subject=subject, grade=grade_filter, term=term)
        return {"trees": [tree_view(t) for t in trees]}

    @app.post("/api/goal-trees")
    async def create_goal_tree(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            subject, grade, term, title, template_init = parse_create_tree(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except GoalRequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        tree = repository.create_goal_tree(user.id, subject, grade, term, title)
        if template_init:
            for seed in semester_seed(subject):
                repository.create_goal_node(
                    tree.id, user.id, None, "semester",
                    seed["title"], seed["description"], [], seed["verify_criteria"],
                )
        return JSONResponse(tree_view(tree), status_code=201)

    @app.get("/api/goal-trees/{tree_id}")
    def read_goal_tree(tree_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        tree = repository.get_goal_tree_for_owner(tree_id, user.id)
        if tree is None:
            return JSONResponse(error_payload("not_found", "没有找到这份目标树。"), status_code=404)
        nodes = repository.list_goal_nodes(tree_id, user.id) or []
        return {"tree": tree_view(tree), "nodes": [node_view(n) for n in nodes]}

    @app.patch("/api/goal-trees/{tree_id}")
    async def update_goal_tree(tree_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            title = parse_update_tree(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except GoalRequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        tree = repository.rename_goal_tree(tree_id, user.id, title)
        if tree is None:
            return JSONResponse(error_payload("not_found", "没有找到这份目标树。"), status_code=404)
        return tree_view(tree)

    @app.delete("/api/goal-trees/{tree_id}")
    def delete_goal_tree(tree_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        if not repository.delete_goal_tree(tree_id, user.id):
            return JSONResponse(error_payload("not_found", "没有找到这份目标树。"), status_code=404)
        return Response(status_code=204)

    @app.post("/api/goal-trees/{tree_id}/nodes")
    async def create_goal_node(tree_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            fields = parse_create_node(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except GoalRequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        try:
            node = repository.create_goal_node(tree_id, user.id, **fields)
        except NotFoundError:
            return JSONResponse(error_payload("not_found", "没有找到这份目标树或上级目标。"), status_code=404)
        except InputError as exc:
            return JSONResponse(error_payload("invalid_input", _goal_rule_message(exc)), status_code=400)
        except ConflictError:
            return JSONResponse(error_payload("conflict", "这一层的目标数量已达上限。"), status_code=409)
        return JSONResponse(node_view(node), status_code=201)

    @app.patch("/api/goal-nodes/{node_id}")
    async def update_goal_node(node_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            fields = parse_update_node(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except GoalRequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        node = repository.update_goal_node(node_id, user.id, **fields)
        if node is None:
            return JSONResponse(error_payload("not_found", "没有找到这条目标。"), status_code=404)
        return node_view(node)

    @app.delete("/api/goal-nodes/{node_id}")
    def delete_goal_node(node_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            repository.delete_goal_node(node_id, user.id)
        except NotFoundError:
            return JSONResponse(error_payload("not_found", "没有找到这条目标。"), status_code=404)
        except ConflictError:
            return JSONResponse(error_payload("conflict", "先删除或移走这条目标下的子目标。"), status_code=409)
        return Response(status_code=204)

    @app.post("/api/goal-nodes/{node_id}/reorder")
    async def reorder_goal_node(node_id: str, request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            direction = parse_reorder(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except GoalRequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        try:
            repository.reorder_goal_node(node_id, user.id, direction)
        except NotFoundError:
            return JSONResponse(error_payload("not_found", "没有找到这条目标。"), status_code=404)
        except InputError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        return {"ok": True}

    @app.get("/api/teaching/overview")
    def teaching_overview(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        data = repository.load_teaching(user.id)
        return {
            "classes": [
                {
                    "class_id": item.id,
                    "name": item.name,
                    "created_at": item.created_at,
                    "students": [student.name for student in data.students if student.class_id == item.id],
                }
                for item in data.classes
            ],
            "knowledge_points": [
                {
                    "point_id": item.id,
                    "name": item.name,
                    "description": item.description,
                    "prerequisites": list(item.prerequisites),
                }
                for item in data.knowledge_points
            ],
            "assignments": [
                {
                    "assignment_id": item.id,
                    "class_id": item.class_id,
                    "title": item.title,
                    "kind": item.kind,
                    "created_at": item.created_at,
                }
                for item in data.assignments
            ],
            "documents": [
                {
                    "document_id": item.id,
                    "doc_type": item.doc_type,
                    "title": item.title,
                    "created_at": item.created_at,
                }
                for item in data.documents
            ],
        }

    @app.get("/api/teaching/insights")
    def teaching_insights_view(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        return teaching_insights(repository.load_teaching(user.id))

    @app.post("/api/teaching/classes")
    async def create_teaching_class(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            name, students = parse_create_class(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except RequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        try:
            class_id = repository.create_class(user.id, name, students)
        except ConflictError:
            return JSONResponse(error_payload("conflict", "这个班级名已经存在。"), status_code=409)
        return JSONResponse({"class_id": class_id}, status_code=201)

    @app.post("/api/teaching/points")
    async def create_teaching_point(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            name, description, prerequisites = parse_create_point(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except RequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        try:
            point_id = repository.create_knowledge_point(user.id, name, description, prerequisites)
        except ConflictError:
            return JSONResponse(error_payload("conflict", "这个知识点名称已经存在。"), status_code=409)
        return JSONResponse({"point_id": point_id}, status_code=201)

    @app.post("/api/teaching/assignments")
    async def create_teaching_assignment(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            assignment = parse_create_assignment(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except RequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        try:
            assignment_id = repository.create_assignment(user.id, assignment)
        except NotFoundError:
            return JSONResponse(error_payload("not_found"), status_code=404)
        return JSONResponse({"assignment_id": assignment_id}, status_code=201)

    @app.post("/api/teaching/documents")
    async def create_teaching_document(request: Request):
        user, denied = require_user(request)
        if denied is not None:
            return denied
        try:
            body = json.loads(await request.body() or b"null")
            doc_type, title, content = parse_create_document(body)
        except json.JSONDecodeError:
            return JSONResponse(error_payload("invalid_input"), status_code=400)
        except RequestError as exc:
            return JSONResponse(error_payload("invalid_input", exc.public_message), status_code=400)
        document_id = repository.create_document(user.id, doc_type, title, content)
        return JSONResponse({"document_id": document_id}, status_code=201)

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


def _public_user(user: User) -> dict:
    return {"user_id": user.id, "username": user.username, "display_name": user.display_name}


def _public_llm(values: dict[str, str]) -> dict:
    return {
        "base_url": values["base_url"],
        "model": values["model"],
        "has_api_key": bool(values["api_key"]),
    }


def _llm_values_for_source(source: str, env_file: Path | None) -> dict[str, str] | None:
    values = process_llm() if source == "local" else dotenv_llm(env_file)
    if not values["base_url"] or not values["api_key"] or not values["model"]:
        return None
    return values


_GOAL_RULE_MESSAGES = {
    "root goal nodes must be semester or unit": "学期总目标和单元直接挂在根上，课时目标需要挂在单元下。",
    "lesson nodes can only sit under a unit": "课时目标只能挂在单元下。",
    "invalid goal level": "目标层级不合法。",
}


def _goal_rule_message(exc: InputError) -> str:
    return _GOAL_RULE_MESSAGES.get(str(exc), "目标层级或位置不合法。")


if __name__ == "__main__":
    main()
