import threading

from app.api.errors import error_body
from app.llm.hub import hub


def setup_function():
    hub.clear()


def test_late_subscriber_gets_the_text_so_far_then_new_deltas():
    hub.open("task-1")
    hub.sink("task-1").delta("你")
    hub.sink("task-1").delta("好")
    seen = []
    started = threading.Event()

    def listen():
        for event, data in hub.listen("task-1"):
            seen.append((event, data))
            started.set()
            if event in {"done", "error"}:
                return

    thread = threading.Thread(target=listen)
    thread.start()
    assert started.wait(1)
    hub.sink("task-1").delta("呀")
    hub.succeed("task-1")
    thread.join(2)

    assert seen == [
        ("snapshot", {"text": "你好"}),
        ("delta", {"text": "呀"}),
        ("done", {}),
    ]
    assert hub.sink("task-1") is None


def test_failure_notifies_subscribers_and_drops_the_buffer():
    hub.open("task-2")
    hub.sink("task-2").delta("半")
    seen = []
    started = threading.Event()

    def listen():
        for event, data in hub.listen("task-2"):
            seen.append((event, data))
            started.set()

    thread = threading.Thread(target=listen)
    thread.start()
    assert started.wait(1)
    error = error_body("model_timeout")
    hub.fail("task-2", error)
    thread.join(2)

    assert seen == [("snapshot", {"text": "半"}), ("error", error)]
    assert hub.listen("task-2") is None


def test_reset_clears_the_buffer_for_a_later_subscriber():
    hub.open("task-3")
    sink = hub.sink("task-3")
    sink.delta("旧")
    sink.reset()
    sink.delta("新")
    listener = hub.listen("task-3")
    assert next(listener) == ("snapshot", {"text": "新"})
    listener.close()
    hub.succeed("task-3")
