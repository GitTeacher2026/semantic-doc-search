"""Highlight search terms inside escaped HTML text."""

from __future__ import annotations

import html
import re


def highlight_text(text: str, query: str) -> str:
    """Escape HTML and wrap query tokens in <mark> tags."""
    escaped = html.escape(text)
    tokens = [token for token in re.split(r"\s+", query.strip()) if len(token) >= 2]
    if not tokens:
        return escaped

    unique_tokens = sorted(set(tokens), key=len, reverse=True)
    highlighted = escaped
    for token in unique_tokens:
        esc_token = html.escape(token)
        pattern = re.compile(re.escape(esc_token), re.IGNORECASE)
        highlighted = pattern.sub(r'<mark class="query-hit">\g<0></mark>', highlighted)
    return highlighted
