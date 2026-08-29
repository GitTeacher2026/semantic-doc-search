"""Persist uploads, categorize by token overlap, and search with BM25."""

from __future__ import annotations

import json
import re
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from langchain_text_splitters import RecursiveCharacterTextSplitter

from src.file_extractors import SUPPORTED_EXTENSIONS, file_group, safe_storage_name
from src.file_extractors import extract_text as extract_file_text
from src.text_search import (
    add_chunks,
    assign_category_by_overlap,
    rebuild_chunks,
    remove_document_chunks,
    search_chunks,
)

ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = ROOT / "uploads"
DATA_DIR = ROOT / "data"
META_PATH = DATA_DIR / "documents.json"

CHUNK_SIZE = 800
CHUNK_OVERLAP = 120
STOPWORDS = frozenset(
    """
    a an the and or but if in on at to for of with by from as is are was were be
    been being it this that these those i you he she we they them their our your
    my me his his her its not no yes do does did done have has had will would can
    could should may might must shall about into over under again further then
    once here there when where why how all each few more most other some such
    than too very just also only own same so document file pdf txt page pages text
    content في من إلى عن على أن أو كان كانت هذا هذه ذلك تلك التي الذي الذين
    ما لم لن إن أنه إذا ثم قد لقد حيث عند بين حتى بعد قبل كل بعض أي نحو عبر
    حول خلال ضمن دون فوق تحت مستند ملف صفحة نص محتوى
    """.split()
)


def ensure_dirs() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def load_metadata() -> list[dict[str, Any]]:
    ensure_dirs()
    if not META_PATH.exists():
        return []
    return json.loads(META_PATH.read_text(encoding="utf-8"))


def save_metadata(docs: list[dict[str, Any]]) -> None:
    ensure_dirs()
    META_PATH.write_text(
        json.dumps(docs, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _slugify(name: str) -> str:
    base = Path(name).stem
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", base).strip("_")
    return cleaned[:80] or "مستند"


def extract_text(path: Path) -> str:
    return extract_file_text(path)


def _topic_label(text: str, filename: str) -> str:
    tokens = re.findall(r"[\u0600-\u06FF]{3,}|[A-Za-z][A-Za-z0-9_-]{2,}", text.lower())
    counts = Counter(t for t in tokens if t not in STOPWORDS and not t.isdigit())
    if not counts:
        return _slugify(filename).replace("_", " ") or "عام"
    top = [word for word, _ in counts.most_common(3)]
    return " / ".join(top)


def _chunk_text(text: str, metadata: dict[str, Any]) -> list[dict[str, Any]]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", "۔ ", "؟ ", "! ", " ", ""],
    )
    chunks = splitter.split_text(text)
    if not chunks:
        chunks = [text or metadata.get("filename", "empty")]
    return [
        {**metadata, "content": chunk, "chunk_index": i}
        for i, chunk in enumerate(chunks)
    ]


def ingest_file(uploaded_name: str, raw_bytes: bytes) -> dict[str, Any]:
    """Save an uploaded file, categorize it, and index chunks for BM25 search."""
    ensure_dirs()
    suffix = Path(uploaded_name).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        raise ValueError(f"نوع الملف غير مدعوم. الأنواع المدعومة: {supported}")

    doc_id = uuid.uuid4().hex[:12]
    safe_name = safe_storage_name(uploaded_name, doc_id)
    dest = UPLOAD_DIR / safe_name
    dest.write_bytes(raw_bytes)

    text = extract_text(dest)
    if not text:
        dest.unlink(missing_ok=True)
        raise ValueError("لم يُعثر على نص قابل للاستخراج في هذا الملف.")

    existing = load_metadata()
    category = assign_category_by_overlap(
        text, uploaded_name, existing, _topic_label
    )
    preview = " ".join(text.split())[:280]

    record = {
        "id": doc_id,
        "filename": uploaded_name,
        "stored_as": safe_name,
        "path": str(dest.relative_to(ROOT)),
        "category": category,
        "file_group": file_group(suffix),
        "extension": suffix.lstrip("."),
        "char_count": len(text),
        "preview": preview,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }

    chunk_meta = {
        "doc_id": doc_id,
        "filename": uploaded_name,
        "category": category,
        "stored_as": safe_name,
    }
    add_chunks(_chunk_text(text, chunk_meta))

    existing.append(record)
    save_metadata(existing)
    return record


def delete_document(doc_id: str) -> bool:
    docs = load_metadata()
    target = next((d for d in docs if d["id"] == doc_id), None)
    if target is None:
        return False

    path = ROOT / target["path"]
    path.unlink(missing_ok=True)
    remaining = [d for d in docs if d["id"] != doc_id]
    save_metadata(remaining)
    remove_document_chunks(doc_id)
    return True


def rebuild_index() -> None:
    """Rebuild BM25 chunks from remaining uploaded files."""
    ensure_dirs()
    docs = load_metadata()
    all_chunks: list[dict[str, Any]] = []
    for record in docs:
        path = ROOT / record["path"]
        if not path.exists():
            continue
        try:
            text = extract_text(path)
        except Exception:
            continue
        meta = {
            "doc_id": record["id"],
            "filename": record["filename"],
            "category": record["category"],
            "stored_as": record["stored_as"],
        }
        all_chunks.extend(_chunk_text(text, meta))
    rebuild_chunks(all_chunks)


def semantic_search(
    query: str,
    k: int = 5,
    category: str | None = None,
) -> list[dict[str, Any]]:
    return search_chunks(query, k=k, category=category)


def category_summary(docs: list[dict[str, Any]]) -> dict[str, int]:
    counts: Counter[str] = Counter(d["category"] for d in docs)
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))
