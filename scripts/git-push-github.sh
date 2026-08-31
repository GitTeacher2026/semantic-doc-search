#!/usr/bin/env bash
# Push main to GitTeacher2026/semantic-doc-search using GITHUB_PUSH_TOKEN or DOCSHELF_GITHUB_TOKEN.
set -euo pipefail

REPO="GitTeacher2026/semantic-doc-search"
TOKEN="${GITHUB_PUSH_TOKEN:-${DOCSHELF_GITHUB_TOKEN:-}}"

if [[ -z "$TOKEN" ]]; then
  echo "Missing token. Set GITHUB_PUSH_TOKEN or DOCSHELF_GITHUB_TOKEN in the environment." >&2
  exit 1
fi

REMOTE_URL="https://x-access-token:${TOKEN}@github.com/${REPO}.git"

git push "${REMOTE_URL}" HEAD:main
