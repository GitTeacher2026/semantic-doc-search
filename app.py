"""مخزن الوثائق — رفع الملفات، التصنيف التلقائي، والبحث الدلالي."""

from __future__ import annotations

import html
import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.auth import logout, require_login
from src.document_store import (
    category_summary,
    delete_document,
    ingest_file,
    load_metadata,
    read_document_bytes,
    semantic_search,
)
from src.embeddings import EMBEDDING_MODEL_NAME, get_embeddings
from src.explorer import build_explorer_tree
from src.file_extractors import GROUP_ICONS, GROUP_LABELS_AR
from src.highlight import highlight_text

st.set_page_config(
    page_title="مخزن الوثائق",
    page_icon="📚",
    layout="wide",
    initial_sidebar_state="collapsed",
)

st.markdown(
    """
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&family=Noto+Serif+Arabic:wght@600;700&display=swap');

      :root {
        --ink: #1c2430;
        --muted: #5a6574;
        --paper: #f3efe6;
        --panel: #fffdf8;
        --line: #d7d0c3;
        --accent: #0f6e56;
        --accent-soft: #d8efe6;
      }

      html, body, [class*="css"] {
        font-family: "Noto Sans Arabic", "Segoe UI", sans-serif;
        color: var(--ink);
        direction: rtl;
        text-align: right;
      }

      .stApp {
        background:
          radial-gradient(1200px 500px at 90% -10%, #e7f3ee 0%, transparent 55%),
          radial-gradient(900px 420px at 0% 0%, #f7e8d4 0%, transparent 50%),
          linear-gradient(180deg, #f7f3ea 0%, #efe9dc 100%);
      }

      h1, h2, h3, h4 {
        font-family: "Noto Serif Arabic", Georgia, serif !important;
        letter-spacing: 0;
      }

      .hero {
        padding: 0.4rem 0 1.2rem 0;
        border-bottom: 1px solid var(--line);
        margin-bottom: 1.4rem;
      }

      .brand {
        font-family: "Noto Serif Arabic", Georgia, serif;
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
        margin-left: 0.35rem;
      }

      .hit {
        background: var(--panel);
        border: 1px solid var(--line);
        border-right: 4px solid var(--accent);
        border-left: 1px solid var(--line);
        border-radius: 10px;
        padding: 0.85rem 1rem;
        margin-bottom: 0.7rem;
      }

      .score {
        color: var(--accent);
        font-weight: 600;
        font-size: 0.85rem;
      }

      .login-shell {
        margin: 2rem 0 1rem 0;
      }

      .login-card {
        text-align: center;
      }

      .login-brand {
        font-family: "Noto Serif Arabic", Georgia, serif;
        font-size: 2.2rem;
        font-weight: 700;
        margin: 0;
      }

      .login-sub {
        color: var(--muted);
        margin-top: 0.5rem;
      }

      div[data-testid="stFileUploader"] section {
        background: var(--panel);
        border: 1px dashed #b7c4bb;
        border-radius: 12px;
      }

      [data-testid="stForm"] {
        direction: rtl;
      }

      .explorer {
        border: 1px solid var(--line);
        border-radius: 12px;
        background: #fff;
        padding: 0.35rem 0.5rem;
      }

      .explorer-folder {
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 0.35rem 0.55rem;
        margin: 0.45rem 0;
        background: var(--panel);
      }

      .explorer-subfolder {
        margin: 0.35rem 0.8rem 0.35rem 0;
        padding-right: 0.55rem;
        border-right: 2px solid var(--accent-soft);
      }

      .explorer-file {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        padding: 0.45rem 0.55rem;
        margin: 0.25rem 0;
        border-radius: 8px;
        background: #fff;
        border: 1px solid #ece7dc;
      }

      .explorer-file-name {
        font-weight: 600;
        word-break: break-word;
      }

      .explorer-file-meta {
        color: var(--muted);
        font-size: 0.82rem;
      }

      mark.query-hit, .query-hit {
        background: #ffe566;
        color: inherit;
        padding: 0 0.12rem;
        border-radius: 3px;
        font-weight: 600;
      }
    </style>
    """,
    unsafe_allow_html=True,
)

