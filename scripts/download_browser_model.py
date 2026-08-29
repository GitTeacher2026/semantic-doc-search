#!/usr/bin/env python3
"""Download the Xenova ONNX model into docs/models for GitHub Pages hosting."""

from __future__ import annotations

from pathlib import Path

from huggingface_hub import snapshot_download

MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "docs" / "models" / MODEL_ID


def main() -> None:
    DEST.parent.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=MODEL_ID,
        local_dir=str(DEST),
        local_dir_use_symlinks=False,
    )
    print(f"Model ready at {DEST}")


if __name__ == "__main__":
    main()
