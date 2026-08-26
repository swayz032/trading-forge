# ALGO-106 — The census lands the sharpest line of the campaign: **`body_frac 0.62` and `close_loc 0.78` were RETIRED from Route A by ALGO-071 §3 as untaught — and they are still live in EVERY break-family trigger, deciding all five bullet-spends that beat him to the day.** Two of the five turn on hundredths (04-06 clears `body_frac` by **+0.0116**; at 0.64 — one step **inside** the number's own declared range — that trade does not exist). **B1 is authorized: extend the existing retirement to the surface it never reached**, using expressions this campaign has already ratified. And ALGO-105's **public prediction of 3/8** becomes the acceptance — falsifiable, and recorded as refuted if it misses.

**Advisor:** Claude (Fable 5), ALGO seat — `trading-forge-49`. **Rules on:** the break-family
bullet census @ `1a44ff79` (report-only, no predicate) and the housekeeping commit `cf7fb58f`
(all five sunset docs now carry `UNRATIFIED-FOR-FREEZE` verbatim; forbidden words absent).
**Channel head at drafting:** `dbc79dd9`. **Main head:** `c62bb561e015`. **PR #38: DRAFT.**

## 1. The census — ratified, and the margins ARE the finding

| session | bullet | early by | granting route | admission path | zone state |
|---|---|---|---|---|---|
| 03-23 | 08:14 S | 187 min | Route D `prebreak_repeat_test` | PRIMARY repeated-rejection | TESTED |
| **03-24** | **08:17 S** | **75 min** | Route D `prebreak_repeat_test` | PRIMARY | TESTED |
| 03-31 | 09:03 L | 46 min | Route D `break_retest` | PRIMARY | **BROKEN** |
| 04-06 | 09:07 S | 57 min | Route B `normal_breakout` | **EXCEPTIONAL single-swing** | **BROKEN** |
| 04-09 | 09:37 L | 118 min | Route D `break_retest` | **EXCEPTIONAL single-swing** | **BROKEN** |

**Margins:** 04-06 `body_frac` required 0.62, measured **0.6316 (+0.0116)** · 03-31 `close_loc`
required 0.78, measured **0.8030 (+0.0230)** · 03-23 +0.1344 · 03-24 +0.0533 · 04-09 +0.0666.

**`body_frac`'s own declared search range is `(0.56, 0.68)`. At 0.64 — one step inside its own
range — the 04-06 bullet-spend does not clear.** A trade that exists or not depending on the
second decimal of a number nobody taught **is not a decision the strategy made.** That statement
is about provenance, not about whether the trade is good; §3 forbids targeting it.

**Seven untaught magnitudes decide these five grants:** `reject_wick 0.35` · `acceptance_bars 3` ·
`body_frac 0.62` · `close_loc 0.78` · `min_wick 0.20` · `absolute_displacement_floor_atr 1.0` ·
`recent_displacement_percentile 0.75`.

## 2. THE LINE — and it is prior art, not a discovery

> **ALGO-071 §3 (operator-answered, 2026-08-23):** `_control()`'s `body_frac ≥ 0.62` and
> `close_loc ≥ 0.78` — v2.2 `Params` defaults with tuning search ranges — **are RETIRED from the
> rejection test. They were never his definition.**

**They are still live in `breakout_derivation._momentum(row, direction, body_frac, close_loc)`
(`:124-128`), which gates every Route B/C/D trigger — including all five approvals that spend the
bullet before his clock.** The campaign spent three rounds removing those two numbers from one
route while they decided the trades on the other. **Same defect, other side of the house, now
measured rather than suspected.**

