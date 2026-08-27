"""Persist uploads, categorize by embedding similarity, and search with FAISS."""

from __future__ import annotations

import json
import re
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = ROOT / "uploads"
DATA_DIR = ROOT / "data"
META_PATH = DATA_DIR / "documents.json"
INDEX_DIR = DATA_DIR / "faiss_index"

# Assign to an existing category when cosine similarity exceeds this.
CATEGORY_SIMILARITY_THRESHOLD = 0.52
CHUNK_SIZE = 800
CHUNK_OVERLAP = 120
STOPWORDS = frozenset(
    """
    a an the and or but if in on at to for of with by from as is are was were be
    been being it this that these those i you he she we they them their our your
    my me his her its not no yes do does did done have has had will would can
    could should may might must shall about into over under again further then
    once here there when where why how all each few more most other some such
    than too very just also only own same so than too very document file pdf txt
    page pages text content
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
    META_PATH.write_text(json.dumps(docs, indent=2), encoding="utf-8")


def _slugify(name: str) -> str:
    base = Path(name).stem
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", base).strip("_")
    return cleaned[:80] or "document"


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        reader = PdfReader(str(path))
        parts: list[str] = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        return "\n".join(parts).strip()
    if suffix in {".txt", ".md", ".text", ".log", ".csv"}:
        return path.read_text(encoding="utf-8", errors="ignore").strip()
    raise ValueError(f"Unsupported file type: {suffix}")


def _topic_label(text: str, filename: str) -> str:
    """Derive a short topic label from frequent content words."""
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text.lower())
    counts = Counter(t for t in tokens if t not in STOPWORDS and not t.isdigit())
    if not counts:
        return _slugify(filename).replace("_", " ").title() or "General"
    top = [word for word, _ in counts.most_common(3)]
    return " / ".join(w.title() for w in top)


def _mean_embedding(embeddings: HuggingFaceEmbeddings, texts: list[str]) -> np.ndarray:
    vectors = embeddings.embed_documents(texts)
    arr = np.asarray(vectors, dtype=np.float32)
    mean = arr.mean(axis=0)
    norm = np.linalg.norm(mean)
    if norm > 0:
        mean = mean / norm
    return mean


def _category_centroids(
    docs: list[dict[str, Any]], embeddings: HuggingFaceEmbeddings
) -> dict[str, np.ndarray]:
    by_cat: dict[str, list[str]] = {}
    for doc in docs:
        preview = (doc.get("preview") or doc.get("filename") or "").strip()
        if not preview:
            continue
        by_cat.setdefault(doc["category"], []).append(preview[:2000])
    return {
        category: _mean_embedding(embeddings, previews)
        for category, previews in by_cat.items()
        if previews
    }


def assign_category(
    text: str,
    filename: str,
    existing: list[dict[str, Any]],
    embeddings: HuggingFaceEmbeddings,
) -> str:
    """Assign a project/topic using nearest category centroid in embedding space."""
    sample = text[:4000] if text else filename
    query_vec = np.asarray(embeddings.embed_query(sample), dtype=np.float32)
    qn = np.linalg.norm(query_vec)
    if qn > 0:
        query_vec = query_vec / qn

    centroids = _category_centroids(existing, embeddings)
    best_category = None
    best_score = -1.0
    for category, centroid in centroids.items():
        score = float(np.dot(query_vec, centroid))
        if score > best_score:
            best_score = score
            best_category = category

    if best_category is not None and best_score >= CATEGORY_SIMILARITY_THRESHOLD:
        return best_category
    return _topic_label(text, filename)


def _chunk_documents(
    text: str, metadata: dict[str, Any]
) -> list[Document]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_text(text)
    if not chunks:
        chunks = [text or metadata.get("filename", "empty")]
    return [
        Document(page_content=chunk, metadata={**metadata, "chunk_index": i})
        for i, chunk in enumerate(chunks)
    ]


def load_faiss(embeddings: HuggingFaceEmbeddings) -> FAISS | None:
    ensure_dirs()
    if not (INDEX_DIR / "index.faiss").exists():
        return None
    return FAISS.load_local(
        str(INDEX_DIR),
        embeddings,
        allow_dangerous_deserialization=True,
    )


def save_faiss(store: FAISS) -> None:
    ensure_dirs()
    store.save_local(str(INDEX_DIR))


def ingest_file(
    uploaded_name: str,
    raw_bytes: bytes,
    embeddings: HuggingFaceEmbeddings,
) -> dict[str, Any]:
    """Save an uploaded file, categorize it, and index chunks into FAISS."""
    ensure_dirs()
    suffix = Path(uploaded_name).suffix.lower()
    if suffix not in {".pdf", ".txt", ".md", ".text", ".log", ".csv"}:
        raise ValueError("Only PDF and text files are supported.")

    doc_id = uuid.uuid4().hex[:12]
    safe_name = f"{doc_id}_{_slugify(uploaded_name)}{suffix}"
    dest = UPLOAD_DIR / safe_name
    dest.write_bytes(raw_bytes)

    text = extract_text(dest)
    if not text:
        dest.unlink(missing_ok=True)
        raise ValueError("No extractable text found in that file.")

    existing = load_metadata()
    category = assign_category(text, uploaded_name, existing, embeddings)
    preview = " ".join(text.split())[:280]

    record = {
        "id": doc_id,
        "filename": uploaded_name,
        "stored_as": safe_name,
        "path": str(dest.relative_to(ROOT)),
        "category": category,
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
    docs = _chunk_documents(text, chunk_meta)

    store = load_faiss(embeddings)
    if store is None:
        store = FAISS.from_documents(docs, embeddings)
    else:
        store.add_documents(docs)
    save_faiss(store)

    existing.append(record)
    save_metadata(existing)
    return record


def delete_document(doc_id: str, embeddings: HuggingFaceEmbeddings) -> bool:
    """Remove a document from disk and rebuild the FAISS index without it."""
    docs = load_metadata()
    target = next((d for d in docs if d["id"] == doc_id), None)
    if target is None:
        return False

    path = ROOT / target["path"]
    path.unlink(missing_ok=True)
    remaining = [d for d in docs if d["id"] != doc_id]
    save_metadata(remaining)
    rebuild_index(embeddings)
    return True


def rebuild_index(embeddings: HuggingFaceEmbeddings) -> None:
    """Rebuild FAISS from remaining uploaded files."""
    ensure_dirs()
    docs = load_metadata()
    all_chunks: list[Document] = []
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
        all_chunks.extend(_chunk_documents(text, meta))

    # Clear previous index files.
    for child in INDEX_DIR.glob("*"):
        child.unlink()
    INDEX_DIR.mkdir(parents=True, exist_ok=True)

    if not all_chunks:
        return
    store = FAISS.from_documents(all_chunks, embeddings)
    save_faiss(store)


def semantic_search(
    query: str,
    embeddings: HuggingFaceEmbeddings,
    k: int = 5,
    category: str | None = None,
) -> list[dict[str, Any]]:
    store = load_faiss(embeddings)
    if store is None:
        return []

    # Over-fetch when filtering by category.
    fetch_k = k * 4 if category else k
    hits = store.similarity_search_with_score(query, k=fetch_k)

    results: list[dict[str, Any]] = []
    for doc, score in hits:
        meta = doc.metadata or {}
        if category and meta.get("category") != category:
            continue
        # FAISS L2 with normalized vectors ≈ 2 - 2*cos; convert to similarity.
        similarity = max(0.0, 1.0 - float(score) / 2.0)
        results.append(
            {
                "content": doc.page_content,
                "filename": meta.get("filename", "unknown"),
                "category": meta.get("category", "Uncategorized"),
                "doc_id": meta.get("doc_id"),
                "score": similarity,
                "distance": float(score),
            }
        )
        if len(results) >= k:
            break
    return results


def category_summary(docs: list[dict[str, Any]]) -> dict[str, int]:
    counts: Counter[str] = Counter(d["category"] for d in docs)
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))
