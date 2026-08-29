"""BM25 full-text search — fast, no ML model download required."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CHUNKS_PATH = ROOT / "data" / "search_chunks.json"

TOKEN_PATTERN = re.compile(r"[\u0600-\u06FF]{2,}|[A-Za-z][A-Za-z0-9_-]{1,}")
K1 = 1.5
B = 0.75
CATEGORY_OVERLAP_THRESHOLD = 0.12


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_PATTERN.findall(text or "")]


def _load_chunks() -> list[dict[str, Any]]:
    if not CHUNKS_PATH.exists():
        return []
    return json.loads(CHUNKS_PATH.read_text(encoding="utf-8"))


def _save_chunks(chunks: list[dict[str, Any]]) -> None:
    CHUNKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CHUNKS_PATH.write_text(
        json.dumps(chunks, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


class BM25Index:
    def __init__(self, chunks: list[dict[str, Any]]) -> None:
        self.chunks = chunks
        self.doc_tokens = [tokenize(chunk.get("content", "")) for chunk in chunks]
        self.n_docs = len(chunks)
        self.avgdl = (
            sum(len(tokens) for tokens in self.doc_tokens) / self.n_docs
            if self.n_docs
            else 0.0
        )
        self.df: dict[str, int] = {}
        for tokens in self.doc_tokens:
            for term in set(tokens):
                self.df[term] = self.df.get(term, 0) + 1

    def _score_doc(self, query_tokens: list[str], doc_idx: int) -> float:
        tokens = self.doc_tokens[doc_idx]
        if not tokens:
            return 0.0
        dl = len(tokens)
        tf: dict[str, int] = {}
        for term in tokens:
            tf[term] = tf.get(term, 0) + 1

        score = 0.0
        for term in query_tokens:
            freq = tf.get(term, 0)
            if not freq:
                continue
            df = self.df.get(term, 0)
            idf = math.log(1 + (self.n_docs - df + 0.5) / (df + 0.5))
            denom = freq + K1 * (1 - B + B * dl / self.avgdl)
            score += idf * (freq * (K1 + 1)) / denom
        return score

    def search(
        self,
        query: str,
        k: int = 5,
        category: str | None = None,
    ) -> list[tuple[dict[str, Any], float]]:
        query_tokens = tokenize(query)
        if not query_tokens:
            return []

        hits: list[tuple[dict[str, Any], float]] = []
        for idx, chunk in enumerate(self.chunks):
            if category and chunk.get("category") != category:
                continue
            score = self._score_doc(query_tokens, idx)
            if score > 0:
                hits.append((chunk, score))

        hits.sort(key=lambda item: item[1], reverse=True)
        return hits[:k]


def assign_category_by_overlap(
    text: str,
    filename: str,
    existing: list[dict[str, Any]],
    topic_label_fn,
) -> str:
    """Assign category using token overlap with existing documents."""
    doc_tokens = set(tokenize(text[:4000] or filename))
    if not doc_tokens:
        return topic_label_fn(text, filename)

    by_category: dict[str, set[str]] = {}
    for record in existing:
        preview = record.get("preview") or record.get("filename") or ""
        by_category.setdefault(record["category"], set()).update(tokenize(preview[:2000]))

    best_category = None
    best_score = 0.0
    for category, cat_tokens in by_category.items():
        if not cat_tokens:
            continue
        overlap = len(doc_tokens & cat_tokens)
        score = overlap / len(doc_tokens | cat_tokens)
        if score > best_score:
            best_score = score
            best_category = category

    if best_category and best_score >= CATEGORY_OVERLAP_THRESHOLD:
        return best_category
    return topic_label_fn(text, filename)


def add_chunks(new_chunks: list[dict[str, Any]]) -> None:
    chunks = _load_chunks()
    chunks.extend(new_chunks)
    _save_chunks(chunks)


def remove_document_chunks(doc_id: str) -> None:
    chunks = [chunk for chunk in _load_chunks() if chunk.get("doc_id") != doc_id]
    _save_chunks(chunks)


def rebuild_chunks(all_chunks: list[dict[str, Any]]) -> None:
    _save_chunks(all_chunks)


def search_chunks(
    query: str,
    k: int = 5,
    category: str | None = None,
) -> list[dict[str, Any]]:
    chunks = _load_chunks()
    if not chunks:
        return []

    index = BM25Index(chunks)
    raw_hits = index.search(query, k=k, category=category)
    if not raw_hits:
        return []

    max_score = raw_hits[0][1] or 1.0
    results: list[dict[str, Any]] = []
    for chunk, score in raw_hits:
        results.append(
            {
                "content": chunk.get("content", ""),
                "filename": chunk.get("filename", "unknown"),
                "category": chunk.get("category", "غير مصنّف"),
                "doc_id": chunk.get("doc_id"),
                "score": min(1.0, score / max_score),
                "raw_score": score,
            }
        )
    return results
