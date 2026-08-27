#!/usr/bin/env bash
# Publish one ALGO-project report to the GPT advisor branch reserved for the algo project.
#
# ─────────────────────────────────────────────────────────────────────────────────────────
# WHY THIS IS A SEPARATE BRANCH AND NOT A SUBDIRECTORY.  [MEASURED 2026-08-21]
#
# The main Trading Forge control plane is authorized by exactly one mechanism: a
# CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1 marker in the NEWEST ruling on
# origin/external-advisor/gpt-rulings.  scripts/control-plane-bootstrap/bootstrap.mjs
# measures that as:
#
#     git show --name-only <head of external-advisor/gpt-rulings>
#       |> filter(path.startsWith('advisor-reports/') && path.endsWith('.md'))
#       |> if (changed.length === 1) -> that file IS the newest ruling
#
# and authorization.mjs then refuses with `stale_authority` when the marker's ruling is not
# that newest ruling.
#
# `startsWith('advisor-reports/')` MATCHES SUBDIRECTORIES.  So publishing an algo report to
# advisor-reports/algo/ on that branch would make the algo report the newest ruling and
# BREAK the main project's control-plane seat until GPT published again.  A subdirectory is
# not isolation.  A separate branch is.
#
# THREE INDEPENDENT SEPARATIONS, so no single mistake mixes the two projects:
#   1. BRANCH     external-advisor/gpt-rulings-algo   (never ...gpt-rulings)
#   2. DIRECTORY  algo-reports/                       (never advisor-reports/)
#   3. NUMBERING  ALGO-NNN                            (never AR-NNNN)
#
# (3) matters on its own: bootstrap.mjs extracts a ruling id with /AR-\d{3,5}[A-Z]?/, so an
# ALGO-NNN basename cannot be mistaken for a Trading Forge ruling even if a file is one day
# copied to the wrong branch by hand.
# ─────────────────────────────────────────────────────────────────────────────────────────
#
# USAGE:  scripts/publish_algo_report.sh <path-to-report.md> "<commit subject line>"
#
# The commit subject IS the first thing GPT reads. Make it self-contained.

set -euo pipefail

BRANCH="external-advisor/gpt-rulings-algo"
DIR="algo-reports"
FORBIDDEN_BRANCH="external-advisor/gpt-rulings"

REPORT="${1:?usage: publish_algo_report.sh <report.md> <subject>}"
SUBJECT="${2:?usage: publish_algo_report.sh <report.md> <subject>}"
BASENAME="$(basename "$REPORT")"

[ -f "$REPORT" ] || { echo "REFUSE: no such file: $REPORT" >&2; exit 1; }

# ── Guard 1: the numbering namespace must be ALGO-NNN, never AR-NNNN ───────────────────────
case "$BASENAME" in
  ALGO-[0-9][0-9][0-9]*.md) : ;;
  *) echo "REFUSE: filename must start ALGO-NNN and end .md — got '$BASENAME'." >&2
     echo "        AR-NNNN belongs to the main Trading Forge sequence and must not be reused." >&2
     exit 1 ;;
esac
if printf '%s' "$BASENAME" | grep -qE 'AR-[0-9]{3,5}'; then
  echo "REFUSE: '$BASENAME' contains an AR-NNNN token." >&2
  echo "        bootstrap.mjs would parse that as a Trading Forge ruling id." >&2
  exit 1
fi

# ── Guard 2: never write into advisor-reports/, on any branch ─────────────────────────────
TARGET="$DIR/$BASENAME"
case "$TARGET" in
  advisor-reports/*) echo "REFUSE: target is inside advisor-reports/ — that is the main project's namespace." >&2; exit 1 ;;
esac

# ── Guard 3: re-fetch and read what moved before building the commit ──────────────────────
# The ruling that invalidates your report arrives while you are writing it.
git fetch -q origin "$BRANCH" 2>/dev/null || {
  echo "NOTE: $BRANCH does not exist yet on origin — seeding it from the GPT rulings branch."
  git fetch -q origin "$FORBIDDEN_BRANCH"
}
BASE="$(git rev-parse FETCH_HEAD)"
echo "base: $BASE"
echo "--- files changed in that head commit (must not be a Trading Forge ruling) ---"
git show --name-only --pretty=format:'    %h %s' "$BASE" | head -6

# ── Guard 4: refuse if BASE is somehow the main rulings branch head ────────────────────────
MAIN_HEAD="$(git ls-remote origin "refs/heads/$FORBIDDEN_BRANCH" | cut -f1)"
if [ -n "$MAIN_HEAD" ] && [ "$BASE" = "$MAIN_HEAD" ] && git rev-parse --verify -q "origin/$BRANCH" >/dev/null; then
  echo "REFUSE: base resolved to the MAIN rulings head while the algo branch exists." >&2
  exit 1
fi

# ── Build the commit by plumbing: touches no working file, no index, no HEAD ───────────────
BLOB="$(git hash-object -w "$REPORT")"
export GIT_INDEX_FILE="$(mktemp -u)"
rm -f "$GIT_INDEX_FILE"
git read-tree "$BASE"
git update-index --add --cacheinfo "100644,$BLOB,$TARGET"
TREE="$(git write-tree)"
COMMIT="$(printf '%s\n' "$SUBJECT" | git commit-tree "$TREE" -p "$BASE")"
unset GIT_INDEX_FILE   # LOAD-BEARING: a stale GIT_INDEX_FILE makes the pre-push hook read
                       # the wrong index and blame an innocent file (.pre-commit-config.yaml).

echo "commit: $COMMIT"
git push origin "$COMMIT:refs/heads/$BRANCH"

# ── Verify by reading it back from origin, WITH a negative control ─────────────────────────
git fetch -q origin "$BRANCH"
git show "FETCH_HEAD:$TARGET" >/dev/null \
  && echo "VERIFIED: $TARGET readable from origin/$BRANCH"
if git show "FETCH_HEAD:$DIR/ALGO-000-DOES-NOT-EXIST.md" >/dev/null 2>&1; then
  echo "REFUSE: negative control PASSED — the read proves nothing." >&2; exit 1
else
  echo "NEGATIVE CONTROL: a nonexistent path correctly fails — the read above is real."
fi

# ── Prove the main project's authority head was NOT disturbed ──────────────────────────────
NOW_MAIN="$(git ls-remote origin "refs/heads/$FORBIDDEN_BRANCH" | cut -f1)"
if [ "$NOW_MAIN" = "$MAIN_HEAD" ]; then
  echo "ISOLATION VERIFIED: $FORBIDDEN_BRANCH head unchanged at ${MAIN_HEAD:0:12}"
else
  echo "WARNING: the main rulings head MOVED during this publish (${MAIN_HEAD:0:12} -> ${NOW_MAIN:0:12})." >&2
  echo "         Not necessarily caused by this script, but read it before trusting anything." >&2
fi
