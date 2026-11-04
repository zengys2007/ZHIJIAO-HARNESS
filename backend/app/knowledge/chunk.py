"""把知识文本按 token 上限切成带重叠的块。"""

import re
from collections import deque

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
    paragraphs = [
        part
        for part in _BLANK_LINE.split(text.replace("\r\n", "\n").replace("\r", "\n"))
        if part
    ]
    if not paragraphs:
        return []

    source = _PieceSource(paragraphs)
    chunks: list[str] = []
    overlap = ""
    while source.has_more():
        if len(chunks) >= MAX_CHUNKS:
            raise ChunkLimitError("知识文本超过 200 块")
        block = _take_block(source, overlap)
        chunks.append(block)
        overlap = _suffix_within(block, OVERLAP_TOKENS)
    return chunks


class _PieceSource:
    """按需切出下一段片段，块数到顶后不再读取剩余文本。"""

    def __init__(self, paragraphs: list[str]) -> None:
        self._paragraphs = paragraphs
        self._index = 0
        self._rest = paragraphs[0]
        self._emit_separator = False
        self._pending: deque[str] = deque()

    def has_more(self) -> bool:
        return bool(self._pending) or self._emit_separator or bool(self._rest) or (
            self._index + 1 < len(self._paragraphs)
        )

    def peek(self) -> str:
        if not self._pending:
            self._pull()
        return self._pending[0]

    def pop(self) -> str:
        if not self._pending:
            self._pull()
        return self._pending.popleft()

    def push_front(self, piece: str) -> None:
        if piece:
            self._pending.appendleft(piece)

    def _pull(self) -> None:
        if self._emit_separator:
            self._pending.append("\n\n")
            self._emit_separator = False
            return
        if self._rest:
            count = _append_length("", self._rest, MAX_CHUNK_TOKENS)
            if count <= 0:
                count = 1
            self._pending.append(self._rest[:count])
            self._rest = self._rest[count:]
            return
        self._index += 1
        if self._index >= len(self._paragraphs):
            return
        self._emit_separator = True
        self._rest = self._paragraphs[self._index]
        self._pull()


def _take_block(source: _PieceSource, overlap: str) -> str:
    block = overlap
    added = False
    while source.has_more():
        piece = source.peek()
        if text_tokens(block + piece) <= MAX_CHUNK_TOKENS:
            source.pop()
            block += piece
            added = True
            continue
        if added:
            break
        count = _append_length(block, piece, MAX_CHUNK_TOKENS)
        if count <= 0:
            if block:
                block = ""
                continue
            count = 1
        source.pop()
        block += piece[:count]
        remainder = piece[count:]
        source.push_front(remainder)
        break
    if not added and block == overlap:
        raise RuntimeError("知识文本无法继续切块")
    return block


def _append_length(base: str, extra: str, limit: int) -> int:
    """base 之后还能再接多少个 extra 字符而不超过 limit。

    探针窗口从 64 字起倍增，直到 token 数超过 limit，再只在这个窗口里二分。
    """
    if extra == "":
        return 0
    length = len(extra)
    low = 0
    window = min(64, length)
    while True:
        if text_tokens(base + extra[:window]) > limit:
            break
        low = window
        if window == length:
            return length
        window = min(length, window * 2)
    best = low
    lo = low + 1
    hi = window
    while lo <= hi:
        mid = (lo + hi) // 2
        if text_tokens(base + extra[:mid]) <= limit:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    while best < window and text_tokens(base + extra[: best + 1]) <= limit:
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
