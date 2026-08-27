"""DocShelf — upload, auto-categorize, and semantically search documents."""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.document_store import (
    category_summary,
    delete_document,
    ingest_file,
    load_metadata,
    semantic_search,
)
from src.embeddings import EMBEDDING_MODEL_NAME, get_embeddings

st.set_page_config(
    page_title="DocShelf",
    page_icon="📚",
    layout="wide",
    initial_sidebar_state="collapsed",
)

st.markdown(
    """
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Source+Sans+3:wght@400;500;600&display=swap');

      :root {
        --ink: #1c2430;
        --muted: #5a6574;
        --paper: #f3efe6;
        --panel: #fffdf8;
        --line: #d7d0c3;
        --accent: #0f6e56;
        --accent-soft: #d8efe6;
        --warn: #8a4b12;
      }

      html, body, [class*="css"] {
        font-family: "Source Sans 3", "Segoe UI", sans-serif;
        color: var(--ink);
      }

      .stApp {
        background:
          radial-gradient(1200px 500px at 10% -10%, #e7f3ee 0%, transparent 55%),
          radial-gradient(900px 420px at 100% 0%, #f7e8d4 0%, transparent 50%),
          linear-gradient(180deg, #f7f3ea 0%, #efe9dc 100%);
      }

      h1, h2, h3 {
        font-family: Fraunces, Georgia, serif !important;
        letter-spacing: -0.02em;
      }

      .hero {
        padding: 0.4rem 0 1.2rem 0;
        border-bottom: 1px solid var(--line);
        margin-bottom: 1.4rem;
      }

      .brand {
        font-family: Fraunces, Georgia, serif;
        font-size: 2.4rem;
        font-weight: 700;
        margin: 0;
        color: var(--ink);
      }

      .tagline {
        margin: 0.35rem 0 0 0;
        color: var(--muted);
        font-size: 1.05rem;
        max-width: 42rem;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 1rem 1.1rem;
        margin-bottom: 0.85rem;
      }

      .meta {
        color: var(--muted);
        font-size: 0.9rem;
      }

      .chip {
        display: inline-block;
        background: var(--accent-soft);
        color: var(--accent);
        border-radius: 999px;
        padding: 0.15rem 0.65rem;
        font-size: 0.8rem;
        font-weight: 600;
        margin-right: 0.35rem;
      }

      .hit {
        background: var(--panel);
        border: 1px solid var(--line);
        border-left: 4px solid var(--accent);
        border-radius: 10px;
        padding: 0.85rem 1rem;
        margin-bottom: 0.7rem;
      }

      .score {
        color: var(--accent);
        font-weight: 600;
        font-size: 0.85rem;
      }

      div[data-testid="stFileUploader"] section {
        background: var(--panel);
        border: 1px dashed #b7c4bb;
        border-radius: 12px;
      }
    </style>
    """,
    unsafe_allow_html=True,
)


def main() -> None:
    st.markdown(
        """
        <div class="hero">
          <p class="brand">DocShelf</p>
          <p class="tagline">
            Upload PDFs and text files, let local embeddings sort them into projects,
            then search across everything with semantic FAISS retrieval.
          </p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    embeddings = get_embeddings()
    docs = load_metadata()
    categories = category_summary(docs)

    left, right = st.columns([1.05, 1.2], gap="large")

    with left:
        st.subheader("Upload")
        uploaded = st.file_uploader(
            "PDF or text files",
            type=["pdf", "txt", "md", "text", "log", "csv"],
            accept_multiple_files=True,
            help="Files are saved under uploads/ and indexed into a local FAISS store.",
        )

        if uploaded:
            if st.button("Ingest & categorize", type="primary", use_container_width=True):
                progress = st.progress(0.0, text="Starting…")
                errors: list[str] = []
                successes: list[str] = []
                for i, file in enumerate(uploaded):
                    progress.progress(
                        i / max(len(uploaded), 1),
                        text=f"Indexing {file.name}…",
                    )
                    try:
                        record = ingest_file(file.name, file.getvalue(), embeddings)
                        successes.append(
                            f"{record['filename']} → **{record['category']}**"
                        )
                    except Exception as exc:  # noqa: BLE001 — show per-file failures
                        errors.append(f"{file.name}: {exc}")
                progress.progress(1.0, text="Done")
                docs = load_metadata()
                categories = category_summary(docs)
                for msg in successes:
                    st.success(msg)
                for msg in errors:
                    st.error(msg)
                if successes:
                    st.rerun()

        st.subheader("Library")
        st.caption(
            f"Embedding model: `{EMBEDDING_MODEL_NAME}` · "
            f"{len(docs)} document{'s' if len(docs) != 1 else ''}"
        )

        if categories:
            chips = " ".join(
                f'<span class="chip">{name} ({count})</span>'
                for name, count in categories.items()
            )
            st.markdown(
                f'<div class="panel"><div class="meta">Projects / topics</div>{chips}</div>',
                unsafe_allow_html=True,
            )

        if not docs:
            st.info("No documents yet. Upload a PDF or text file to get started.")
        else:
            for doc in reversed(docs):
                with st.container(border=True):
                    c1, c2 = st.columns([4, 1])
                    with c1:
                        st.markdown(f"**{doc['filename']}**")
                        st.caption(
                            f"{doc['category']} · {doc['char_count']:,} chars · "
                            f"saved as `{doc['stored_as']}`"
                        )
                        if doc.get("preview"):
                            st.write(doc["preview"] + ("…" if len(doc["preview"]) >= 280 else ""))
                    with c2:
                        if st.button("Remove", key=f"del-{doc['id']}", use_container_width=True):
                            delete_document(doc["id"], embeddings)
                            st.rerun()

    with right:
        st.subheader("Semantic search")
        query = st.text_input(
            "Search across document contents",
            placeholder="e.g. budget timeline for the bridge retrofit",
        )
        filter_options = ["All categories"] + list(categories.keys())
        selected = st.selectbox("Filter by project / topic", filter_options)
        top_k = st.slider("Results", min_value=3, max_value=12, value=5)

        run = st.button("Search", type="primary", use_container_width=True)
        if run:
            if not query.strip():
                st.warning("Enter a search query.")
            elif not docs:
                st.warning("Upload documents before searching.")
            else:
                category = None if selected == "All categories" else selected
                with st.spinner("Searching FAISS index…"):
                    hits = semantic_search(
                        query.strip(),
                        embeddings,
                        k=top_k,
                        category=category,
                    )
                if not hits:
                    st.info("No matching passages found. Try a broader query.")
                else:
                    for hit in hits:
                        st.markdown(
                            f"""
                            <div class="hit">
                              <div>
                                <strong>{hit['filename']}</strong>
                                <span class="chip">{hit['category']}</span>
                                <span class="score">{hit['score']:.0%} match</span>
                              </div>
                              <p style="margin:0.55rem 0 0 0; white-space:pre-wrap;">{hit['content']}</p>
                            </div>
                            """,
                            unsafe_allow_html=True,
                        )


if __name__ == "__main__":
    main()
