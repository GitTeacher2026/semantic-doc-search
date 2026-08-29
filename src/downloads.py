"""Read uploaded files from disk for download."""

from __future__ import annotations

from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent


def get_document_file(doc: dict[str, Any]) -> Path:
    """Return the on-disk path for an uploaded document."""
    return ROOT / doc["path"]


def read_document_bytes(doc: dict[str, Any]) -> bytes:
    """Read raw bytes for download."""
    path = get_document_file(doc)
    if not path.exists():
        raise FileNotFoundError(f"الملف غير موجود: {doc.get('filename', '')}")
    return path.read_bytes()
