# ALGO-040 — Grader check DISCHARGED: no verdict, and it is NOT the ALGO-019 shape. Two leads verified; one is a censoring asymmetry worth 5/8 vs 5/5.

**Strategy head:** `ea6f0940` (pushed, verified by `ls-remote`) · PR #38 **DRAFT / DO NOT MERGE**
· still **BUILD ONLY** · kernel/entries/force/engine **byte-identical to `068bb24a`**.

---

## 1. The ordered check — done, and the answer is "still running out of road", not "finished"

The grader ran as a **subagent of my own session**:
`…/84d6e39c-…/subagents/agent-agrader-regrade-post-F1-fa295ba1897b12b1.jsonl`, 99 lines,
05:11:45Z → **05:18:53Z**.

**It did not finish.** Its final line is a work-in-progress note, mid-probe. ALGO-019's grader
had FINISHED and failed to render; **this is a different shape** — there is no verdict sitting
anywhere to ingest. **No output received. Not failed.** No re-dispatch, per your order.

It got as far as: pin `4d786333ccee` confirmed == HEAD, tree clean, semantic files confirmed
byte-identical, evaluator surface mapped. Then two findings, both of which I **verified myself
rather than adopting on authority**.

---

## 2. LEAD 1 — confirmed. A real mirror drift in my X-ray, with zero measured impact

> *"the kernel clears `pending` when a BRK5 fires on the same key; the X-ray does not"*

True at source. `kernel.py` pops the pending weak-break entry the moment a BRK5 candidate is
appended. The X-ray's BRK5 block never did — it never even computed the key. A pending left
alive can emit a **BRK15 candidate the kernel would never produce**.

**Measured impact: zero.** No BRK15 candidate survives on this corpus, so nothing published
moves — I re-measured ALGO-036's "kernel granted 39" rather than assuming it. A **latent**
divergence, which is exactly when fixing one is cheap.

**And the correspondence test was structurally blind to it.** It mirrors which gates get
CALLED; `pending.pop` is shared mutable STATE, not a gate. So I closed the class, not the
instance: a derived census of every method invoked on the shared pending dicts in both files,
asserted **equal**.

    kernel   pending.pop 4 · pending_locs.pop 4 · setdefault 1/1
    x-ray    pending.pop 3 …  before          pending.pop 4 …  after

With a red-proof that deletes exactly that pop from a copy of the source and asserts the
censuses then disagree, plus a not-vacuous test — a derived census that returns `{}` passes any
comparison against another `{}`.

---

## 3. LEAD 2 — confirmed, LARGER than the grader said, and it needs your ruling

> *"prose selects 8, flags select 6 — the two extras are 04-02 and 04-09"*

**The censoring is asymmetric.** A trader who never rendered a decision is excluded from both
numerator and denominator — the F-1 repair, and right. A **bot** that never rendered one
in-window, because its daily bullet was spent before the window opened, is **left in the
denominator and scored as a disagreement**. The same argument that excuses one excuses the
other.

Measured, it is **three** sessions, not two: **03-23, 04-02 and 04-09** all carry
`BUDGET_CONSUMED_BEFORE_WINDOW`. Had I hand-typed the grader's pair I would have inherited its
count and never found the third — so the artifact **derives** the list and a test re-checks
every named session against its own record.

| reading | headline |
|---|---|
| as published — bot unavailability counts against it | **5 / 8** |
| bot-side censored symmetrically with the trader | **5 / 5** |

**I am not adopting the second.** It raises the fidelity number, and **a party may not adopt
the reading that flatters it**; your ALGO-037 rule — stricter reading wins while the textbook is
silent — points the same way. The headline stays **5/8**.

What changed is that the choice is now **visible in the artifact** instead of implicit, with
tests pinning both numbers so the published one cannot quietly become the flattering one, and
the diagnostic cannot quietly vanish. One test asserts the two readings still **disagree** — if
they ever converge this is dead paperwork and should be deleted rather than carried.

**→ This is the ruling I need.** Is an unavailable bot a real failure that must count, or is
non-decision non-decision on both sides?

**Either way, `bot_genuinely_declined_in_window_count` is still 0.** The entry decision remains
a constant, and no censoring convention changes that.

---

## 4. Queue

Grader check **discharged** (no verdict; still waiting, no re-dispatch). Window amendment still
waits on the grade → exam → FREEZE. Standing positive witnesses for Route C and BRK15 are
pinned in their test files; the `acceptance_bars` {1,2,3} sensitivity is exam-time and
pre-registered by your ALGO-037 ruling 1.

Suite **7 failed / 1445 passed**, enumerated; same 7, all outside this lane. **No PnL, realized
outcome, winner/loser label or clean-edge result participated in any decision in this packet.**
