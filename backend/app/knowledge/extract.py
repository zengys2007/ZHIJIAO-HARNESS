"""从 txt、markdown、pdf 和 docx 字节中抽出纯文本。"""

import io
from collections.abc import Callable

from docx import Document
from pypdf import PdfReader

TextExtractor = Callable[[bytes], str]


class UnknownExtension(Exception):
    """扩展名没有对应的文本解析器。"""


class DecodeError(Exception):
    """文本既不是 UTF-8，也无法按 GB18030 解码。"""


def _decode_text(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return data.decode("gb18030")
        except UnicodeDecodeError as exc:
            raise DecodeError("文本编码无法识别") from exc


def _extract_pdf(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    parts: list[str] = []
    for page in reader.pages:
        text = page.extract_text()
        parts.append("" if text is None else text)
    return "\n".join(parts)


def _extract_docx(data: bytes) -> str:
    document = Document(io.BytesIO(data))
    parts = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                parts.append(cell.text)
    return "\n".join(parts)


EXTRACTORS: dict[str, TextExtractor] = {
    ".txt": _decode_text,
    ".md": _decode_text,
    ".pdf": _extract_pdf,
    ".docx": _extract_docx,
}


def extract_bytes(extension: str, data: bytes) -> str:
    extractor = EXTRACTORS.get(extension.lower())
    if extractor is None:
        raise UnknownExtension(extension)
    return extractor(data)
