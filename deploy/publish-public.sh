#!/usr/bin/env bash
# Makes the public copy of Snap Convert for GitHub (owner decisions D35, D36), without touching this repo:
#   - code only: drops prompts/, prototype/, CLAUDE.md and docs/ (except the deploy docs the code and
#     README use: docs/launch/headers.md, docs/launch/checklist.md, docs/launch/screenshots/);
#   - every commit's author and committer email becomes your GitHub private "noreply" address.
#
# Usage (Git Bash, from the repo):  deploy/publish-public.sh <noreply-email> [output-folder]
#   e.g. deploy/publish-public.sh 12345678+crkayes@users.noreply.github.com ../snap-convert-public
# Then follow docs/launch/checklist.md step 9 to push the output folder to the empty GitHub repo.
set -euo pipefail

NOREPLY="${1:?usage: deploy/publish-public.sh <github-noreply-email> [output-folder]}"
case "$NOREPLY" in
  *@users.noreply.github.com) ;;
  *) echo "Expected a GitHub noreply address (…@users.noreply.github.com), got: $NOREPLY" >&2; exit 1 ;;
esac
SRC="$(git rev-parse --show-toplevel)"
# Every email used in the private history (read here, never written into this file).
OLD_EMAILS="$(git -C "$SRC" log --format='%ae%n%ce' main | sort -u | grep -v -x -F "$NOREPLY" || true)"
OUT="${2:-$SRC/../snap-convert-public}"
if [ -e "$OUT" ]; then echo "$OUT already exists — remove it or pick another folder" >&2; exit 1; fi

git clone --quiet --no-local --single-branch --branch main "$SRC" "$OUT"
cd "$OUT"
git remote remove origin
git config user.email "$NOREPLY"

export NOREPLY
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force --prune-empty \
  --env-filter 'export GIT_AUTHOR_EMAIL="$NOREPLY" GIT_COMMITTER_EMAIL="$NOREPLY"' \
  --index-filter '
    git rm -r --cached --ignore-unmatch --quiet prompts prototype CLAUDE.md
    git ls-files docs | grep -vE "^docs/launch/(headers\.md|checklist\.md|screenshots/)" \
      | while IFS= read -r f; do git rm --cached --quiet -- "$f"; done
  ' -- main >/dev/null

# Drop the filter-branch backup and anything unreachable, so no old object survives in the copy.
git for-each-ref --format='%(refname)' refs/original/ | xargs -r -n1 git update-ref -d
git reflog expire --expire=now --all
git gc --quiet --prune=now --aggressive

# Checks: no private folders, no other email anywhere in the history.
fail=0
if git log --format='%ae%n%ce' | grep -v -x -F "$NOREPLY" | grep -q .; then
  echo "FAIL: a commit still has another email" >&2; fail=1
fi
if git rev-list --objects --all | grep -E ' (prompts|prototype)/| CLAUDE\.md$' | grep -q .; then
  echo "FAIL: private files are still in the history" >&2; fail=1
fi
while IFS= read -r old; do
  [ -n "$old" ] || continue
  if git grep -n -F "$old" $(git rev-list --all) -- . >/dev/null 2>&1; then
    echo "FAIL: a private email appears in a file in the history" >&2; fail=1
  fi
done <<< "$OLD_EMAILS"
[ "$fail" -eq 0 ] || exit 1

echo "Public copy ready: $OUT"
echo "  commits: $(git rev-list --count main)   files: $(git ls-files | wc -l)"
echo "Next: docs/launch/checklist.md step 9 (add the GitHub remote, push, check CI)."
