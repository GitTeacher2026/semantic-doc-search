#!/usr/bin/env python3
"""Download only the quantized ONNX files needed for the browser app."""

from __future__ import annotations

from pathlib import Path

from huggingface_hub import hf_hub_download

MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "docs" / "models" / MODEL_ID

MODEL_FILES = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "unigram.json",
    "onnx/model_quantized.onnx",
]


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    for filename in MODEL_FILES:
        hf_hub_download(
            repo_id=MODEL_ID,
            filename=filename,
            local_dir=str(DEST),
        )
        print(f"Fetched {filename}")
    print(f"Model ready at {DEST}")


if __name__ == "__main__":
    main()
