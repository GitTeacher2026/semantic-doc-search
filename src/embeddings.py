"""Shared embedding model used for indexing and categorization."""

from __future__ import annotations

import streamlit as st
from langchain_huggingface import HuggingFaceEmbeddings

# Small, free, local model — no API key required.
EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


@st.cache_resource(show_spinner="Loading embedding model…")
def get_embeddings() -> HuggingFaceEmbeddings:
    """Return a cached HuggingFace embedding model."""
    return HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL_NAME,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )
