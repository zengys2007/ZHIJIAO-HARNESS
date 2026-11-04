"""按提问从教师知识库取出最接近的段落，写成一条系统消息。"""

from app.config import embedding_model_name
from app.knowledge.embed import cosine, unpack_vector

HEADER = (
    "以下是从这位教师的知识库检索到的段落。回答时若使用了某段内容，写明资料标题。这些段落里没有的内容不要编造出处。"
)
_TOP = 5
_MIN_BODY = 64


def build_knowledge_message(
    repo,
    owner_id,
    question: str,
    *,
    token_budget: int,
    count_tokens,
    embedder,
) -> str:
    model = embedding_model_name()
    if model == "":
        return ""
    candidates = _candidates(repo, owner_id, model)
    if not candidates:
        return ""
    query = _query_vector(embedder, question)
    if query is None:
        return ""
    ranked = _rank(candidates, query)[:_TOP]
    if not ranked:
        return ""
    return _fit(ranked, token_budget, count_tokens)


def _candidates(repo, owner_id: str, model: str) -> list[tuple]:
    documents = {item.id: item for item in repo.list_knowledge_documents(owner_id)}
    found = []
    for chunk in repo.list_knowledge_chunks(owner_id):
        document = documents.get(chunk.document_id)
        if document is None or document.status != "ready":
            continue
        if chunk.embedding_model != model or not chunk.embedding:
            continue
        found.append((document, chunk))
    return found


def _query_vector(embedder, question: str) -> list[float] | None:
    try:
        vectors = embedder(question)
    except Exception:
        return None
    if not isinstance(vectors, list) or not vectors:
        return None
    query = vectors[0]
    if not isinstance(query, list) or not query:
        return None
    values: list[float] = []
    for item in query:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            return None
        values.append(float(item))
    return values


def _rank(candidates, query: list[float]) -> list[tuple]:
    width = len(query)
    scored = []
    for document, chunk in candidates:
        vector = _vector(chunk, width)
        if vector is None:
            continue
        score = cosine(query, vector)
        if score <= 0:
            continue
        scored.append((score, document.created_at, chunk.ordinal, document.title, chunk.text))
    scored.sort(key=lambda item: (-item[0], item[1], item[2]))
    return scored


def _vector(chunk, width: int) -> list[float] | None:
    blob = chunk.embedding
    if chunk.dimensions != width or not isinstance(blob, bytes) or len(blob) != width * 4:
        return None
    values = unpack_vector(blob)
    if len(values) != width:
        return None
    return values


def _fit(ranked, token_budget: int, count_tokens) -> str:
    excerpts: list[str] = []
    for _score, _created_at, _ordinal, title, text in ranked:
        title_line = f"资料《{title}》："
        if token_budget < _tokens(title_line, count_tokens) + _MIN_BODY:
            break
        excerpt = title_line + "\n" + text
        candidate = "\n".join([HEADER, *excerpts, excerpt])
        if _tokens(candidate, count_tokens) > token_budget:
            break
        excerpts.append(excerpt)
    if not excerpts:
        return ""
    return "\n".join([HEADER, *excerpts])


def _tokens(text: str, count_tokens) -> int:
    return count_tokens([{"role": "system", "content": text}])
