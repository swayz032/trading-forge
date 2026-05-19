#!/usr/bin/env bash
# Snapshot the previous-version of each refactored prompt for the A/B harness.
#
# Pass 3 Branch C, Scout Architecture Fix (2026-05-04).
#
# Branch A refactored 3 existing prompts to the 4-block structure (PROMPT_VERSION: 2).
# This script grabs the PROMPT_VERSION: 1 / pre-refactor copy from `git show HEAD~1`
# so prompt-ab-test.mjs has a baseline to compare against.
#
# The 3 NEW prompts (scout-auditor, dsl-quality-critic, transcript-extractor) have
# no prior version — the harness detects their absence and runs them as smoke tests
# instead of A/B comparisons.
#
# Idempotent: re-running overwrites prior snapshots from the same commit. Safe to
# re-run after every git operation (rebase, merge) so the baseline stays aligned.
#
# Usage:
#   bash scripts/snapshot-old-prompts.sh           # default: HEAD~1
#   OLD_REV=HEAD~5 bash scripts/snapshot-old-prompts.sh
#
# Exit codes: 0 ok, 1 git failure, 2 not in a git repo.

set -euo pipefail

OLD_REV="${OLD_REV:-HEAD~1}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/tmp-n8n/old-prompts"

if [ ! -d "$ROOT/.git" ]; then
  echo "ERROR: $ROOT is not a git repo (no .git dir)" >&2
  exit 2
fi

mkdir -p "$OUT_DIR"

# 3 prompts that Branch A refactored — these have a prior version worth comparing.
PROMPTS=(
  "src/agents/critic-evaluator.md"
  "src/agents/strategy-proposer.md"
  "src/agents/nightly-self-critique.md"
)

cd "$ROOT"

failures=0
for p in "${PROMPTS[@]}"; do
  base="$(basename "$p")"
  if git show "$OLD_REV:$p" > "$OUT_DIR/$base" 2>/dev/null; then
    echo "  snapshot: $base ($(wc -c < "$OUT_DIR/$base") bytes)"
  else
    echo "  WARNING: $base not found at $OLD_REV — skipping (harness will treat as new)" >&2
    rm -f "$OUT_DIR/$base"
    failures=$((failures + 1))
  fi
done

if [ $failures -eq ${#PROMPTS[@]} ]; then
  echo "ERROR: no prompts could be snapshotted from $OLD_REV — abort" >&2
  exit 1
fi

echo "Old prompts snapshotted from $OLD_REV into $OUT_DIR"
echo "Run: node scripts/prompt-ab-test.mjs"
