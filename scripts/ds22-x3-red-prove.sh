#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deep-scan #22 Track X3 (cap-closer Y3) — RED-proof for the Slumhouse
# no-fabrication render harness (render-layer-no-fabrication.test.ts).
#
# The harness comment promised THIS script. It is the failure-injection proof
# that the anti-fabrication lock actually catches a reinjected random shape —
# a passing test file proves nothing on its own unless a mutation makes it fail.
#
# What it does:
#   1. Copies public/slumhouse → an isolated scratch temp dir (never mutates the
#      shipped tree).
#   2. Reinjects a `Math.random()` shape into TWO currently-clean render fns on
#      the COPY:
#        A. progress-line.js  renderProgressLine  — the gate-meter fill width
#           (`pctFor(gates)` → `pctFor(gates) + Math.random()`).
#        B. slumhouse.js      potChart            — the liquid-level geometry
#           (`count/28` → `count/28 + Math.random()`).
#   3. Re-runs the harness against `SLUMHOUSE_PUBLIC_DIR=<scratch>` (the test
#      file honors that env override) and asserts the suite goes RED — both
#      determinism locks (and the tree-wide RNG-confinement audit) must trip.
#   4. Cleans up the scratch dir.
#
# Exit 0  ⇢ RED was produced → the lock works (PASS).
# Exit 1  ⇢ the harness stayed GREEN despite injected RNG → the lock is broken.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/public/slumhouse"
TEST_FILE="$ROOT/src/server/__tests__/slumhouse/render-layer-no-fabrication.test.ts"
VITEST="$ROOT/node_modules/vitest/vitest.mjs"

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/ds22-x3-redprove.XXXXXX")"
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT

INJ="$SCRATCH/slumhouse"
cp -r "$SRC_DIR" "$INJ"

echo "── ds22-x3 RED-proof — scratch: $INJ"

# ── Injection A: progress-line.js gate-meter fill width ──────────────────────
# The width is `pctFor(gates)%` (deterministic). Turn it into a re-randomizing
# shape; renderProgressLine's determinism lock + the tree RNG audit must trip.
perl -0pi -e 's/\+ pctFor\(gates\) \+/+ (pctFor(gates) + Math.random()) +/g' "$INJ/progress-line.js"

# ── Injection B: slumhouse.js potChart liquid level ──────────────────────────
# `Number(count || 0) / 28` drives the liquid rect geometry; perturbing it breaks
# potChart's collectGeometry determinism lock + the tree RNG audit.
perl -0pi -e 's{Number\(count \|\| 0\) / 28}{(Number(count || 0) / 28 + Math.random())}g' "$INJ/slumhouse.js"

# Sanity: confirm both injections actually landed (fail loudly if the source
# shifted out from under the sed patterns).
INJECTED=0
grep -q "pctFor(gates) + Math.random()" "$INJ/progress-line.js" && INJECTED=$((INJECTED + 1)) || echo "!! injection A did not apply"
grep -q "/ 28 + Math.random()" "$INJ/slumhouse.js" && INJECTED=$((INJECTED + 1)) || echo "!! injection B did not apply"
if [ "$INJECTED" -ne 2 ]; then
  echo "FAIL: could not inject into both render fns (source patterns drifted) — fix the sed patterns."
  exit 1
fi
echo "── injected Math.random() into 2 clean render fns (progress-line width + potChart level)"

# ── Re-run the harness against the injected copy ─────────────────────────────
cd "$ROOT"
LOG="$SCRATCH/out.log"
SLUMHOUSE_PUBLIC_DIR="$INJ" node "$VITEST" run "$TEST_FILE" >"$LOG" 2>&1
STATUS=$?

echo "── harness exit status against injected copy: $STATUS"

if [ "$STATUS" -ne 0 ]; then
  echo
  echo "PASS: the no-fabrication lock went RED on the reinjected random shapes."
  echo "Failing assertions (evidence):"
  grep -E "FAIL|✗|×|expected|AssertionError" "$LOG" | grep -iE "progress-line|potChart|width|geometry|random|id-string|confined" | head -12
  echo
  echo "(full log: $LOG — cleaned up on exit)"
  exit 0
fi

echo
echo "FAIL: harness stayed GREEN despite injected Math.random() shapes — the lock is broken."
cat "$LOG"
exit 1
