# ERRATUM — the freeze document's PIN TABLE and its two MEDIANS

**R-463 §3(b) and §3(c) · 2026-07-29 · AR-451 · ADDITIVE. Nothing in the frozen artifact was altered.**

> **CORRECTS:** `docs/designs/SHADOW-EVAL-FREEZE-AND-RESULTS-2026-07-29.md` — the
> **INSTRUMENTS, sha256** table under *STEP 1 — THE FREEZE*, and two median figures.
> ★★★ **Its bytes are untouched. This is a second document that points at the first.**
> Companion to `SHADOW-EVAL-PARTITION-ERRATUM-2026-07-29.md`, which corrects the `DEV-14` list.

---

## 1 — THE PIN TABLE IS **OVER-** AND **UNDER-INCLUSIVE AT ONCE**

### (i) UNDER-INCLUSIVE — 40 engaged runtime inputs are absent

★★★★★ **`shadow.ts:20` opens a per-video transcript for every one of the 40 videos, from a
GITIGNORED `tmp/generalization/` path. Forty files the run demonstrably READ are named nowhere
in the freeze table.**
★★★ **CONSEQUENCE, and it is not cosmetic: a differing re-run output could have come from
transcript drift, and the five pinned items could not have distinguished that from harness
non-determinism.** That is why AR-448's attribution sentence was withdrawn (see §3 below).

**NOW PRESERVED** — bytes, not fingerprints — at
`backups/h1-shadow-eval/transcripts-78fe8ea7/`, manifest hash
`78fe8ea72a82cc9e4c7cc456cf8b7dbcd5a74338d409bc10948871fde54c844b`, 40 files / 913,668 bytes.
★★★★★ **It is a `2026-07-29 FORWARD BASELINE` and may NEVER be backdated into evidence for the
original run: whether today's bytes equal the original's is `[UNRECOVERABLE AT ORIGIN]`.**

### (ii) OVER-INCLUSIVE — `graph-to-engine.ts` is pinned but never loaded

★★★★★ **[MEASURED HERE, traced at the line rather than relayed] the harness never loads it —
not directly, not transitively:**

| | |
|---|---|
| `shadow.ts` runtime imports | `node:fs` · `clause-segmenter.ts` · `gate-strength.ts` — **and the string `graph-to-engine` does not occur in the file at all** |
| `gate-strength.ts` imports | **exactly one**: `import type { AtomType } from "./decision-atom.js"` — ★★ **TYPE-ONLY, erased at compile time, loads nothing at runtime** |
| `clause-segmenter.ts` imports | ★ **none** |

★★★★★ **AND THE TRAP THAT WOULD HAVE PRODUCED THE OPPOSITE ANSWER: `grep -n graph-to-engine
gate-strength.ts` returns **TWO HITS**, at `:7` and `:45` — and BOTH ARE INSIDE A `/* */`
COMMENT BLOCK describing what the classifier *replaces*.** ★★★ **A grep matching only comments
is not a verification. The import list is the executable claim; the prose is not.**

### ★★★ THE LAW THIS TABLE BREAKS IN BOTH DIRECTIONS

> **PIN COUNT IS NOT DEPENDENCY COVERAGE.** Five pins prove five things were pinned. They never
> prove five is all there were, and they do not establish that any pinned item was engaged.
> **A freeze table owes an ENGAGEMENT-DERIVED membership rule — what the process opened — not a
> maintained list and not an import closure.**

---

## 2 — THE TWO MEDIANS

**Published: `10.7%` (DEV-14) and `3.8%` (HOLDOUT-26). ★★ Both are wrong in the first decimal.**

| population | videos | **recomputed median per-video fired rate** | published |
|---|---:|---:|---:|
| `DEV14` | 14 | ★ **10.6%** (`10.6203…`) | 10.7% |
| `HOLDOUT26` | 26 | ★ **3.6%** (`3.6229…`) | 3.8% |

★★★ **TWO INDEPENDENT PATHS, and they agree to 12 decimal places:** `statistics.median` over the
per-video rates, and a hand-computed median off the sorted list with no library. **Both run
against the RETAINED `shadow_rows.json`.** ★★ Independently corroborated by the grader and, on a
third path, by the external read.

### WHY CORRECT A NUMBER THAT CHANGES NOTHING

★★★★★ **These are descriptive statistics. They are NOT among the seven headline totals, and the
`2.75×` contamination signature and the VOID verdict hold on either value — those rest on the
POOLED rates (`11.3%` vs `4.1%`), which are correct and re-derived.** ★★★ **They are corrected
anyway, because a number that is quietly wrong teaches the next reader that quiet wrongness is
tolerated here.**

---

## 3 — WHAT STANDS, RESTATED SO THIS ERRATUM IS NOT MISREAD AS A COLLAPSE

★★★★★ **The grade is `SOUND-WITH-GAPS`. The seven headline totals, the `2.75×` signature, the
VOID finding and the corrected `HOLDOUT-26` covenant ALL STAND. Circularity, stale-output
leakage, comparator validity and current-state determinism are CLOSED.**

**The one honest, permanent gap** is stated in R-463 §1 and reproduced here in the form that may
be quoted:

> **The preserved harness reproduced the frozen output BYTE-FOR-BYTE using the PINNED code/split
> inputs AND TODAY'S TRANSCRIPT FILES.**

★★ **Not "historically sealed." "Currently reproduced; original transcript identity unprovable."**
