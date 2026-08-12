# AR-1080 — WORKER — **AR-1079's TWO NEW PREMISES ARE CONFIRMED BY MEASUREMENT, NOT ACCEPTED ON REPORT.** Your §5 warmup trap is real and I have its exact line numbers. Your §3 correction is real. Fan-in unchanged `3 / 7`.

```
RULING  : AR-1079 (gpt-rulings 528d8ef4) §3, §5, §12
TREE    : C:\Users\tonio\Projects\wt-h1-wave4-20260712        [MEASURED HERE]
PIN     : b609f039   — UNCHANGED. No code written. This AR is a premise verification only.
FAN-IN  : A ✅ · B ❌ · C ❌ · D ❌ · E ✅ · F ❌ · G ✅   =  3 / 7
```

**Received AR-1079 on the armed ear** (`661672bc → 528d8ef4`, a move I did not make). Pre-flight
run against it. **A ruling's factual premises are `RELAYED` until measured** (`[order-premise-grade]`),
and these two are about to be built on, so I measured them before anything is built.

---

## 1. ✅ YOUR §5 WARMUP-INDEX TRAP — CONFIRMED, AND IT IS EXACT

You wrote that `strategy.compute()` may run on warmup rows which `run_class_backtest` then strips,
so a naked integer `bar_idx` can point at a different candle afterwards. **`[MEASURED HERE]` it is
precisely that, and here is the pair of sites:**

```
backtester.py:6791-6798   PREPEND — "Mirror run_backtest warmup_data logic. Prepend IS rows so
                          strategy.compute() ..."  ->  data = pl.concat([warmup_data, data])
backtester.py:6935-6942   STRIP   — "─── P1-A: Strip IS warmup rows after compute() ─────────"
                          if warmup_rows > 0 and len(df) > warmup_rows:  df = df.slice(warmup_rows)
```

**The offset is exactly `warmup_rows`, and the strip happens AFTER `compute()` has already run.**
So an event recorded in `compute()` as a bare integer is silently rebased by `warmup_rows` — and
because the FVG `start_idx`, the displacement wick, the entry bar and the trade manager would all
shift together, **the result stays internally consistent around the wrong candle.** That is the
worst available failure shape: no exception, no mismatch, a plausible trade on the wrong bar.

★ **`A CONSISTENT ANSWER AROUND THE WRONG ROW IS NOT DETECTABLE BY ANY CHECK THAT ONLY TESTS
CONSISTENCY.`**

**This is a real catch and my AR-1078 join map did not contain it.** Stating that plainly: the map
was measured but not complete, and its incompleteness was exactly the kind a doer does not see —
I mapped the join points and never asked what happens to an index between them.

## 2. ✅ YOUR §3 PER-SESSION OPENING RANGE — CONFIRMED

`[MEASURED HERE]` `spec_condition_compiler.py`:

```
:882   "🛑 EXACTLY ONE ADAPTER CALL PER `(candidate, session_date)`."   <- per-session, as you said
:906   out = np.zeros(n, dtype=bool)                                    <- the collapse to a boolean
```

So the per-session `OpeningRangeState` really is computed already and really is discarded down to
availability. **B must reuse that exact state; a scalar ORH/ORL applied across a multi-day frame
would be wrong**, and a second opening-range calculator is one of your own STOP conditions.

⚠️ **CONSEQUENCE FOR THE AR-1076 FIXTURE, stated so it is not discovered late:** my deterministic
fixture's filler sessions were built only to be inert, not to form well-shaped opening ranges. The
harness architecture stands, but **the fixture needs each session to produce a genuine completed OR
state**, and it needs a session that is deliberately incomplete/refused for your §10 discriminator
18. That is fixture work, not a design change.

---

## 3. PRE-FLIGHT OUTCOME — NO CONTRADICTION

Both new premises hold. Nothing in AR-1079 conflicts with the measured tree at `b609f039`. The
authorized unit is unchanged in kind and **larger in extent** than AR-1078 mapped: it now also
carries per-session OR reuse, a stable cross-strip decision-bar identity, **21** discriminators
(up from the earlier set), and a mandatory nonzero-warmup identity test.

**No STOP condition from your §12 list is currently active.** In particular I did NOT find that
preserving FVG identity needs a second detector (the zones already exist at `_eval_fvg` and are
discarded at the return statement), nor that per-session OR needs a second calculator (the state
already exists and is collapsed to a boolean).

## 4. SEAT STATUS — YOUR §1 ACCEPTED MY STOP, AND I AM HONOURING IT RATHER THAN RE-OPENING IT

Your §1 accepted AR-1078 as *"a clean stop and a high-quality handoff."* Your §12 then says no
round trip is required — which I read as **the unit being authorized to the incoming seat without
further permission, not as an instruction to a seat that has already reported exhaustion.**

I want to be exact about why I am not simply resuming, because a handoff is self-assessment and I
should not hide behind it: **AR-1079 made this unit BIGGER, not smaller.** The two additions above
are both load-bearing and both demand their own red-proofed tests. Attempting it now would produce
the half-wired vertical path your §1 just credited me for avoiding. **The assessment that this
needs a full seat is better supported after your ruling than before it.**

What I did with the remaining budget instead: converted your two new premises from `RELAYED` to
`[MEASURED HERE]` with line numbers, so the incoming seat inherits them proven and spends its
context on the join rather than on confirming the brief.

## 5. STATE

- **No code written since `b609f039`.** Working tree carries no partial source-join work.
- **No sub-agent dispatched**, nothing owed, nothing half-written.
- **Ear** armed on `origin refs/heads/external-advisor/gpt-rulings`; red-proofed four ways and
  **it delivered AR-1079 itself**, which is the strongest proof it works that I can offer. It dies
  with this seat — re-arm from `b609f039` / gpt-rulings head.
- **The incoming seat's order is your §12 verbatim**, ten steps, starting from preserving the
  per-session OR state. AR-1078's join map remains valid for B/C/D/F line locations; **add §3 and
  §5 to it** and treat both as measured.

**A fresh worker session is needed. Nothing is blocked; the brief is complete and verified.**
