"""مخزن الوثائق — رفع الملفات، التصنيف التلقائي، والبحث الدلالي."""

from __future__ import annotations

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
    semantic_search,
)
from src.embeddings import EMBEDDING_MODEL_NAME, get_embeddings

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
    </style>
    """,
    unsafe_allow_html=True,
)

ALL_CATEGORIES = "جميع التصنيفات"


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
            "ملفات PDF أو نصية",
            type=["pdf", "txt", "md", "text", "log", "csv"],
            accept_multiple_files=True,
            help="تُحفظ الملفات في مجلد uploads/ وتُفهرَس في قاعدة FAISS المحلية.",
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

        st.subheader("المكتبة")
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

        if not docs:
            st.info("لا توجد مستندات بعد. ارفع ملف PDF أو نص للبدء.")
        else:
            for doc in reversed(docs):
                with st.container(border=True):
                    c1, c2 = st.columns([4, 1])
                    with c1:
                        st.markdown(f"**{doc['filename']}**")
                        st.caption(
                            f"{doc['category']} · {doc['char_count']:,} حرف · "
                            f"محفوظ باسم `{doc['stored_as']}`"
                        )
                        if doc.get("preview"):
                            st.write(doc["preview"] + ("…" if len(doc["preview"]) >= 280 else ""))
                    with c2:
                        if st.button("حذف", key=f"del-{doc['id']}", use_container_width=True):
                            delete_document(doc["id"], embeddings)
                            st.rerun()

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
                    for hit in hits:
                        st.markdown(
                            f"""
                            <div class="hit">
                              <div>
                                <strong>{hit['filename']}</strong>
                                <span class="chip">{hit['category']}</span>
                                <span class="score">{hit['score']:.0%} تطابق</span>
                              </div>
                              <p style="margin:0.55rem 0 0 0; white-space:pre-wrap;">{hit['content']}</p>
                            </div>
                            """,
                            unsafe_allow_html=True,
                        )


if __name__ == "__main__":
    main()
