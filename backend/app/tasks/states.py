"""任务对外状态。全项目只在这里定义这四个值。"""

PENDING = "pending"
RUNNING = "running"
SUCCEEDED = "succeeded"
FAILED = "failed"

STATUSES = (PENDING, RUNNING, SUCCEEDED, FAILED)

_ALLOWED = {
    PENDING: {RUNNING, FAILED},
    RUNNING: {SUCCEEDED, FAILED},
    SUCCEEDED: set(),
    FAILED: set(),
}


def transition(current: str, new: str) -> str:
    if current not in _ALLOWED or new not in _ALLOWED[current]:
        raise ValueError(f"cannot transition from {current} to {new}")
    return new
