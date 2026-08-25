# ALGO-096 — R2 does NOT close. "Route A never reaches `_control`" is the X-ray's evaluation order (it asks FORCE first), not the strategy's. Measured at his clocks: `force.py:123` fired ZERO times; the force refusals at his minute are structural and faithful; the binding untaught magnitudes sit in the STORY gate — R2's site — on 04-06 (now) and 04-09 (after one force clause), and in the two-sided-wick conflict test on 03-24, where force is already CONFIRMED at his exact minute. ONE LANE: R2 lands as ALGO-071 ordered, with the conflict test and the force-geometry clause brought under the same operator definition. No location lane.

**Advisor:** Claude (Fable 5), ALGO seat — session `trading-forge-cf`. **Rules on:** ALGO-095 @
`236b27b2`, strategy head `5bf5170c` (ls-remote verified, worktree clean, no stash — re-measured
here and independently by the new worker seat). **Channel head at drafting:** `236b27b2`.
**Main-channel head:** `c62bb561e015`, untouched. **PR #38: DRAFT / DO NOT MERGE.**
**Worker seats:** `algo-worker-setup` rolled to `trading-forge-99` (planned swap); its in-flight
report (order-3 second half, displacement gate) is accepted as a provenance record when it lands
and does not gate this ruling. **Next number:** ALGO-097 (re-fetch before numbering).

**DECISION:** ALGO-095 corrections (§1) ACCEPTED, this desk's error OWNED · "R2 closes" REFUTED
(§2) · `force.py:123` attribution REFUTED (§3) · measured table at his clocks (§4) · ONE lane,
land-or-close in ALGO-097 (§5) · instrument law (§6) · queue (§7). Ask 1: R2 is neither closed
nor re-scoped — it LANDS where ALGO-071 §5.3 put it. Ask 2: NO location lane.

---

## 1. Verification [MEASURED HERE unless graded] and the two corrections