ALL_CATEGORIES = "جميع التصنيفات"
UPLOAD_TYPES = [
    "pdf",
    "txt",
    "md",
    "text",
    "log",
    "csv",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
]


def render_file_explorer(docs: list[dict], embeddings) -> None:
    """Render a structured category → type → file tree."""
    tree = build_explorer_tree(docs)
    if not tree:
        st.info("لا توجد مستندات بعد. ارفع ملفاً للبدء.")
        return

    st.markdown('<div class="explorer">', unsafe_allow_html=True)
    for folder in tree:
        with st.expander(
            f"{folder['icon']} {folder['category']} ({folder['count']})",
            expanded=True,
        ):
            for group in folder["groups"]:
                st.markdown(
                    f'<div class="explorer-subfolder">'
                    f'<strong>{group["icon"]} {group["label"]}</strong> '
                    f'<span class="explorer-file-meta">({len(group["files"])})</span>'
                    f"</div>",
                    unsafe_allow_html=True,
                )
                for doc in group["files"]:
                    col_info, col_download, col_actions = st.columns([5, 1, 1])
                    with col_info:
                        group_label = GROUP_LABELS_AR.get(
                            doc.get("file_group", "other"),
                            doc.get("file_group", "other"),
                        )
                        icon = GROUP_ICONS.get(doc.get("file_group", "other"), "📁")
                        st.markdown(
                            f"""
                            <div class="explorer-file">
                              <div>
                                <div class="explorer-file-name">{icon} {doc['filename']}</div>
                                <div class="explorer-file-meta">
                                  {group_label} · {doc['char_count']:,} حرف · {doc.get('extension', '')}
                                </div>
                              </div>
                            </div>
                            """,
                            unsafe_allow_html=True,
                        )
                        if doc.get("preview"):
                            st.caption(
                                doc["preview"]
                                + ("…" if len(doc.get("preview", "")) >= 280 else "")
                            )
                    with col_download:
                        try:
                            file_bytes = read_document_bytes(doc)
                            st.download_button(
                                "تنزيل",
                                data=file_bytes,
                                file_name=doc["filename"],
                                mime="application/octet-stream",
                                key=f"dl-{doc['id']}",
                                use_container_width=True,
                            )
                        except FileNotFoundError:
                            st.caption("غير متوفر")
                    with col_actions:
                        if st.button("حذف", key=f"del-{doc['id']}", use_container_width=True):
                            delete_document(doc["id"], embeddings)
                            st.rerun()
    st.markdown("</div>", unsafe_allow_html=True)


