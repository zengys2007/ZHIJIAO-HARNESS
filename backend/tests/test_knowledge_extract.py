import io

import pytest
from docx import Document
from pypdf import PdfWriter

from app.knowledge.extract import DecodeError, UnknownExtension, extract_bytes


def test_text_extensions_decode_utf8_then_gb18030():
    assert extract_bytes(".txt", "通分\n".encode("utf-8")) == "通分\n"
    assert extract_bytes(".md", "通分".encode("gb18030")) == "通分"
    with pytest.raises(DecodeError):
        extract_bytes(".txt", b"\xff\xfe not text")


def test_docx_extracts_paragraphs_and_cells():
    document = Document()
    document.add_paragraph("通分时先找最小公倍数。")
    table = document.add_table(rows=1, cols=1)
    table.cell(0, 0).text = "单元格"
    buffer = io.BytesIO()
    document.save(buffer)

    text = extract_bytes(".docx", buffer.getvalue())

    assert "通分时先找最小公倍数。" in text
    assert "单元格" in text


def test_blank_pdf_extracts_empty_string_and_doc_is_unknown():
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buffer = io.BytesIO()
    writer.write(buffer)

    assert extract_bytes(".pdf", buffer.getvalue()).strip() == ""
    with pytest.raises(UnknownExtension):
        extract_bytes(".doc", b"old")