**And the replacement is not a new invention** — this campaign has already ratified magnitude-free
expressions of the same taught shape. The taught content is
*"Momentum = directional body/control geometry. Range expansion is not required."*
(`engineer_onboarding:98`, `spec.entry_trigger_semantics.momentum_candle`). Ratified expressions
of exactly that: **F1's `_directional_body`** (close beyond open in the direction) and **T3″'s
`NO_DIRECTIONAL_CONTROL`** (close past the bar's own midpoint) — both OHLC-against-OHLC, both
already through an a-priori fixture table and a mutation battery.

## 3. B1 — AUTHORIZED. Derivation first, and the rails are the strictest yet

**SCOPE, deliberately narrow because there is one day:** `body_frac` and `close_loc` **only**, and
**only** where they gate the break-family *trigger* (`_momentum`, and its call sites in
`normal_breakout` / `break_retest` / `prebreak_repeat_test` / `prebreak_displacement`).
**OUT OF SCOPE, named and deferred:** `reject_wick 0.35`, `acceptance_bars 3` (already declared in
`breakout_derivation.UNFROZEN_CHOICES`), `range_ratio`, and M1's level-admission magnitudes.

1. **B1a — DERIVATION, committed BEFORE any measurement** (the sequencing that has caught three
   bad clauses in two days): express *"directional body/control geometry"* magnitude-free for the
   break trigger, from the teaching plus the two ratified expressions above. State which of the
   two you take, or the conjunction, and why — **from the words, not from what it does to the five
   trades.** A-priori fixture table published **before** the guard, including at minimum: a
   decisive directional trigger PASSES · a bar closing against its direction REFUSES · a
   doji/indecisive trigger REFUSES · the ALGO-071 §5.3 bar behaves as its own clause requires.
   **If the derivation needs a new number, B1 CLOSES** and the residual is stated for GPT.
2. **B1b — GUARD**, both pins, membership by key: control by key **and** target · sessions
   silenced **reported** · the five bullet-spends' new dispositions **reported per session with
   the clause that decided each** · first-approval-per-session table, baseline vs new head.
3. **B1c — RE-EXAM #4 is the acceptance, and it tests a PRE-REGISTERED PREDICTION.**

## 4. The acceptance — ALGO-105's prediction, made public before this lane existed

> **ALGO-105 §5.3, published at `dbc79dd9` before this census was run:** *"fix what spends the
> bullet before his clock at 08:00, and the two recovered sessions carry to the deployed arm —
> 08:00 would read 3/8 on the evidence in hand. That is a prediction, and it is falsifiable by
> the next lane's guard."*

**That is now the acceptance, and it cuts both ways:**
- **NOTHING LEAVES** — binding, on both arms and at the control by key and target.
- **CONFIRMED** iff the 08:00 arm reaches **3/8** with `03-24` and `03-30` in its agreeing set.
- **REFUTED** if it does not — and a refuted prediction is **published as refuted**, in the
  packet's subject line, with no re-explanation. The desk that made the prediction does not get to
  reinterpret it afterwards.
- **A1 and A3** are reported as measured. If A3 (the 08:00 arm) passes, FREEZE per ALGO-029 §1.2
  becomes reachable **for the first time** — and only then.
- No PnL, no EDGE artifact, no 2026-label input. Horizons stated on every number.

**ANTI-OVERFIT, and this lane is where the temptation is sharpest.** The 04-06 margin of 0.0116 is
evidence about **provenance**, not a target. **The replacement expression may not be chosen,
tuned, or preferred because of what it does to any of the five trades**, and a packet that argues
B1 succeeded *because* the early trades vanished is refused exactly as ALGO-104's count argument
was. The five dispositions are **reported**. If the derived clause admits 04-06 anyway, that is
the honest result and it is published as such.

## 5. M1 — DEFERRED, deliberately, and it is GPT's first task

M1's magnitudes (`min_wick`, the 1.0-ATR floor, the 0.75 percentile) gate **2 of these 5**
bullet-spends, so the worker is right that the lanes meet. But M1 sits under a frozen contract
whose own clauses (`no_threshold_search: true`,
`changing_this_contract_invalidates_prior_v2_4_evidence: true`) make it **a spec release that
re-runs the exam** — not a one-day job. **B1 is the buildable half; M1 is delivered as a
DERIVATION DOCUMENT for GPT**, per ALGO-102B §3's three steps, with this census's margins folded
in as its evidence. Write it if B1 finishes early; it does not gate B1.

## 6. LAW MINTED — the worker's, and it earned it twice today

> **A CENSUS THAT CAN ONLY SAY PASS/FAIL CANNOT CATCH ITS OWN WRONG BAR. PRINT THE MARGIN.**

Two wrong-object errors were caught **because the artifact contradicted itself** — an approval that
"did not clear" is impossible, since it was approved. Pass 1 read the completed 5m bar
(`entry_authority` reads the force partial from completed 1m sub-bars): 4 of 5 wrong. Pass 2 used
`first_force_confirmation`, the *earliest* confirmed snapshot rather than the grant's own minute:
2 of 5 wrong. Pass 3 takes the clock from the X-ray's own `SURVIVED_TO_RANKING` record for that
exact (bucket, location, direction): all five consistent. **A verdict-only census would have
published the wrong bar silently, twice.** This is the same wrong-object family as the 04-09 probe
the worker discarded earlier — **caught both times by printing numbers instead of verdicts.**

LESSON: this campaign removed two numbers from one route with an operator's own words behind it,
and never asked where else those numbers lived. **A retirement is scoped to the call sites you
enumerate; grep the symbol, not the route.**

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.
