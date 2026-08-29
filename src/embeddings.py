"""Shared embedding model used for indexing and categorization."""

from __future__ import annotations

import os
from pathlib import Path

import streamlit as st
from langchain_huggingface import HuggingFaceEmbeddings

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / ".cache" / "huggingface"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

os.environ.setdefault("HF_HOME", str(CACHE_DIR))
os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", str(CACHE_DIR))

# Multilingual model — supports Arabic without a paid API.
EMBEDDING_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


@st.cache_resource(show_spinner="جارٍ تحميل نموذج التضمين من الخادم…")
def get_embeddings() -> HuggingFaceEmbeddings:
    """Return a cached HuggingFace embedding model stored on disk."""
    return HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL_NAME,
        cache_folder=str(CACHE_DIR),
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )
