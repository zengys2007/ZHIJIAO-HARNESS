"""error.code / message / retryable 的唯一定义。"""

ERRORS: dict[str, tuple[str, bool]] = {
    "invalid_input": ("请把这句话写成 1 到 4000 字后再发送。", False),
    "not_found": ("没有找到这个会话或任务。", False),
    "conflict": ("上一条还在处理，请等它结束再发送。", False),
    "step_limit": ("这次尝试次数已用完，还没有回复，可以再发一次。", True),
    "model_timeout": ("模型响应超时，可以再发一次。", True),
    "model_invalid_output": ("模型没有返回可用回复，可以再发一次。", True),
    "model_upstream": ("模型服务暂时不可用，可以再发一次。", True),
    "interrupted": ("这次处理被中断了，可以再发一次。", True),
    "storage_failed": ("回复没有保存成功，可以再发一次。", True),
    "internal": ("系统出错了，可以再发一次。", True),
}


def error_body(code: str, message: str | None = None) -> dict:
    text, retryable = ERRORS[code]
    return {"code": code, "message": message if message is not None else text, "retryable": retryable}


def error_payload(code: str, message: str | None = None) -> dict:
    return {"error": error_body(code, message)}
