"""把知识文本按 token 上限切成带重叠的块。"""

import re

from app.llm.usage import count_messages_locally

MAX_CHUNK_TOKENS = 512
OVERLAP_TOKENS = 64
MAX_CHUNKS = 200

_BLANK_LINE = re.compile(r"\n\s*\n")


class ChunkLimitError(Exception):
    """文本切出的块数超过 MAX_CHUNKS。"""


def text_tokens(text: str) -> int:
    empty = count_messages_locally([{"role": "system", "content": ""}])
    return count_messages_locally([{"role": "system", "content": text}]) - empty


def chunk_text(text: str) -> list[str]:
    if text == "":
        return []
    pieces = _pieces(text.replace("\r\n", "\n").replace("\r", "\n"))
    if not pieces:
        return []

    chunks: list[str] = []
    overlap = ""
    cursor = 0
    while cursor < len(pieces):
        before = cursor
        block, cursor = _pack(pieces, cursor, overlap)
        if cursor == before and block == overlap:
            raise RuntimeError("知识文本无法继续切块")
        if len(chunks) >= MAX_CHUNKS:
            raise ChunkLimitError("知识文本超过 200 块")
        chunks.append(block)
        overlap = _suffix_within(block, OVERLAP_TOKENS)
    return chunks


def _pieces(text: str) -> list[str]:
    paragraphs = [part for part in _BLANK_LINE.split(text) if part]
    pieces: list[str] = []
    for index, paragraph in enumerate(paragraphs):
        if index > 0:
            pieces.append("\n\n")
        pieces.extend(_split_paragraph(paragraph))
    return pieces


def _split_paragraph(paragraph: str) -> list[str]:
    parts: list[str] = []
    rest = paragraph
    while rest:
        if text_tokens(rest) <= MAX_CHUNK_TOKENS:
            parts.append(rest)
            break
        count = _append_length("", rest, MAX_CHUNK_TOKENS)
        if count <= 0:
            count = 1
        parts.append(rest[:count])
        rest = rest[count:]
    return parts


def _pack(pieces: list[str], cursor: int, overlap: str) -> tuple[str, int]:
    block = overlap
    added = False
    while cursor < len(pieces):
        piece = pieces[cursor]
        if text_tokens(block + piece) <= MAX_CHUNK_TOKENS:
            block += piece
            added = True
            cursor += 1
            continue
        if added:
            break
        count = _append_length(block, piece, MAX_CHUNK_TOKENS)
        if count <= 0:
            if block:
                block = ""
                continue
            count = 1
        block += piece[:count]
        remainder = piece[count:]
        if remainder:
            pieces[cursor] = remainder
        else:
            cursor += 1
        break
    return block, cursor


def _append_length(base: str, extra: str, limit: int) -> int:
    if extra == "":
        return 0
    if text_tokens(base + extra) <= limit:
        return len(extra)
    lo = 1
    hi = len(extra)
    best = 0
    while lo <= hi:
        mid = (lo + hi) // 2
        if text_tokens(base + extra[:mid]) <= limit:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    while best < len(extra) and text_tokens(base + extra[: best + 1]) <= limit:
        best += 1
    while best > 0 and text_tokens(base + extra[:best]) > limit:
        best -= 1
    return best


def _suffix_within(text: str, limit: int) -> str:
    if text == "" or limit <= 0:
        return ""
    if text_tokens(text) <= limit:
        return text
    lo = 1
    hi = len(text)
    best = 0
    while lo <= hi:
        mid = (lo + hi) // 2
        if text_tokens(text[-mid:]) <= limit:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    while best < len(text) and text_tokens(text[-(best + 1):]) <= limit:
        best += 1
    while best > 0 and text_tokens(text[-best:]) > limit:
        best -= 1
    if best <= 0:
        return ""
    return text[-best:]
