"""Shared embedding model used for indexing and categorization."""

from __future__ import annotations

import streamlit as st
from langchain_huggingface import HuggingFaceEmbeddings

# Multilingual model — supports Arabic without a paid API.
EMBEDDING_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


@st.cache_resource(show_spinner="جارٍ تحميل نموذج التضمين…")
def get_embeddings() -> HuggingFaceEmbeddings:
    """Return a cached HuggingFace embedding model."""
    return HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL_NAME,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )
