# ALGO-013 — STOP READING ALGO-012 §3. The X-ray ranked by its own rule; every number moved.

**Strategy head:** `3cbdb752a503` (pushed, verified by `ls-remote`) · PR #38 **OPEN / DRAFT / DO
NOT MERGE** · no semantic file modified · the §9 grader is running, semantics still not started.

You are mid-ruling on ALGO-012. Its §3 figures are retracted. Read this first.

---

## 1. What is wrong

`xray_session` had its own ranking step instead of calling `kernel._rank_and_yield`. It diverged
from the machine that trades in four ways:

| # | the X-ray did | the kernel does |
|---|---|---|
| a | kept `survivors[0]` — **list order**, Route A appended first | takes the **max** by `(BRK5=3 > BRK15=2 > REV=1, location.quality, location.confluence)` |
| b | granted one anyway when both directions had candidates | **yields nothing** — `len(set(directions)) != 1` returns `None` |
| c | no decision-clock `LAST_ENTRY` cutoff | refuses `actionable.time() > LAST_ENTRY` |
| d | demoted by scanning **all accumulated records** for a tag | — |

(a) is the worst: Route A is `REV`, the **lowest** rank. Whenever a breakout coexisted with a
reversal, the X-ray recorded the **opposite winner** from the one that trades. (d) let a later
clock retroactively revoke an earlier clock's winner.

---

## 2. Retraction — ALGO-012 §3

| | published | measured |
|---|---|---|
| raw observations | 315 | **167** |
| deduplicated episodes | 177 | **101** |
| episodes per session | 12.6 | **7.2** |
| uncensored ratio | 15.1 : 1 | **8.6 : 1** (60 vs 7) |
| Route A share | 152 of 177 (86%) | **73 of 101** |
| Route C / Route D | 1 / 18 | **0 / 22** |

Route D rising while Route A falls is the ranking fix showing up exactly where it should:
breakouts now win the clocks they always won in production.

**I overstated permissiveness by roughly three quarters.** Your §5B conclusion that Route A
dominates **survives** — it is still the largest route — but at a smaller magnitude, and every
figure I gave for it is replaced above.

This is the **third** wrong number I have published in two days, after the 0/14 field-name
mismatch and the 9/14 session-vs-window join. All three were **instrument** defects. All three
were caught by a **control**, never by reading the code.

---

## 3. How it was caught, and why the existing test did not

Not by review. I built a new Route A mirror for the ablation below and gave it a positive
control: it must reproduce the X-ray's survivor tag multiset. It refused at the first session —
`MIRROR_DIVERGED_FROM_XRAY`, 10 extra grants. The mirror was right.

`test_the_xray_consults_every_gate_the_kernel_consults` passed throughout because it compares
against a **hand-maintained `SHARED_GATES` tuple, and `_rank_and_yield` was not in it.** A pinned
population that nothing checks for completeness certifies only itself. It is in the tuple now.

**Fixed at source:** the X-ray now *calls* `_rank_and_yield`. That is what its own docstring
already promised and had not done for the ranker. The ablation runner does not re-walk the loop
either — it hooks `xray_session(on_rejection_candidate=...)`, so there is exactly one loop.

**Red-proofed, 5 arms**, each with a positive witness that it was GREEN before mutation and each
restored byte-exactly (SHA256 + `git status`; the kernel ends clean): list-order ranker ·
rescanning demotion · REV ranked above BRK5 · veto removed · cutoff removed. All five go RED and
return GREEN. Suite **12 failed / 1010 passed**; the same 12 fail at the parent commit in a clean
worktree with 1005 passed — FAILED set unchanged, the +5 is these tests.

---

## 4. §5B is now measured at source, and it is a regression, not a design choice

`core.Story.complete` is `approach AND fight AND decision`. **v2.2 `reversal_story` derives all
three from price. v2.4 `reversal_story_v24` returns `approach=True` and `takeover=True` as
unconditional literals** (`entries.py:168,174`) and rebuilds the rest from weaker material.
`takeover` is not read by anything — asserted *and* unused. The commit that introduced it,
`dc67a9b4`, has **no body**, so no rationale is recorded either way.

Restoring each dropped v2.2 requirement **alone**, over the 128 Route A grants on the frozen
corpus:

| restored requirement | kills | of 128 |
|---|---|---|
| **R6 `displacement` required in `decision`** | **108** | **84.4%** |
| R1 `approach` derived from 5-bar travel | 82 | 64.1% |
| R3 `reclaim` requires a turn vs prior close | 53 | 41.4% |
| R4 wick rejection required, not 1-of-4 | 49 | 38.3% |
| R2 `reclaim` at zone **mid**, not edge | 7 | 5.5% |
| R5 `follow` anchored at zone mid | **0** | 0.0% |
| **all six restored** | **124** | **4 of 128 grants survive** |

Three honest caveats, all load-bearing:

1. **These overlap and are not additive** — 82+53+49+108 far exceeds 128. Each is a marginal
   single-restore kill.
2. **R5 kills nothing on this corpus.** A real negative result, reported as one.
3. **v2.2 is the prior implementation, not the teacher.** Nothing here shows any restored
   requirement is what the trader means. It sizes the changes; it does not adjudicate them.

The largest single loss is **`displacement`, not the hardcoded literal** I led with in my
previous commit. I had the emphasis wrong before I measured it.

---

## 5. One thing I found and did not resolve

The kernel builds **`BRK15`** candidates from a pending weak-break 15m continuation path
(`kernel.py` ~line 245). The X-ray's `LEGAL_ROUTES` has four routes and none of them is `BRK15`.
Whether `BRK15` is a fifth route, or a variant of `B_NORMAL_BREAKOUT`, is genuinely ambiguous
from ALGO-009 §3, and I am not going to invent the answer. It affects ranking, so it may move
these numbers again. **`UNRESOLVED_SOURCE_AMBIGUITY` — your call.**

---

## 6. What I want from you

1. **Re-rule on §8 with the corrected numbers.** 8.6:1 may or may not carry the weight 15.1:1 did.
2. **Rule on BRK15** (§5 above).
3. **§9.2 is still open** — the independent DISPROVE grade of the repaired evaluator is running
   now that the weekly quota reset. Semantics remain not started, per your §9.

I did not wait for a ruling to fix the X-ray: it is a diagnostic file, the numbers in front of
you were wrong, and leaving them standing while I did anything else was the worst option.

**No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this packet.**
