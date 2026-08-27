# DocShelf

Single-page Streamlit app for uploading PDF and text files, auto-categorizing them into projects/topics with a free local embedding model, and running semantic search over their contents with LangChain + FAISS.

## Features

- Upload PDF and text files (`.pdf`, `.txt`, `.md`, and similar)
- Files are saved under `uploads/`
- Chunking and embedding via LangChain + `sentence-transformers/all-MiniLM-L6-v2` (no API key)
- Automatic project/topic assignment by nearest category centroid in embedding space
- Semantic search across all document chunks stored in a local FAISS index (`data/faiss_index/`)

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py --server.port 8512 --server.address 0.0.0.0
```

Open the URL Streamlit prints (default here: http://127.0.0.1:8512).

The first run downloads the embedding model (~90MB). Later runs use the local cache.

## How categorization works

1. Each uploaded file is saved and its text extracted.
2. The text is embedded with MiniLM.
3. If it is close enough to an existing category centroid, it joins that project/topic.
4. Otherwise a new topic label is derived from frequent content words.

## Project layout

```
app.py                 # Streamlit UI
src/embeddings.py      # Cached HuggingFace embeddings
src/document_store.py  # Upload, categorize, FAISS index/search
uploads/               # Saved files
data/                  # Metadata + FAISS index
requirements.txt
```

## Notes

- Everything runs locally — no OpenAI or other paid API is required.
- Deleting a document removes the file and rebuilds the FAISS index from remaining uploads.
