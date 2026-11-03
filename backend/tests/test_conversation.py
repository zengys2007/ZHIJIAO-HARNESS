from app.context.assemble import assemble_model_input
from app.graph.build import build_graph
from app.llm.protocol import AssistantMessage
from app.storage.files import FileStore
from app.auth.passwords import hash_password
from app.storage.repository import ConflictError, NotFoundError, SqliteRepository
from app.tasks.runner import run_turn
from app.tasks.states import FAILED, SUCCEEDED
from app.tools.registry import production_registry


class Scripted:
    def __init__(self, replies):
        self._replies = list(replies)
        self.seen = []

    def __call__(self, messages, tools, sink=None):
        self.seen.append((messages, tools))
        text = self._replies.pop(0)
        return AssistantMessage(content=text, tool_calls=[])


def test_second_turn_includes_the_first_successful_exchange(tmp_path):
    repo, store, conversation_id, owner_id = _conversation(tmp_path)
    first = Scripted(["先用同一块饼说明。"])
    graph = build_graph(production_registry(), first, system="你是教师的助手。")
    first_task = repo.submit_message(conversation_id, "怎么讲通分", owner_id)
    run_turn(repo, store, graph, first_task.id)

    second = Scripted(["接着比较分子。"])
    graph = build_graph(production_registry(), second, system="你是教师的助手。")
    second_task = repo.submit_message(conversation_id, "下一步呢", owner_id)
    run_turn(repo, store, graph, second_task.id)

    sent = second.seen[0][0]
    assert sent[0]["role"] == "system"
    assert sent[1]["content"] == "怎么讲通分"
    assert sent[2]["content"] == "先用同一块饼说明。"
    assert sent[3]["content"] == "下一步呢"
    assert second.seen[0][1] is None
    assert repo.get_task(second_task.id).status == SUCCEEDED
    assert repo.get_task(second_task.id).reply == "接着比较分子。"


def test_failed_turn_is_left_out_of_the_next_model_input(tmp_path):
    repo, store, conversation_id, owner_id = _conversation(tmp_path)
    failed = Scripted([""])
    graph = build_graph(production_registry(), failed, system="你是教师的助手。")
    failed_task = repo.submit_message(conversation_id, "这句失败", owner_id)
    run_turn(repo, store, graph, failed_task.id)
    assert repo.get_task(failed_task.id).status == FAILED

    follow = Scripted(["可以换个例子。"])
    graph = build_graph(production_registry(), follow, system="你是教师的助手。")
    follow_task = repo.submit_message(conversation_id, "再试一次", owner_id)
    run_turn(repo, store, graph, follow_task.id)

    contents = [item["content"] for item in follow.seen[0][0]]
    assert "这句失败" not in contents
    assert contents[-1] == "再试一次"


def test_busy_conversation_rejects_a_second_message(tmp_path):
    repo, _store, conversation_id, owner_id = _conversation(tmp_path)
    repo.submit_message(conversation_id, "第一句", owner_id)
    try:
        repo.submit_message(conversation_id, "第二句", owner_id)
        raise AssertionError("expected conflict")
    except ConflictError:
        pass
    tasks = repo.list_conversation_tasks(conversation_id, owner_id)
    assert len(tasks) == 1


def test_missing_conversation_is_not_found(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    owner = repo.create_user("teacher", "老师", hash_password("correct-horse"))
    try:
        repo.submit_message("a" * 32, "你好", owner.id)
        raise AssertionError("expected not found")
    except NotFoundError:
        pass


def test_sidebar_title_stays_new_chat_until_the_first_round_succeeds(tmp_path):
    repo, store, conversation_id, owner_id = _conversation(tmp_path)
    assert _title(repo, owner_id) == "新对话"
    repo.save_plan_mode(conversation_id, owner_id, True)
    assert _title(repo, owner_id) == "新对话"

    pending = repo.submit_message(conversation_id, "还在进行", owner_id)
    assert _title(repo, owner_id) == "新对话"
    run_turn(
        repo,
        store,
        build_graph(production_registry(), Scripted([""]), system="你是教师的助手。"),
        pending.id,
    )
    assert repo.get_task(pending.id).status == FAILED
    assert _title(repo, owner_id) == "新对话"

    done = repo.submit_message(conversation_id, "一二三四五六七八九十一二三四五六七八九十\n第二行", owner_id)
    assert _title(repo, owner_id) == "新对话"
    run_turn(
        repo,
        store,
        build_graph(production_registry(), Scripted(["好"]), system="你是教师的助手。"),
        done.id,
    )
    assert _title(repo, owner_id) == "一二三四五六七八九十一二三四五六七八…"

    later = repo.submit_message(conversation_id, "下一轮不改标题", owner_id)
    run_turn(
        repo,
        store,
        build_graph(production_registry(), Scripted(["也好"]), system="你是教师的助手。"),
        later.id,
    )
    assert _title(repo, owner_id) == "一二三四五六七八九十一二三四五六七八…"


def _title(repo: SqliteRepository, owner_id: str) -> str:
    return repo.list_conversations(owner_id)[0].title


def test_assemble_keeps_prior_turns_and_places_the_summary_before_them():
    prior = [("旧" * 20, "答" * 20), ("新问题", "新回答")]
    messages = assemble_model_input("系统", prior, "当前问题", [], context_summary="交接摘要")
    contents = [item["content"] for item in messages]
    assert contents[1] == "交接摘要"
    assert "旧" * 20 in contents
    assert contents[-1] == "当前问题"


def _conversation(tmp_path):
    repo = SqliteRepository(tmp_path / "app.sqlite")
    owner = repo.create_user("teacher", "老师", hash_password("correct-horse"))
    store = FileStore(tmp_path)
    return repo, store, repo.create_conversation(owner.id), owner.id