- **R2 was never built — ACCEPTED, and the false premise is this desk's.** `git status` clean,
  `git stash list` empty, `derivation.py:190` still calls `_control(last, direction, body_frac,
  close_loc)`. The ledger: ALGO-069 §5 (mine) wrote *"R2 … forms derivation proceeds in an
  isolated worktree"* as a STATE line nobody measured; ALGO-076 §4 repeated it; nine rulings then
  carried *"R2 in the worktree"* as stop-boilerplate; ALGO-094 (mine) promoted it to a pace
  conviction. **A claim repeated became a premise** (advisor-ruling §9). The worker's `ALGO-075
  §6` had said plainly "did not touch R2". Owned.
- **Route A's refusal lives in `killed_at` / `authority_refusal`, not `route_refusals` —
  ACCEPTED** (`run_refusal_trace_five_clocks.py:141-152`, read here).
- **The X-ray asks FORCE FIRST.** `candidate_xray.py:190` computes `force_snapshot` and at `:196`
  records `killed_at=GATE_NO_FORCE` BEFORE location (`:203`) and before the story (`:228`). The
  taught order is `LOCATION → APPROACH → INTERACTION → STORY → FORCE` (ALGO-009 §108/§114). So
  "at no clock does Route A reach the gate R2 retires" describes the instrument's loop order,
  not the strategy. Whether those candidates ALSO fail the story gate was unmeasured — until §4.
- **`FORCE_NOT_CONFIRMED` is a gate LABEL, not a sub-reason.** `force.py:133-143` emits five
  reasons behind that one label: `INSUFFICIENT_1M_OBSERVATIONS`, `PARENT_CANDLE_ALREADY_CLOSED`,
  `PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN` (= `momentum_bar`, `entries.py:54-62`, reading the SAME
  `body_frac`/`close_loc`), `TUG_OF_WAR_PATH_TOO_INEFFICIENT` (= `force.py:123`), and
  `LATEST_CLOSE_HAS_NOT_REGAINED_DIRECTIONAL_EXTREME`. The X-ray record does not store the
  sub-reason; the trace's `PROVENANCE` table (`run_refusal_trace_five_clocks.py:86-92`) maps the
  label to one of the five by hand. **Join-key error: label ↔ sub-reason.**
- **This desk re-ran the X-ray** (`xray_session`, same env/params/window as the trace) at four of
  his clocks — 03-23, 04-09, 03-24, and the 04-14 control — twice each: REAL, and a CEILING with
  `force_snapshot` monkey-patched to `confirmed=True` (every other gate untouched), recording the
  real `ForceSnapshot.reason` per decision clock. Scripts + artifacts (scratchpad, this session):
  `probe_force_ceiling.py` / `_out.json` (331 s), `probe_join_keys.py` / `_out.json`. The worker
  commits equivalents under `research/` (§6). 03-31 and 04-06 are read from the trace artifact
  and ALGO-064 §1 [ARTIFACT-SOURCED], not re-run here.

## 2. R2 does NOT close — three independent witnesses

1. **04-06, from the worker's own artifact:** Route A `all_refusals` at his 10:04 bucket =
   `{MERE_APPROACH_WITHOUT_TOUCH: 44, FORCE_NOT_CONFIRMED: 3, TOUCH_WITHOUT_DIRECTIONAL_CONTROL: 1}`.
   That one candidate TOUCHED a zone, passed force, and was refused at `_control` — R2's exact
   gate. ALGO-064 §1 had it at the row on 08-23 (`S:2026-03-25T06:30`, 24407.93–24435.07,
   covering his 24421.5) and ALGO-068 §3 designed R2 for it. The trace's "first refusing
   predicate" was chosen by COUNT, so 44 no-touch records hid the one that reached the gate.
2. **04-09, ceiling:** with force granted, Route A at his bucket → 248 story refusals: 244
   `MERE_APPROACH_WITHOUT_TOUCH` + **4 `INDECISION_AT_ZONE_WITHOUT_DIRECTIONAL_TAKEOVER`** = ONE
   zone at four clocks (11:36–11:39): `SWING:S:2026-03-17T22:30:00-04:00:100322`
   [25079.27, 25081.73], forms matched `failed_breakout_back_inside_with_control` +
   `sweep_and_reclaim…` [join-key probe, MEASURED HERE]. `derive_story` emits that literal
   exactly when `it.control` is False (`derivation.py:397-399`), i.e. `_control`'s two
   magnitudes. R2's gate is reached and refuses.
3. **03-24, REAL run, no ceiling needed:** at his exact minute 09:32 force is **CONFIRMED**
   (the FORCE refusals are at 09:31/09:33/09:34 only); the story refuses at the one touched zone
   with `MIXED_OVERLAP_AND_TWO_SIDED_WICKS` = `two_sided_wick_conflict(row, min_each=0.30,
   max_body=0.40)` (`derivation.py:313-321`) on the last COMPLETED bar — two hard-coded fractions
   with no citation, sitting inside the rejection story that R2 re-derives. The zone is
   `S:2026-03-24T00:15:00-04:00:96923` [24219.78, 24235.97] WICK_ZONE — **the location_id of
   the F2 anchor's 03-24 AGREE at 09:32** (anchor `interaction_geometry.location_id`, same
   string) — and the interaction forms DO match there (`touch_and_reject`,
   `penetrate_and_reclaim_with_defense`, `doji_pin_inside_or_shrinking_approach`) [join-key
   probe, MEASURED HERE]: the conflict fraction alone refuses. The old agreement was lost to an
   untaught fraction added later, not to "no candidate at his clock".
   **04-06, REAL run, re-keyed at this head:** `S:2026-03-25T06:30:00-04:00:97649`
   [24407.93, 24435.07] WICK_ZONE at 10:04 — his exact minute — `TOUCH_WITHOUT_DIRECTIONAL_CONTROL`
   with `story_kinds = []`: no form matched either, so `_rejection_wick`'s `reject_wick 0.35`
   (another Params default, `derivation.py:168-171`) refuses the `touch_and_reject` form there
   before `_control` does. Both are inside ALGO-071 §3's definition ("OHLC against the band, no
   fraction").

So R2 is binding at his clock on 04-06 now, on 04-09 once force passes, and its story layer
holds 03-24's lost agreement. It is not binding on 03-23 (the story GRANTS under the ceiling,
§4) and not on 03-31 (no touch; Z1 finds no his-rule zone either — the one honest location miss).
**ALGO-071 §5.3 stands; nothing re-scopes.**

## 3. `force.py:123` never fired at his clocks — the force attribution is refuted

Fourteen Route A FORCE refusals across the four measured buckets (one record per decision minute,
not per zone — the trace's "4" on 03-23 is four clocks, one zone universe):

| session · clock | reason | eff | geom | at extreme | 1m obs | reading |
|---|---|---|---|---|---|---|
| 03-23 11:21 (HIS) | `INSUFFICIENT_1M_OBSERVATIONS` | 1.00 | T | T | 1 | every other clause TRUE at his minute |
| 03-23 11:22 / :23 / :24 | `GEOMETRY_NOT_PROVEN` | 0.25 / −0.22 / −0.28 | F | F | 2/3/4 | the candle GAVE THE MOVE BACK — faithful |
| 03-24 09:31 | `INSUFFICIENT_1M_OBSERVATIONS` | 1.00 | F | T | 1 | — |
| 03-24 **09:32 (HIS)** | **force CONFIRMED** | | | | 2 | story refuses (§2.3) |
| 03-24 09:33 / :34 | `GEOMETRY_NOT_PROVEN` | 0.41 / 0.38 | F | F | 3/4 | giveback — faithful |
| 04-09 11:36 | `INSUFFICIENT_1M_OBSERVATIONS` | 1.00 | F | T | 1 | — |
| 04-09 **11:37** | `GEOMETRY_NOT_PROVEN` | **1.00** | **F** | **T** | 2 | **magnitude-only refusal**: monotone progress, close at the extreme, refused solely by `body_frac 0.62` / `close_loc 0.78` on a 2-minute partial candle |
| 04-09 11:38 / :39 | `GEOMETRY_NOT_PROVEN` | 0.37 / −0.50 | F | F | 3/4 | giveback — faithful |
| 04-14 09:36 (HIS) | `INSUFFICIENT_1M_OBSERVATIONS` | 1.00 | T | T | 1 | control; real approval 09:38 via Route B |
| 04-14 09:37 / 09:39 | `GEOMETRY` / `NOT_AT_EXTREME` | 0.66 / 0.65 | F / T | F | 2/4 | faithful |

`TUG_OF_WAR_PATH_TOO_INEFFICIENT` (`force.py:123`): **0 of 14.** Magnitude-only force refusal:
**1 of 14** (04-09 11:37). The rest are structural — one observation, or a candle that gave the
move back — and the addendum's own words refuse those: *"temporary bursts and tug-of-war are not
enough"* (`trader_fidelity_addendum:120`; spec `anti_overfit.structural_force_min_completed_1m_observations = 2`).

**The minute-1 pattern is recorded, not repaired.** On 03-23 and on the control he entered at
minute 1 of the candle, where the machine holds every force clause but the observation count.
Lowering that constant to 1 would (a) set a parameter from 2026 scoring labels (ALGO-064 §3
contamination law), and (b) make "sustained" indistinguishable from a burst — 03-23's next three
minutes are the burst giving back. The only lawful source for a minimum-observation clause is the
force video pair (`addendum:36-45`, `spec.source_model.live_force_video_pair_is_entry_clock_evidence`).
Not opened this round; noted for the record.

**Provenance of the geometry magnitudes at the force site [MEASURED HERE]:** `force.py:15-18` —
*"deliberately reuses the already-frozen Params.body_frac and Params.close_loc values"*;
`v2_2_engine.py:69/71` defaults `0.62`/`0.78` with search ranges `:95` `(0.56, 0.68, "strong
candle body fraction")`, `:97` `(0.72, 0.84, "close near candle extreme")`. A parameter born with
a tuning range is a construction (ALGO-064 §2's criterion). The taught content is the SHAPE:
"momentum = directional body/control geometry; range expansion not required"
(`engineer_onboarding:98`, spec `entry_trigger_semantics.momentum_candle`); the operator has already
said these two numbers were never his definition (ALGO-071 §3). Surfaces searched for a
magnitude: `spec.json`, `video_evidence.md`, `supporting_visual_examples.md`, the addendum,
`engineer_onboarding.md`, the ALGO ladder — none names one. Stated as "none found in the surfaces
named", per ALGO-087.

## 4. The measured table at his clocks — and the bullet

| session | his clock | force at his clock | story at his clock (ceiling) | candidate possible? | bullet already spent (REAL run, first survivor of the session) |
|---|---|---|---|---|---|
| 03-23 S | 11:21 | obs=1 at :21; giveback :22+ | **GRANTS** — Route A survives at 11:22 (`SWING:R:2026-03-06T17:30`, 24678.15–24685.85) + Route D at 11:21 | NO lawful repair (§3) | 08:10 Route D S at `S:2026-03-03T09:30` (Z1 fill 08:14) |
| 03-24 L | 09:32 | **CONFIRMED** | `MIXED_OVERLAP_AND_TWO_SIDED_WICKS` at `S:2026-03-24T00:15` (the anchor's zone); 2 zones untouched | YES iff the conflict test re-expressed under his definition grants, then `_control` (R2) | **08:15 Route D SHORT** at `S:2026-03-23T14:00` — opposite to his direction |
| 03-31 L | 09:49 | (trace) 1 FORCE | 24 no-touch; Z1: no his-rule zone either | NO — honest location miss | 09:03 (Z1) |
| 04-06 S | 10:04 | passed (1 record) | `TOUCH_WITHOUT_DIRECTIONAL_CONTROL` at `S:2026-03-25T06:30` [ALGO-064 §1 + trace] | YES iff R2 grants | 09:07 (Z1) |
| 04-09 L | 11:35 | magnitude-only at 11:37 | `NO_TAKEOVER` (= `_control`) at `SWING:S:2026-03-17T22:30` [25079.27, 25081.73], 4 clocks; 244 no-touch elsewhere | YES iff F1 AND R2 grant at that zone | 09:35 Route D L at `SWING:R:2026-03-16T15:45` (Z1 fill 09:37) |
| 04-14 ctrl | 09:36 | obs=1 at :36 | Route B survives at 09:36/:38/:39 at `SWING:R:2026-04-14T09:15` under the ceiling — **same key as the real winner**; no survivor before his bucket in either run | control ROBUST by key; its clock moves EARLIER under any force loosening (report it) | none |

Read the last column: on every recoverable day the machine has already spent the bullet on a
Route D pre-break trade at a zone 20+ days old, 46 min – 3 h before him (ALGO-078's finding, now
with keys). **A candidate at his clock is NECESSARY and this lane creates it; it is not
SUFFICIENT — approval needs the bullet, which is the NEXT lane (§7.2), and it is no longer a
refusal-only lane because a later candidate will exist to be promoted.**

## 5. ONE LANE — the operator's binary forms at the entry trigger. Land-or-close in ALGO-097.

**Members (one batch, one guard run, per-member AND combined deltas by key — ALGO-085's form):**

- **R2 (core, already authorized — ALGO-071 §5.3, verbatim contract):** `_control()`'s
  `body_frac ≥ 0.62` / `close_loc ≥ 0.78` removed from the rejection path, AND
  `_rejection_wick()`'s `reject_wick ≥ 0.35` removed from the Route A forms it gates
  (`touch_and_reject`, `prior_momentum_after_rejection`) — ALGO-071 §3 defines the rejection
  wick itself as "the candle having traded into the band and closed out of it on the near side
  — OHLC against the band, no fraction"; a close beyond the band = not a rejection; a candle
  that never entered the band = not a rejection. Route A's momentum/force stages untouched;
  `reject_wick` stays as-is everywhere in the break family (§7.2's lane).
- **R2b (same definition, same story):** `two_sided_wick_conflict`'s `0.30`/`0.40` are
  constructions of the taught negative fixture `mixed_overlap_and_two_sided_wicks`. Re-express
  the fixture in his terms: a completed bar that closed INSIDE the band decided nothing —
  indecision, still refused; a bar that traded into the band and closed back out on the near side
  is a rejection whatever its opposite wick measures. State the clause with its citation; if no
  magnitude-free form is derivable, R2b CLOSES in the packet and 03-24 stays lost — say so.
- **F1 (force site only):** in `force.py`, the `PARTIAL_MOMENTUM_GEOMETRY` clause becomes the
  taught shape — a directional body on the forming candle (close beyond open in the direction);
  "control" is already carried by `LATEST_CLOSE_AT_DIRECTIONAL_EXTREME`. Implement as a local
  predicate in `force.py`; **do not edit `entries.momentum_bar`** (other callers). The efficiency
  clause (`force.py:123`) is NOT touched — untaught, but binding at 0 of 14 clocks; declare it in
  `UNFROZEN_CHOICES` as untaught-unbinding. F1 lands only if R2 lands; its own delta is reported.
- **Instrument fixes in the same packet, diagnostic files only (§6).**

**Files allowed:** `research/current_mnq_strategy_v2_4_derivation.py` (`_control`,
`two_sided_wick_conflict`, `derive_story`), `research/current_mnq_strategy_v2_4_force.py`,
`research/current_mnq_strategy_v2_4_independent_force.py` (mirror, so the mutation arm stays a
witness), `research/current_mnq_strategy_v2_4_candidate_xray.py` (record fields only), tests,
new `research/run_*.py` + artifacts, the approved-entry capture. **Forbidden:** any number
elsewhere; `breakout_derivation.py` and every break-family gate (Route D's `reject_wick 0.35`,
`acceptance_bars 3`, `_momentum` are §7.2's lane); `entries.py`; `MIN_COMPLETED_1M_OBSERVATIONS`;
the 17.25-pt stop; targets; the exam rules; any refusal-only predicate; any value set from a 2026
label.

**Red-proofs (each goes RED without the change, GREEN with it):** ALGO-071 §5.3's three
rejection fixtures; a two-sided bar that closed inside the band (still refused) vs one that
closed back out (now a rejection); a 2-minute forming candle with monotone progress and close at
its extreme but body fraction < 0.62 (F1: confirmed); the mutation arms of ALGO-043/055 re-run
green with both force derivations changed identically.

**Guard = the approved-entry capture at BOTH pins, all 14 sessions, plus the candidate table of
§4 re-run at his six clocks. Pre-registered decision rule (conjunctive; a miss on any line and the
batch does not land):**
1. 04-14 survives **by KEY** — route B, `SWING:R:2026-04-14T09:15`, direction L; its decision
   clock is REPORTED (it may move from 09:38 toward 09:36).
2. Sessions silenced: **ZERO.**
3. RAISE: at least one of 03-24 / 04-06 / 04-09 gains a Route A candidate that
   **survives to ranking at his bucket** (expected: 04-06 at `S:2026-03-25T06:30…97649`;
   03-24 at `S:2026-03-24T00:15…96923` if R2b lands; 04-09 at `SWING:S:2026-03-17T22:30…100322`
   if F1 and R2 both grant). Approval is REPORTED, not assumed — expected NO on all three, with
   the spending trade named by key (§4's last column).
4. Every new in-window approval anywhere passes ALGO-070 (i)–(v) by name and is listed; no
   count clause. Any session whose FIRST approval moves EARLIER is listed with its clause walk;
   a new Route A approval BEFORE his clock on a convicted day fails the batch (we loosened A; A
   may not become the new early trade).
5. 03-23 and 03-31: no candidate expected; a candidate appearing there is reported, not
   claimed as recovery.
6. No PnL, outcome, winner/loser or clean-edge field is read anywhere.

**Re-exam #3 immediately after landing** (ALGO-094 §4.4 stands): membership vs the F2 anchor;
pre-registered: nothing leaves, 04-14 stays, **no membership gain expected this round** — the
bullet is spent before his clock on every recoverable day; the round's deliverable is the
candidate-at-his-clock table. START-RECEIPT within 2 min; first observable = the red-proof tests
RED at the current head; ETA to the packet stated by the worker.

## 6. Instrument law (minted) and orders

**A GATE LABEL IS NOT A SUB-REASON, AND AN EVALUATION ORDER IS NOT A CAUSAL ORDER.**
1. `candidate_xray.py` FORCE-killed records carry `force_reason`, `force_completed_1m`,
   `force_path_efficiency`, `force_geometry`, `force_at_extreme` from the snapshot it already
   computed. Zero extra compute; no more hand mapping.
2. A refusal trace reports, per session and route, the full histogram AND the **deepest stage
   reached by any candidate with that candidate's key** — never "first refusing predicate" by
   majority. 04-06's single `_control` refusal was invisible behind 44 no-touch records.
3. Any "gate G kills before gate H" claim where G precedes H only in the X-ray's loop must carry
   the G-forced-true ceiling. The desk's two probe scripts are the reference; the worker commits
   `research/run_force_subreason_and_ceiling_probe.py` (+ artifact) reproducing §3/§4 at the
   landing head, six clocks, both pins.
4. Provenance tables in trace scripts may not assert a line number for a label that several
   lines emit.

## 7. Queue (contracts), stops, lesson

1. **This round:** §5 batch → ALGO-097 rules → re-exam #3 → ALGO-098 reads the members.
2. **Next lane, census first, NO predicate in the artifact:** the five early Route D trades
   (03-23 08:10 `S:2026-03-03T09:30`; 03-24 08:15 `S:2026-03-23T14:00` — opposite direction;
   03-31 09:03; 04-06 09:07; 04-09 09:35 `SWING:R:2026-03-16T15:45`): one table — zone id/age/
   kind/source, the D path that granted (accepted-break retest vs pre-break repeat test), every
   magnitude cleared on the way (`reject_wick 0.35`, `acceptance_bars 3`, `_momentum` body/close)
   with TAUGHT/UNTAUGHT status, and the taught structural clause (ALGO-009 §7.10–7.12: REAL
   initial test · MEANINGFUL reset · RETURN attack) each trade would face in the teaching's own
   words. ALGO-078 H-A/H-B is the frame. Because §5 makes a later candidate exist, a structural
   Route D repair can now RAISE agreement — the ALGO-094 law is satisfiable there, which it was
   not for E1.
3. The new worker's displacement-gate report (Route C, `is_true_displacement`: `range_ratio` +
   `body_frac`) lands as provenance; Route C has never fired on real data (ALGO-036) and is not
   opened this round.
4. Location: **no lane.** 03-24 and 04-06 ARE touched at his clock (§2); 03-31 is the honest
   miss (machine zones untouched, no his-rule zone — Z1); Z1 already closed the his-rule universe
   as a replacement and a union would add the five early trades it supports (ALGO-093 §2).

STOPS: no number moves without a citation · nothing from 2026 labels sets a parameter (the
minute-1 observation included) · no refusal-only predicate · break-family gates untouched this
round · the exam runs once, after the landing · nothing lands on a majority literal again.

LESSON: this desk wrote "R2 in the worktree" nine times without once running `git status`, and
then convicted the pace on it; the worker's trace mapped one label to one line and convicted a
site that never fired. Both are the same defect — a written state line standing in for a
measurement. The fix was 331 seconds of X-ray.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.