def main() -> None:
    require_login()

    top_left, top_right = st.columns([4, 1])
    with top_left:
        st.markdown(
            """
            <div class="hero">
              <p class="brand">مخزن الوثائق</p>
              <p class="tagline">
                ارفع ملفات PDF والنصوص، دع التضمينات المحلية تصنّفها تلقائياً إلى مشاريع،
                ثم ابحث دلالياً عبر كل المحتوى باستخدام FAISS.
              </p>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with top_right:
        st.write("")
        if st.button("تسجيل الخروج", use_container_width=True):
            logout()
            st.rerun()

    embeddings = get_embeddings()
    docs = load_metadata()
    categories = category_summary(docs)

    left, right = st.columns([1.05, 1.2], gap="large")

    with left:
        st.subheader("رفع الملفات")
        uploaded = st.file_uploader(
            "ملفات PDF، Office، أو نصية",
            type=UPLOAD_TYPES,
            accept_multiple_files=True,
            help="يدعم الأسماء العربية وملفات Word وExcel وPowerPoint.",
        )

        if uploaded:
            if st.button("فهرسة وتصنيف", type="primary", use_container_width=True):
                progress = st.progress(0.0, text="جارٍ البدء…")
                errors: list[str] = []
                successes: list[str] = []
                for i, file in enumerate(uploaded):
                    progress.progress(
                        i / max(len(uploaded), 1),
                        text=f"جارٍ فهرسة {file.name}…",
                    )
                    try:
                        record = ingest_file(file.name, file.getvalue(), embeddings)
                        successes.append(
                            f"{record['filename']} ← **{record['category']}**"
                        )
                    except Exception as exc:  # noqa: BLE001
                        errors.append(f"{file.name}: {exc}")
                progress.progress(1.0, text="اكتمل")
                docs = load_metadata()
                categories = category_summary(docs)
                for msg in successes:
                    st.success(msg)
                for msg in errors:
                    st.error(msg)
                if successes:
                    st.rerun()

        st.subheader("مستكشف الملفات")
        doc_word = "مستند" if len(docs) == 1 else "مستندات"
        st.caption(
            f"نموذج التضمين: `{EMBEDDING_MODEL_NAME}` · "
            f"{len(docs)} {doc_word}"
        )

        if categories:
            chips = " ".join(
                f'<span class="chip">{name} ({count})</span>'
                for name, count in categories.items()
            )
            st.markdown(
                f'<div class="panel"><div class="meta">المشاريع / المواضيع</div>{chips}</div>',
                unsafe_allow_html=True,
            )

        render_file_explorer(docs, embeddings)

    with right:
        st.subheader("البحث الدلالي")
        query = st.text_input(
            "ابحث في محتوى المستندات",
            placeholder="مثال: جدول زمني لمشروع ترميم الجسر",
        )
        filter_options = [ALL_CATEGORIES] + list(categories.keys())
        selected = st.selectbox("تصفية حسب المشروع / الموضوع", filter_options)
        top_k = st.slider("عدد النتائج", min_value=3, max_value=12, value=5)

        run = st.button("بحث", type="primary", use_container_width=True)
        if run:
            if not query.strip():
                st.warning("أدخل عبارة البحث.")
            elif not docs:
                st.warning("ارفع مستندات قبل البحث.")
            else:
                category = None if selected == ALL_CATEGORIES else selected
                with st.spinner("جارٍ البحث في فهرس FAISS…"):
                    hits = semantic_search(
                        query.strip(),
                        embeddings,
                        k=top_k,
                        category=category,
                    )
                if not hits:
                    st.info("لم يُعثر على مقاطع مطابقة. جرّب عبارة أوسع.")
                else:
                    docs_by_id = {doc["id"]: doc for doc in docs}
                    for index, hit in enumerate(hits):
                        highlighted = highlight_text(hit["content"], query.strip())
                        header_cols = st.columns([4, 1])
                        with header_cols[0]:
                            st.markdown(
                                f"""
                                <div class="hit">
                                  <div>
                                    <strong>{html.escape(hit['filename'])}</strong>
                                    <span class="chip">{html.escape(hit['category'])}</span>
                                    <span class="score">{hit['score']:.0%} تطابق</span>
                                  </div>
                                  <p style="margin:0.55rem 0 0 0; white-space:pre-wrap;">{highlighted}</p>
                                </div>
                                """,
                                unsafe_allow_html=True,
                            )
                        with header_cols[1]:
                            doc_id = hit.get("doc_id")
                            if doc_id and doc_id in docs_by_id:
                                try:
                                    st.download_button(
                                        "تنزيل",
                                        data=read_document_bytes(docs_by_id[doc_id]),
                                        file_name=hit["filename"],
                                        mime="application/octet-stream",
                                        key=f"search-dl-{doc_id}-{index}",
                                        use_container_width=True,
                                    )
                                except FileNotFoundError:
                                    st.caption("غير متوفر")


if __name__ == "__main__":
    main()
