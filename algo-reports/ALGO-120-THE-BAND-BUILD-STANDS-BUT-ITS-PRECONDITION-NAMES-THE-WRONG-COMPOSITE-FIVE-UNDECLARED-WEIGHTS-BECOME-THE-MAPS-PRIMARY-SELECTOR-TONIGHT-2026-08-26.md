# ALGO-120 — **THE BAND BUILD STANDS. But the composite named as its precondition is the wrong one.** ALGO-116/117 §1 flagged **seven** undeclared quality weights as sitting upstream of this build. **[MEASURED HERE]** those seven gate the **ESTABLISHED multi-rejection** path. The family ALGO-119 authorizes — **exceptional single-swing** — is scored by a **different, FIVE-weight composite at `current_mnq_strategy_v2_4_levels.py:97-99`, declared nowhere, named nowhere on this ladder, and never compared to any threshold.** It is the tie-break in **two** selectors — the greedy same-side overlap suppression at `:182`, and `kernel.py:207`, **the adjacent key inside the very tuple ALGO-108 convicted for displacing eleven approvals.** Widening the band from ~2.4 pt to his 4–32 pt makes those overlaps the normal case instead of a rarity — **so this build promotes five dormant undeclared numbers into the primary selector of the level map.** ALGO-108's law, arriving *before* the approvals vanish instead of after. **Nothing about ALGO-119's scope changes. One bucket-attribution requirement is added to the guard so the exam is readable.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`, seated 2026-08-26 ~15:57 EDT,
succeeding `trading-forge-49` (Fable 5).
**Rules on:** the worker's in-flight ALGO-119 build, `trading-forge-8d`, tree
`C:/Users/tonio/Projects/wt-mnq-v24`. **Strategy pin for every line number below:
`a355507d`** (the working tree is mid-edit; its line numbers move, the pin does not).
**Channel head at drafting:** `f790af89` (ALGO-119). **PR #38: DRAFT / DO NOT MERGE.**
**DECISION: APPROVE — ALGO-119 proceeds unamended in scope, with one addition to its guard.**
**ALGO-118 is unused** (worker confirms it never drafted one; `ls-tree` confirms it never landed).
**Nothing lands from this desk. No question went to the operator.**

---

## 1. The operator's direction, and what it does and does not change

Operator to this desk, verbatim, 2026-08-26:

> *"THE GOAL IS TO ENGINEER THE BREAKTHORUGH SO WE CAN HEAD BACK TO BACKTEST, MONTE CARLO AND ETC
> WE NEED TO MAKE SURE WE FIND A EGDE BUT NO OVER FITTING YOU ARE MY ALGO MAKER"*

**It changes nothing about tonight's scope and everything about what the campaign is aiming at.**
The gate order stands: **FIDELITY → FREEZE → CLEAN EDGE**, and backtest/Monte-Carlo *is* the CLEAN
EDGE stage. §7 answers him: where the edge actually is, and the structural reason this route cannot
overfit. **ALGO-119's ANTI-OVERFIT clause is not relaxed by his urgency — it is the thing his
sentence is asking us to protect.**

---

## 2. THE FINDING — the precondition names the wrong composite  **[MEASURED HERE, pin `a355507d`]**

| | **ESTABLISHED** (multi-rejection) | **EXCEPTIONAL SINGLE-SWING** — *what ALGO-119 touches* |
|---|---|---|
| built by | `v2_2_engine.py:442 build_zones` | `levels.py:105 exceptional_single_swing_zones` |
| gated by | `:479 if len(independent) < 2: continue` | one pivot, by definition |
| quality composite | **`v2_2_engine.py:514-515` — SEVEN weights** `0.22·wick + 0.24·disp + 0.16·close_away + 0.16·compactness + 0.10·independence + 0.07·recency + 0.05·touch_sat` | **`levels.py:97-99` — FIVE weights** `0.35·disp_rank + 0.25·disp_strength + 0.15·wick_q + 0.15·recency + 0.10·close_away` |
| threshold applied | **YES, two** — `valid_location` `:576-581`: `quality < min_zone_quality (0.58)` → reject, then `confluence >= 1 or quality >= high_zone_quality` | **NONE.** The swing path never calls `valid_location`. |
| what quality does | **admits or rejects** | **ranks, and only ranks** — sole consumer is the sort key at `levels.py:182` |
| named on this ladder | ALGO-116, ALGO-117 §1 | **nowhere** |

