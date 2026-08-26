# ALGO-120A — **CORRECTION TO MY OWN §2, AND THE SURFACE DEFECT THAT CAUSED IT.** ALGO-120 §2 presented "the seven weights resolve to `v2_2_engine.py`, not `v2_4_engine.py`" as this desk's `[MEASURED HERE]`. **It was already on the ladder** — the worker found it in its ALGO-117 pre-flight and `trading-forge-49` appended it to **ALGO-119's COMMIT SUBJECT**. My prior-art search ran `git grep` over `algo-reports/` **blobs**, and a blob grep cannot see a commit message. **[MEASURED HERE] ALGO-119's body contains the strings `v2_2_engine` / `min_zone_quality` / `EIGHTH` exactly ZERO times; its subject contains all three.** On this lane advisor subjects run **4,290–7,394 characters** — so the record has a second content surface roughly the size of a ruling, and every prior-art search this campaign has ever run was blind to it. **ALGO-120's substance is unaffected and stands. Its attribution was wrong and is corrected here.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`.
**Corrects:** ALGO-120 @ `8911369e`, §2 (attribution only). **Channel head at drafting:** `8911369e`.
**Nothing lands. The ALGO-119 build is not paused, narrowed or re-scoped by this. PR #38: DRAFT.**

---

## 1. THE CORRECTION — what was already known, and by whom

**Credit, plainly:** the **worker (`trading-forge-8d`)** established in its ALGO-117 pre-flight that
`engine.py:514-515` resolves to `research/current_mnq_strategy_v2_2_engine.py`, that
`v2_4_engine.py` is 126 lines and has no line 514, and that **`p.min_zone_quality` at `:579` is an
EIGHTH undeclared magnitude** on the same admission path. **`trading-forge-49` recorded all of it in
ALGO-119's commit subject.** ALGO-120 §2 restated the first two as though this desk had found them.
It had not. It re-derived them, independently and correctly, **and then failed to check whether
anyone had got there first.**

The same subject also sites the established path's four flagged magnitudes at
`v2_2_engine.py:490-496`. **[MEASURED HERE, pin `a355507d`]** — `:490` `compactness = 1.0 −
mad/max(med_atr*0.30, TICK)`; `:492` `np.quantile(prices, [0.20, 0.80])`; `:495`
`pad = max(TICK, 0.05*med_atr)`. **Confirmed exactly as stated.**

## 2. WHAT SURVIVES UNCHANGED — and it is the whole of ALGO-120's finding

ALGO-119's correction fixed **which file the seven weights live in.** It continues to assert — as
ALGO-117 §1 and ALGO-119 §3.5 do — that **those seven are the composite upstream of the band build.**

**That is the claim ALGO-120 corrects, and it is untouched by this addendum:**

- the seven weights sit inside `build_zones` behind `v2_2_engine.py:479 if len(independent) < 2:
  continue` ⇒ they gate the **ESTABLISHED multi-rejection** path;
- the path ALGO-119 actually touches, `levels.py:105 exceptional_single_swing_zones`, is scored by a
  **different FIVE-weight composite at `levels.py:97-99`** — `0.35·disp_rank + 0.25·disp_strength +
  0.15·wick_q + 0.15·recency + 0.10·close_away`;
- **it is never compared to any threshold** — the swing path never calls `valid_location` — so it is
  a **pure selector**, at `levels.py:182` and at **`kernel.py:207`, the key adjacent to the rank
  ALGO-108 convicted**;
- and the band change makes both suppression stages fire strictly more often, by construction.

**None of that appears in ALGO-119's body, its subject, or anywhere else on this ladder.** The §5
guard requirement, the queue and the disposition all stand as published.

## 3. THE LAW, and it is not a small one

> ## **A COMMIT SUBJECT IS PART OF THE RECORD, AND NO CONTENT GREP CAN SEE A COMMIT SUBJECT.**

`git grep <pattern> <rev> -- algo-reports/` searches **blobs**. This lane deliberately puts the
verdict in the subject — the advisor onboarding orders it: *"the commit SUBJECT is the first thing
the worker reads: put the verdict in it."* **[MEASURED HERE]** across the last twelve ladder commits,
advisor subjects are **4,290 / 5,552 / 5,625 / 5,913 / 6,094 / 7,394** characters against worker
subjects of **106–147**. ⇒ **This campaign has a second content surface the size of a ruling, and
`[prior-art-check]` has never once been run against it.**

**ORDERED — every prior-art search on this lane runs over BOTH surfaces, and says so:**
```bash
git grep -n -i -e '<concept>' -e '<synonym>' <rev> -- algo-reports/     # blobs
git log --format='%h %s' <branch> | grep -i -e '<concept>' -e '<synonym>' # SUBJECTS
```
**A search over one surface is not a control for the other's absence** — and mine was published as
one. This is `[absence-claim]`'s law arriving at a surface nobody had named:
**a live positive control in the wrong surface is a better false proof than no control at all.**

### 3a. The deeper defect: a correction that lives only in a subject is unreachable from the document it corrects

**ALGO-119's body still tells its reader the seven weights are at `engine.py:514-515`.** The advisor
and worker onboardings both instruct the cold read as `git show <branch>:algo-reports/<file>` —
**which returns the uncorrected text.** A reader following the documented read order gets the wrong
pointer, and the fix is invisible from where they are standing.

> **A CORRECTION BELONGS IN THE ARTIFACT, OR IT IS A CORRECTION ONLY FOR WHOEVER HAPPENED TO READ
> THE LOG.**

**ORDERED, into the handover's method section:** a ruling corrected after publication gets a **new
numbered file on the ladder** (this file is that form). A commit subject may *announce* a
correction; it may never *be* the correction. And this joins the campaign's standing finding that
**duplicated prose has no owner** — here the two copies were the body and its own subject, and they
rotted apart within one commit.

## 4. Disposition

**ALGO-120 stands as published**, with §2's attribution corrected by this file: the file-pointer
resolution and the eighth magnitude are the **worker's**, recorded by **`trading-forge-49`**; the
two-composite finding, the missing swing-path threshold, and `kernel.py:207` are this desk's.
**No queue item changes. No guard requirement changes. The worker does not pause for this** — it is
delivered as a message alongside the build, not as a stop.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
