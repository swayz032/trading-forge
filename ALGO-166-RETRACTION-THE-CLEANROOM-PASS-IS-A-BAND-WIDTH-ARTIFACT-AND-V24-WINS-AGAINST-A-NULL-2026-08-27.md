# ALGO-166 — 🛑 RETRACTION. **THE CLEANROOM PASS IS A BAND-WIDTH ARTIFACT. AGAINST A NULL, v2.4 WINS.**

**Strategy head:** `de002b65` — pushed, remote-verified.
**PR #38: DRAFT / DO NOT MERGE.** **Semantic files modified: NONE.** v2.4 untouched throughout.
**Gate:** `40 passed` — enumerated by `--collect-only` (14 band_shape · 12 levels · 8 sunset_docs
· 6 cleanroom_v2_frozen).

**I am retracting my own headline one ruling after you ratified it. Nobody asked me to.**

---

## 1. THE CONTROL I NEVER RAN

**When a map "covers 17 of his 28 marked levels", how many would it cover if his levels were
replaced by RANDOM prices?**

**For the clean-room map the answer is `17.5`.**

| | **CLEANROOM-v1** | **v2.4** |
|---|---|---|
| median band **WIDTH** | **912.62 pts** | **17.75 pts** |
| share of each session's own price range covered | **78%** | **29%** |
| covers his 28 | **17** | 13 |
| **its OWN null** — same count of one-tick levels, uniform over the session range, 4,000 draws | **mean 17.5**, sd 1.7 | mean 9.5, sd 2.4 |
| `P(null ≥ observed)` | **0.718** | 0.112 |
| **DISTANCE FROM CHANCE** | **−0.27 sd** | **+1.43 sd** |

**The clean-room map is very slightly WORSE than chance at finding his levels.** A 912-point band
contains his one-tick mark by construction; the three bands swallow **78% of the session**.

## 2. 🛑 AND THE RANKING REVERSES

**`17 vs 13` was never like-for-like.** v2.4 draws real zones — median **17.75 pts**, the width of
an actual key-level band — and sits **+1.43 sd above its own null.** This build drew bands **51×
wider** and sits **at** its own null.

> **v2.4 WINS THE ONLY COMPARISON THAT CONTROLS FOR WIDTH. The clean room did not beat it. It
> out-blanketed it, and raw overlap paid it for exactly that.**

## 3. ROOT CAUSE — IT IS THE THING I CALLED THE BUILD'S ELEGANCE

The spec boasts: *"CLUSTERING NEEDS NO TOLERANCE … the grouping distance is supplied by the candles
themselves. v2.4 needs `ztol_atr` here; this does not."*

**That clustering is a transitive closure over band overlap — single linkage. A–B overlap and B–C
overlap merges A with C even when A and C are 900 points apart. It chains.** Median members per
"level": **230.** *A key level with 230 independent reactions is not a level, it is the whole
market.*

**Removing the tolerance constant did not remove the need for one. It hid it** — and I published
the hiding as a virtue, in a section titled *"how this avoids inventing numbers."*

## 4. WHY NEITHER CLAUSE CAUGHT IT

**The pre-registered acceptance measured COUNT and COVERAGE. Neither constrains WIDTH.** Three bands
that swallow the chart satisfy *"≤5 zones per session"* perfectly.

**Both clauses were green AT THE ASSERTION and blind to WHAT THEY ASSERTED OVER** — and
`[guard-green-for-the-wrong-reason]` was already in my own memory index, naming this exact shape,
**before I wrote the spec.** I had the law and did not apply it.

**The number that makes `17 of 28` interpretable is `17.5`, and it cost ninety seconds.**

## 5. WHAT SURVIVES AND WHAT DOES NOT

**SURVIVES — the ALGO-163 ablation is untouched.** Confluence really did decide **0 of 14** cuts;
`NO_CONFLUENCE == AS_BUILT`; `RECENCY_ONLY` really did score 22. **Those were always statements
about this map's INTERNAL RANKING, and they stay true of a map that should not be used.** Your
ALGO-164 reading — *`CONFLUENCE_ONLY = 6` is the wrong quantity, not an undertuned one* — also
stands.

**DOES NOT SURVIVE:** clause 2's PASS as evidence of anything · *"more of his levels on a map 12.4×
smaller"* · every clean-room-vs-v2.4 coverage comparison in ALGO-163 · **and the premise under
CLEANROOM-v2, which builds on this map.**

**I STOPPED THE CLEANROOM-v2 BACKTEST MID-RUN** rather than spend an hour measuring a map that is
not a map. It was caught by a **smoke test on 8 sessions** — the zones printed as `[14492–14706]`
and `[14707–15090]`, and a 383-point "key level" is visible to the naked eye. **The freeze and the
guards were all correct and all irrelevant; none of them looked at a zone.**

## 6. YOUR ALGO-165 QUESTIONS, ANSWERED

- **v1's anchor was `09:30`** — the same anchor as v2.4's pinned map. **THERE IS NO ANCHOR CONFOUND
  IN ALGO-163**, and I established it by reading the artifact, not by re-running against the
  fourteen. Your ALGO-164 confound is closed; the result died of something else.
- **Read 1 / Read 2 confirmations received.** The `3.83R` AST guard stands as built.
- **The authorized v2.4 lookahead trace is NOT done.** It is untouched and still authorized; I am
  reporting this first because you ratified a result I have just killed, and a trace can wait an
  hour where a false ratification cannot.

## 7. WHAT I AM NOT DOING

**No repair is proposed and none is authorized.** The obvious move — add a width cap, or swap
single-linkage for something that does not chain — **is a tolerance constant chosen by looking at
what it does, which is the exact thing this build existed to avoid.** I am not picking one.

**No claim that v2.4's map is good.** `+1.43 sd`, `P = 0.112` is *above chance*, not *validated*.
It is the better of two, measured honestly.

**Instrument limit, stated:** the null draws **uniformly** over each session's range; his levels are
not uniform, so a pivot-drawn null would be stricter. **It is not needed to carry this** — the width
(`912` vs `17.75`) and range-share (`78%` vs `29%`) figures use no null at all.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this packet.*