**Reachability confirmed, not assumed:** `v2_4_engine.py:17 → v2_3_engine.py:15 →
v2_2_engine_final.py:16 → v2_2_engine`; and `levels.py:229` calls `core.build_zones` directly,
`:238-241` filters it through `core.valid_location`.

**ALGO-117 §1 was not wrong that the seven weights are upstream — it was incomplete and mis-sited.**
They *are* upstream, through one specific mechanism: `levels.py:152` drops any swing zone whose band
overlaps an established zone, and the seven weights decide which established zones exist. **So both
composites are upstream, by two different mechanisms — and the one nobody has named is the one this
build promotes.** ALGO-119 §3.5's *"a result in either direction is partly theirs"* is correct in
spirit and points at the smaller of the two.

**PRIOR ART — searched, and the search is stated so it can be checked.** `git grep` over
`algo-reports/` at `f790af89` for `disp_rank` · `disp_strength` · `sorted(out` · `levels.py:182` ·
`overlap suppression` · `five weights` / `5 weights`: **zero hits.** Every `0.35` hit on the ladder
is `reject_wick 0.35` — a different literal in a different file on Route D — read with context and
discarded, per **`SEARCHING A CORPUS FOR A BARE NUMBER IS NEARLY ALL NOISE`**. **The five-weight
composite and the `:182` suppression are new to this ladder.**

---

## 3. WHY IT MATTERS TONIGHT — the shape change is a selection change
**[MECHANISM. Direction PROVED by construction. Magnitude UNMEASURED and not to be guessed.]**

Two suppression stages sit downstream of the band, and **both get strictly more aggressive as the
band widens**:

- **STAGE 1 — `levels.py:152`:** swing band ∩ any established zone ⇒ **the swing zone is dropped
  outright**, before it is even scored.
- **STAGE 2 — `levels.py:182-186`:** greedy, `sorted(out, key=(-quality, -confluence, mid, id))`;
  any swing overlapping an already-chosen **same-side** swing is dropped. **The five weights are
  the tie-break, and there is no threshold above them.**

**The proof of direction is interval arithmetic, not a simulation.** Pre-change (`:149`, `:151`) the
band is symmetric: `half = max(TICK*4.0, key_level_pad_atr·atr)`, `lo,hi = center∓half` — so two
same-side supports at `a < b` overlap iff `b − a < 2·half ≈ 2.4 pt` at a 20-pt ATR. The ruled band on
support is `[low, close]`, so overlap iff `b − a < w_a` where `w_a = close − low`. Every admitted
pivot has already passed `wick >= p.min_wick` (0.20) measured **from the body edge**, so
`w_a >= 0.20 × range` — **strictly greater than 2.4 pt on any bar with range > 12 pt, and the
measured band range is 4–32 pt.** ⇒ **Both stages fire strictly more often after the change, on
every real bar, by construction.** How much more is **UNMEASURED**; that is what the guard is for.

### 3a. And they are a selector at a THIRD site — inside the one ALGO-108 already convicted  **[MEASURED HERE, pin `a355507d`]**

`current_mnq_strategy_v2_4_kernel.py:206-208`:

```python
rank = {"BRK5": 3, "BRK15": 2, "REV": 1}          # :205
cand = max(candidates, key=lambda c: (             # :206
    rank[c.setup], c.location.quality, c.location.confluence,   # :207
))
```

**ALGO-108 convicted the FIRST key of that tuple** — `BRK5 > REV` displaced eleven approvals in the
same bucket. **The SECOND key is `location.quality`, and for every swing location that is the
five-weight composite.** So when two candidates share a setup rank, **five numbers declared nowhere
break the tie and choose the trade.** Same tuple, adjacent key, never named.

⇒ **The five weights select at three sites, not one:** map membership (`levels.py:182`), route choice
(`kernel.py:207`), and — through Stage 1 — which swings exist at all. **The band change makes the
first of those hot; the third is already hot today.**

> **The five weights are dormant today only because 2.4-pt bands rarely collide. His band makes
> collision the normal case. This build does not change what the five weights are — it changes them
> from decoration into the map's primary selector.**

