"""一轮回复的进程内正文缓冲。不写入数据库。"""

import json
import queue
import threading
import time

from app.api.errors import error_body
from app.tasks.states import FAILED, SUCCEEDED


class _Record:
    def __init__(self):
        self.text = ""
        self.subscribers: list[queue.Queue] = []


class _Sink:
    def __init__(self, owner: "StreamHub", task_id: str):
        self._owner = owner
        self._task_id = task_id

    def delta(self, text: str) -> None:
        self._owner.publish_delta(self._task_id, text)

    def reset(self) -> None:
        self._owner.publish_reset(self._task_id)


class StreamHub:
    def __init__(self):
        self._lock = threading.Lock()
        self._records: dict[str, _Record] = {}

    def clear(self) -> None:
        with self._lock:
            self._records.clear()

    def open(self, task_id: str) -> None:
        with self._lock:
            self._records.setdefault(task_id, _Record())

    def sink(self, task_id: str) -> _Sink | None:
        with self._lock:
            if task_id not in self._records:
                return None
        return _Sink(self, task_id)

    def publish_delta(self, task_id: str, text: str) -> None:
        if text == "":
            return
        with self._lock:
            record = self._records.get(task_id)
            if record is None:
                return
            record.text += text
            subscribers = list(record.subscribers)
        for subscriber in subscribers:
            subscriber.put(("delta", {"text": text}))

    def publish_reset(self, task_id: str) -> None:
        with self._lock:
            record = self._records.get(task_id)
            if record is None:
                return
            record.text = ""
            subscribers = list(record.subscribers)
        for subscriber in subscribers:
            subscriber.put(("reset", {}))

    def succeed(self, task_id: str) -> None:
        self._close(task_id, ("done", {}))

    def fail(self, task_id: str, error: dict) -> None:
        self._close(task_id, ("error", error))

    def listen(self, task_id: str):
        subscriber: queue.Queue = queue.Queue()
        with self._lock:
            record = self._records.get(task_id)
            if record is None:
                return None
            if record.text:
                subscriber.put(("snapshot", {"text": record.text}))
            record.subscribers.append(subscriber)

        def events():
            try:
                while True:
                    event, data = subscriber.get()
                    yield event, data
                    if event in {"done", "error"}:
                        return
            finally:
                with self._lock:
                    current = self._records.get(task_id)
                    if current is not None and subscriber in current.subscribers:
                        current.subscribers.remove(subscriber)

        return events()

    def iter_events(self, task_id: str, load_task):
        while True:
            task = load_task()
            if task is None:
                return
            if task.status == SUCCEEDED:
                yield "done", {}
                return
            if task.status == FAILED:
                yield "error", error_body(task.error_code or "internal", task.error_message)
                return
            live = self.listen(task_id)
            if live is None:
                time.sleep(0.02)
                continue
            for event, data in live:
                yield event, data
                if event in {"done", "error"}:
                    return
            return

    def _close(self, task_id: str, notice: tuple[str, dict]) -> None:
        with self._lock:
            record = self._records.pop(task_id, None)
            subscribers = list(record.subscribers) if record is not None else []
        for subscriber in subscribers:
            subscriber.put(notice)


def encode_sse(event: str, data: dict) -> bytes:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


hub = StreamHub()
