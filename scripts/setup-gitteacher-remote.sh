#!/usr/bin/env bash
set -euo pipefail

REPO="GitTeacher2026/semantic-doc-search"
REMOTE_URL="https://github.com/${REPO}.git"

echo "Configuring git remotes for ${REPO}..."

# Primary GitHub remote used for deploy pushes
git remote remove github 2>/dev/null || true
git remote add github "$REMOTE_URL"

# Optional: also push main to GitHub when pushing origin (Cursor mirror)
git config remote.origin.pushurl "$REMOTE_URL"
git config --add remote.origin.pushurl "$(git remote get-url origin)"

git branch --set-upstream-to=github/main main 2>/dev/null || true

echo "Remotes:"
git remote -v
echo ""
echo "Push targets for origin:"
git config --get-all remote.origin.pushurl || true
echo ""
echo "Active gh account:"
gh auth status || true