This is **ALGO-108's law reaching the site before the damage** instead of after it: *a proof about a
predicate says nothing about the pipeline that contains it; anything that SELECTS turns an addition
into a removal elsewhere.* There, eleven approvals vanished to a same-bucket rank displacement that
nobody predicted. Here the displacement mechanism is **named, sited and pre-registered**, and the
band's own a-priori table (F3) already concedes the premise — *"the fact that the ruled band is wider
and therefore overlaps more often is a CONSEQUENCE of his shape, not a reason to reshape it."* **F3
is right. This ruling only insists that the consequence be counted rather than absorbed.**

---

## 4. What this finding does NOT do

**It does not stop, narrow or delay the build.** ALGO-119 stands; `NOTHING LEAVES` remains the
binding disposition clause; the a-priori table is committed and correct.
**No weight is to be moved, tuned, or "checked against the sessions" — not one, not tonight, not
ever as part of this build.** Provenance is the question, and provenance is a census (§8.2).
**Touching a weight because it is now load-bearing would be the exact overfit the operator just told
us to avoid.** This is a **readability** requirement, not a semantic one.

---

## 5. ORDERED — one addition to the guard, pre-registered BEFORE the run

The guard already required both pins and membership by key (ALGO-119 §3.4). **Add: every zone whose
disposition changed is attributed to exactly ONE bucket, by key:**

| bucket | site | meaning |
|---|---|---|
| **(a) ESTABLISHED-OVERLAP DROP** | `levels.py:152` | wider band now collides with an established zone |
| **(b) RANK DISPLACEMENT** | `levels.py:182-186` | two same-side swings now overlap; **report the winner's key AND both quality values** |
| **(c) LIFECYCLE** | `zone_state_at_v24`, `levels.py:172` | the wider band flipped active/inactive |
| **(d) QUALITY MOVE** | `_quality` / `_pivot_close_away` | `close_away` or `quality` differs for a key present on both sides |
| **(e) RESIDUAL** | — | anything the four do not explain. **Required** — a taxonomy with no residual must mis-file or fall silent, and both hide the finding |

🛑 **(d) MUST BE EMPTY on real data, and that is the point of it.** It is a **positive control** on
the worker's own claim that the join never fired outside the tests (`row.t` is an `h15` index by
construction). **If (d) is non-empty, the refactor moved the quality score and re-exam #5 is
confounded — report it plainly, fix the confound, re-run. Do not read the exam through it.**
A guard that can only go green is not a guard; **(d) is the clause that can convict this build's own
instrument**, and it costs one comparison.

**ACCEPTANCE:** the five buckets **partition** the changed set — `|a|+|b|+|c|+|d|+|e| == |changed|`,
no key in two buckets, membership asserted by key and never by count. This is precisely the
**structural observable** ALGO-117 §4(c) ordered the campaign to iterate against, with the exam kept
as final verdict only.

**STOP CONDITION unchanged:** if the derivation cannot be expressed without a new number, **STOP and
say so.** That is the honest close, not a reason to invent one.

---

## 6. Two dead pointers in the in-flight artifact  **[MEASURED HERE]**

`research/current_mnq_strategy_v2_4_band_shape_apriori.py` cites **"ALGO-119 section 4"** (line 2)
for the a-priori fixture table and **"ALGO-119 section 7"** (F5) for the stop-if-a-new-number-is-
needed rule. **ALGO-119 has four sections.** The fixture-table order is **§3.3**; the stop rule is
**§3.6**; **§4 is "What does not change."** Two dead pointers, in a document written the same
afternoon this desk minted the cold-read law that finds them. **Fix before the commit is pushed.
Nothing else in that file needs touching — the a-priori table is right, and F5, which proves no
width floor is needed rather than inventing one, is the best thing in it.**

---

## 7. THE OPERATOR'S QUESTION, ANSWERED — where the edge is, and why this route cannot overfit
**[FIREWALLED: no clause in this ruling or in the ALGO-119 build was chosen using anything below.]**

**The arithmetic needs no PnL reconciliation.** From figures already established on this ladder
(ALGO-117 §5, ALGO-102), with the frozen **17.25-pt stop**:

| | destination taken | breakeven win rate = `stop/(stop+target)` |
|---|---|---|
| **the bot** | **20.68 pt** (realised median) | `17.25/37.93` = **45.5%** |
| **the operator** | **66.1 pt** (median marked target) | `17.25/83.35` = **20.7%** |

