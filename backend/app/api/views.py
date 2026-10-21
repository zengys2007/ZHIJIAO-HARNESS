"""任务和会话的对外字段。"""

from app.api.errors import error_body
from app.storage.repository import Repository, Task
from app.tasks.states import FAILED, SUCCEEDED


def task_payload(repo: Repository, task: Task) -> dict:
    last = repo.last_event(task.id)
    error = None
    if task.status == FAILED and task.error_code:
        error = error_body(task.error_code, task.error_message)
    return {
        "task_id": task.id,
        "conversation_id": task.conversation_id,
        "status": task.status,
        "step_count": task.step_count,
        "last_event_type": last.type if last else None,
        "reply": task.reply if task.status == SUCCEEDED else None,
        "error": error,
    }


def conversation_payload(conversation_id: str, tasks: list[Task]) -> dict:
    messages = []
    for task in tasks:
        user = {
            "task_id": task.id,
            "role": "user",
            "content": task.raw_request,
            "status": task.status,
            "created_at": task.created_at,
        }
        if task.status == FAILED and task.error_code:
            user["error"] = error_body(task.error_code, task.error_message)
        messages.append(user)
        if task.status == SUCCEEDED:
            messages.append(
                {
                    "task_id": task.id,
                    "role": "assistant",
                    "content": task.reply,
                    "status": SUCCEEDED,
                    "created_at": task.updated_at,
                }
            )
    return {"conversation_id": conversation_id, "messages": messages}
