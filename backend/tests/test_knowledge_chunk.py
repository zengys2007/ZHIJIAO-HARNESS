from app.knowledge.chunk import ChunkLimitError, chunk_text, text_tokens


def test_chunk_splits_on_blank_lines_and_overlaps():
    pieces = chunk_text(("甲" * 600) + "\n\n" + ("乙" * 600))
    assert len(pieces) >= 2
    assert all(text_tokens(piece) <= 512 for piece in pieces)
    assert any(piece.startswith("甲") and "乙" in piece for piece in pieces[1:])


def test_chunk_rejects_more_than_200_pieces():
    text = "\n\n".join("句" * 400 for _ in range(201))
    try:
        chunk_text(text)
    except ChunkLimitError:
        return
    raise AssertionError("expected ChunkLimitError")