**The bot wins 42%.** ⇒ **It is ~3.5 points of win rate SHORT of breakeven on the destination it
takes, and ~21 points of win rate ABOVE breakeven on the destination he takes.**

**The deficit is not in a parameter and not in the entry filter. It is destination selection** —
already measured: the bot takes the **rank-0** destination where his are rank **4/7/17**, median
**5.5 traded through** (ALGO-102). The `−$21,075` over 1,246 trades is not a mystery to be optimised
away; **it is what taking the nearest exit against a fixed stop arithmetically produces.**

**And this is exactly why the route can produce an edge without overfitting: a fidelity repair adds
no degrees of freedom.** There is no parameter space being searched. Making the bot enter where he
enters and exit where he exits is a *translation*, not a *fit* — which is the structural difference
between what this campaign is doing and curve-fitting, and it is worth the operator hearing it in
those words. **The band shape is the entry half. The rank at `kernel.py:205` is the exit half, and
by the table above it is the larger of the two.**

**THE ANTI-OVERFIT CONTRACT THIS DESK WILL ENFORCE, and will be graded against:**
1. Every clause comes from **his words or a derivation** — never from what it does to a result.
2. **2026 SCORES, 2025 TEACHES** (ALGO-020). No clause is selected on the era that scores it.
3. **Backtest and Monte-Carlo numbers are OUTPUTS, reported — never inputs to a clause.**
4. **Five of seven years already sit within a few hundred dollars of flat** and two carry the entire
   loss. That is free out-of-sample surface, and it is where the honest test lives — not in a
   re-tuned aggregate.
5. No clause may be chosen for what it does to the five early bullet-spends or the fourteen sessions.

**NOT YET EARNED, and this desk will not say otherwise:** that these repairs *will* produce a
positive edge. The `−$21,075` measures the **pre-repair** bot and nothing has been re-measured.
**Monte Carlo on the current arm would measure a strategy we already know is not his.** The order is
FIDELITY → FREEZE → CLEAN EDGE, and it is that order because measuring first is how a campaign
learns to fit.

---

## 8. QUEUE — with contracts

1. **ACTIVE — worker seat `trading-forge-8d`, now.** ALGO-119 build **+ §5's five-bucket
   attribution** → re-exam #5. *Files:* `levels.py`, the band a-priori/guard/test files, §6's two
   pointer fixes. *Forbidden:* any weight, any magnitude under
   `changing_this_contract_invalidates_prior_v2_4_evidence`, the rank, the established path's band,
   the 17.25-pt stop. *Acceptance:* §5's partition + ALGO-119 §3.4's pins. *Disposition:* ALGO-119
   §3.6, unchanged.
2. **NEXT — authorized to this same seat, no round-trip.** The **level-map composite census**:
   provenance of the five weights at `levels.py:97-99` **and of the absent swing-path threshold**,
   in ALGO-087's form — `no citation found in the surfaces named`. **Provenance only. No weight
   moves. No tuning. No "check against the sessions."** Report the surfaces searched.
3. **THEN — the destination rank at `kernel.py:205`**, the exit half of §7 and the largest single
   lever measured. **It needs a derivation from his words; it does not get one from a backtest.**
   Guard design comes to this desk before any code.
4. **HOLD, unchanged:** established-path band (awaits its provenance pass) · M1 magnitudes + AST
   sweep's 32 literals + the seven established-path weights, as one census · **the two reserved-class
   asks — his to answer, nobody else's to guess.**

**STOPS, unchanged and absolute:** **no TopstepX connection of any kind, broker-paper included**,
before FIDELITY → FREEZE → CLEAN EDGE · no magnitude under the frozen contract · the rank untouched
without a guard · **no new number in the band build.**

---

**LESSON, minted:**

> **A SHAPE CHANGE UPSTREAM OF A GREEDY SELECTOR IS A SELECTION CHANGE — AND THE SELECTOR THAT HAS
> NEVER MATTERED IS THE ONE NOBODY HAS AUDITED.**

The five weights were safe to ignore for exactly as long as the bands were too narrow to collide.
**Widening the band is the act that makes them load-bearing.** Ask of any change: *what downstream
comparison becomes reachable that was previously vacuous?* — and audit the thing that will start
firing, not only the thing you are changing. The only reason this desk knows before the exam rather
than after it is that ALGO-108 taught it to hunt for the **removal hiding inside an addition**.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling. §7 is reported and firewalled, and decided nothing.*
