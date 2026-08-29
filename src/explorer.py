"""Build a category → file-type → documents tree for the explorer UI."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

from src.file_extractors import GROUP_ICONS, GROUP_LABELS_AR, file_group


def build_explorer_tree(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return explorer nodes sorted for display."""
    categories: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for doc in docs:
        suffix = Path(doc.get("filename", "")).suffix.lower()
        group = doc.get("file_group") or file_group(suffix)
        categories[doc["category"]][group].append(doc)

    tree: list[dict[str, Any]] = []
    for category in sorted(categories.keys(), key=lambda value: value):
        groups: list[dict[str, Any]] = []
        group_items = categories[category]
        for group in sorted(
            group_items.keys(),
            key=lambda value: (GROUP_LABELS_AR.get(value, value), value),
        ):
            files = sorted(
                group_items[group],
                key=lambda item: item.get("filename", ""),
            )
            groups.append(
                {
                    "group": group,
                    "label": GROUP_LABELS_AR.get(group, group),
                    "icon": GROUP_ICONS.get(group, GROUP_ICONS["other"]),
                    "files": files,
                }
            )
        tree.append(
            {
                "category": category,
                "icon": "📁",
                "count": sum(len(group["files"]) for group in groups),
                "groups": groups,
            }
        )
    return tree
