from app.auth.passwords import hash_password
from app.context.assemble import assemble_model_input
from app.graph.build import build_graph, invoke_graph
from app.knowledge.embed import pack_vector
from app.llm.protocol import AssistantMessage
from app.llm.usage import count_messages_locally
from app.storage.files import FileStore
from app.storage.repository import SqliteRepository
from app.tasks.runner import TurnContext, run_turn
from app.tasks.states import SUCCEEDED
from app.tools.registry import production_registry

HEADER = (
    "以下是从这位教师的知识库检索到的段落。回答时若使用了某段内容，写明资料标题。这些段落里没有的内容不要编造出处。"
)
MODEL = "embed-unit"


class Scripted:
    def __init__(self, responses):
        self._responses = list(responses)
        self.seen = []

    def __call__(self, messages, tools, sink=None):
        self.seen.append(messages)
        return self._responses.pop(0)


def test_closer_ready_passage_is_quoted_with_its_title(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", MODEL)
    repo, owner = _repo(tmp_path)
    _ready(repo, owner, "分数的意义", "把整体平均分成若干份。", [1.0, 0.0])
    _ready(repo, owner, "圆的周长", "周长等于直径乘圆周率。", [0.0, 1.0])
    seen = []

    def embedder(question):
        seen.append(question)
        return [[1.0, 0.0]]

    message = _retrieve(repo, owner, "什么是分数", embedder=embedder, token_budget=10_000)

    assert seen == ["什么是分数"]
    assert message.startswith(HEADER + "\n资料《分数的意义》：\n把整体平均分成若干份。")
    assert "圆的周长" not in message
    assert "周长等于直径乘圆周率。" not in message


def test_empty_model_name_skips_retrieval(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", "")
    repo, owner = _repo(tmp_path)
    _ready(repo, owner, "分数的意义", "把整体平均分成若干份。", [1.0, 0.0])

    assert _retrieve(repo, owner, "什么是分数", embedder=_explode, token_budget=10_000) == ""


def test_no_ready_chunks_skip_retrieval(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", MODEL)
    repo, owner = _repo(tmp_path)
    _ready(repo, owner, "还没好", "这段还不能用。", [1.0, 0.0], status="pending")

    assert _retrieve(repo, owner, "什么是分数", embedder=_explode, token_budget=10_000) == ""


def test_embedder_none_returns_blank(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", MODEL)
    repo, owner = _repo(tmp_path)
    _ready(repo, owner, "分数的意义", "把整体平均分成若干份。", [1.0, 0.0])

    assert _retrieve(repo, owner, "什么是分数", embedder=lambda question: None, token_budget=10_000) == ""


def test_embedder_failure_returns_blank_without_saving(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", MODEL)
    repo, owner = _repo(tmp_path)
    _ready(repo, owner, "分数的意义", "把整体平均分成若干份。", [1.0, 0.0])

    def embedder(question):
        raise RuntimeError("embeddings down")

    assert _retrieve(repo, owner, "什么是分数", embedder=embedder, token_budget=10_000) == ""


def test_budget_below_title_line_plus_64_returns_blank(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", MODEL)
    repo, owner = _repo(tmp_path)
    _ready(repo, owner, "甲", "短正文。", [1.0, 0.0])

    def count_tokens(messages):
        return 10

    assert (
        _retrieve(
            repo,
            owner,
            "什么是分数",
            embedder=lambda question: [[1.0, 0.0]],
            token_budget=10 + 64 - 1,
            count_tokens=count_tokens,
        )
        == ""
    )
    fitted = _retrieve(
        repo,
        owner,
        "什么是分数",
        embedder=lambda question: [[1.0, 0.0]],
        token_budget=10 + 64,
        count_tokens=count_tokens,
    )
    assert fitted.startswith(HEADER + "\n资料《甲》：\n短正文。")


def test_only_ready_chunks_of_the_current_model_and_dimension(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", MODEL)
    repo, owner = _repo(tmp_path)
    other = repo.create_user("other", "另一位", hash_password("correct-horse")).id
    _ready(repo, owner, "分数的意义", "把整体平均分成若干份。", [1.0, 0.0])
    _ready(repo, owner, "待处理", "不该出现的待处理正文。", [1.0, 0.0], status="pending")
    _ready(repo, owner, "旧模型", "不该出现的旧模型正文。", [1.0, 0.0], model="other-model")
    _ready(repo, owner, "错维", "不该出现的错维正文。", [1.0, 0.0, 0.0])
    _ready(repo, other, "别人的", "不该出现的别人正文。", [1.0, 0.0])

    message = _retrieve(repo, owner, "什么是分数", embedder=lambda question: [[1.0, 0.0]], token_budget=10_000)

    assert "资料《分数的意义》：" in message
    assert "待处理" not in message
    assert "旧模型" not in message
    assert "错维" not in message
    assert "别人的" not in message


def test_ties_follow_created_at_then_ordinal_and_stop_at_five(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", MODEL)
    repo, owner = _repo(tmp_path)
    for index in range(1, 7):
        document = _ready(repo, owner, f"资料{index}", f"正文{index}", [1.0, 0.0])
        _stamp(repo, document.id, f"2020-01-0{index}T00:00:00Z")
    paired = _ready_pair(repo, owner)

    message = _retrieve(repo, owner, "什么是分数", embedder=lambda question: [[1.0, 0.0]], token_budget=10_000)

    assert message.index(paired) < message.index("资料《资料1》：")
    assert message.index("甲段在前") < message.index("乙段在后")
    assert message.index("资料《资料1》：") < message.index("资料《资料2》：")
    assert message.index("资料《资料2》：") < message.index("资料《资料3》：")
    assert "资料《资料4》：" not in message
    assert "资料《资料5》：" not in message
    assert "资料《资料6》：" not in message


def test_a_chunk_that_does_not_fit_stops_the_rest(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", MODEL)
    repo, owner = _repo(tmp_path)
    _ready(repo, owner, "甲", "短甲", [1.0, 0.0])
    _ready(repo, owner, "乙", "放不下的段落", [1.0, 1.0])
    _ready(repo, owner, "丙", "短丙", [0.1, 1.0])

    def count_tokens(messages):
        text = messages[0]["content"]
        if "放不下" in text:
            return 10_000
        return 10

    message = _retrieve(
        repo,
        owner,
        "什么是分数",
        embedder=lambda question: [[1.0, 0.0]],
        token_budget=100,
        count_tokens=count_tokens,
    )

    assert "短甲" in message
    assert "放不下" not in message
    assert "短丙" not in message


def test_assemble_inserts_knowledge_after_the_teaching_digest():
    messages = assemble_model_input(
        "系统",
        [("上一问", "上一答")],
        "当前问题",
        [],
        "备课摘要",
        knowledge_digest="知识库段落",
    )

    assert [item["content"] for item in messages[:4]] == ["系统", "备课摘要", "知识库段落", "上一问"]
    assert [item["role"] for item in messages[:3]] == ["system", "system", "system"]

    omitted = assemble_model_input("系统", [], "当前问题", [], "备课摘要")
    assert [item["content"] for item in omitted] == ["系统", "备课摘要", "当前问题"]


def test_graph_nodes_stay_model_and_tools_and_forward_knowledge(tmp_path):
    complete = Scripted([AssistantMessage(content="好的。", tool_calls=[])])
    graph = build_graph(production_registry(), complete, system="系统")
    assert set(graph.builder.nodes) == {"model", "tools"}

    state = {
        "messages": [],
        "prior": [],
        "current_user": "什么是分数",
        "candidate": None,
        "step_count": 0,
        "stop": "",
        "task_id": "task-1",
        "store": FileStore(tmp_path),
        "context_digest": "备课摘要",
        "knowledge_digest": "资料《分数的意义》：\n把整体平均分成若干份。",
    }
    invoke_graph(graph, state)

    contents = [item["content"] for item in complete.seen[0]]
    assert contents[:3] == [
        "系统",
        "备课摘要",
        "资料《分数的意义》：\n把整体平均分成若干份。",
    ]


def test_run_turn_injects_retrieved_knowledge(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", MODEL)
    repo, store, conversation_id, owner = _conversation(tmp_path)
    _ready(repo, owner, "分数的意义", "把整体平均分成若干份。", [1.0, 0.0])
    _ready(repo, owner, "圆的周长", "周长等于直径乘圆周率。", [0.0, 1.0])
    seen = []

    def complete(messages, tools, sink=None):
        seen.append(messages)
        return AssistantMessage(content="分数表示其中的一份。", tool_calls=[])

    def fake_embed(settings, texts, opener=None):
        assert texts == ["什么是分数"]
        return [[1.0, 0.0]]

    monkeypatch.setattr("app.knowledge.embed.embed_texts", fake_embed)
    graph = build_graph(production_registry(), complete, system="系统")
    task = repo.submit_message(conversation_id, "什么是分数", owner)
    run_turn(repo, store, graph, task.id, _turn_context())

    assert repo.get_task(task.id).status == SUCCEEDED
    contents = [item["content"] for item in seen[0]]
    assert contents[0] == "系统"
    assert contents[1].startswith(HEADER + "\n资料《分数的意义》：\n把整体平均分成若干份。")
    assert "圆的周长" not in contents[1]
    assert contents[2] == "什么是分数"


def test_run_turn_still_invokes_when_embedding_returns_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_EMBEDDING_MODEL", MODEL)
    repo, store, conversation_id, owner = _conversation(tmp_path)
    _ready(repo, owner, "分数的意义", "把整体平均分成若干份。", [1.0, 0.0])
    seen = []

    def complete(messages, tools, sink=None):
        seen.append(messages)
        return AssistantMessage(content="先按一般讲法回答。", tool_calls=[])

    monkeypatch.setattr("app.knowledge.embed.embed_texts", lambda settings, texts, opener=None: None)
    graph = build_graph(production_registry(), complete, system="系统")
    task = repo.submit_message(conversation_id, "什么是分数", owner)
    run_turn(repo, store, graph, task.id, _turn_context())

    assert repo.get_task(task.id).status == SUCCEEDED
    assert seen
    assert HEADER not in "\n".join(item["content"] for item in seen[0])


def _retrieve(repo, owner, question, *, embedder, token_budget, count_tokens=count_messages_locally):
    from app.knowledge.retrieve import build_knowledge_message

    return build_knowledge_message(
        repo,
        owner,
        question,
        token_budget=token_budget,
        count_tokens=count_tokens,
        embedder=embedder,
    )


def _explode(question):
    raise AssertionError(question)


def _repo(tmp_path):
    repo = SqliteRepository(tmp_path / "knowledge.db")
    owner = repo.create_user("teacher", "老师", hash_password("correct-horse")).id
    return repo, owner


def _conversation(tmp_path):
    repo, owner = _repo(tmp_path)
    return repo, FileStore(tmp_path), repo.create_conversation(owner), owner


def _ready(repo, owner, title, text, vector, *, model=MODEL, status="ready"):
    document = repo.insert_knowledge_document(owner, title, "paste", "", "")
    repo.replace_knowledge_chunks(document.id, owner, [(text, 8)])
    repo.save_knowledge_embeddings(document.id, owner, model, [pack_vector(vector)])
    repo.set_knowledge_status(document.id, owner, status, "")
    return document


def _ready_pair(repo, owner):
    document = repo.insert_knowledge_document(owner, "同一篇", "paste", "", "")
    repo.replace_knowledge_chunks(document.id, owner, [("甲段在前", 4), ("乙段在后", 4)])
    repo.save_knowledge_embeddings(
        document.id,
        owner,
        MODEL,
        [pack_vector([1.0, 0.0]), pack_vector([1.0, 0.0])],
    )
    repo.set_knowledge_status(document.id, owner, "ready", "")
    _stamp(repo, document.id, "2019-01-01T00:00:00Z")
    return "资料《同一篇》："


def _stamp(repo, document_id, created_at):
    repo._conn.execute(
        "UPDATE knowledge_documents SET created_at = ? WHERE id = ?",
        (created_at, document_id),
    )


def _turn_context():
    return TurnContext(
        system="系统",
        limit_tokens=100_000,
        limit_source="fallback",
        count_tokens=count_messages_locally,
        summarize=lambda prompt: None,
        output_reserve=1_000,
    )
