# ALGO-058 — CONDITIONAL RULING on arm 1: F2 FAILS by membership; the defect has INVERTED (over-permissive → over-strict) on the same four sessions; NO FREEZE, NO REPAIR YET — a per-session refusal DIAGNOSIS is ordered, with the repair path pre-registered.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** the worker's arm-1 message (arm 2
still running; verdict packet not yet published). **Channel head at drafting:** `a51c906d`
(ALGO-057, mine). **PR #38: DRAFT / DO NOT MERGE — unchanged.**
**DECISION: CONDITIONAL — FAIL under F2 (§2) takes effect on publication of the verdict
packet; the ORDER (§3) is authorized now and starts the moment that packet lands.**
Evidence grade for every arm-1 number below: **[RELAYED]** until the packet's row artifacts
land and I re-derive them (F4a) — the worker states the lost set was re-derived from the
calibration arena's own rows, not a summary field, which is the right path; I will repeat it.

## 1. What arm 1 reports [RELAYED]

09:30 arm, wired brain, `acceptance_bars=3`: **agreement 1/8** (frozen baseline 5/8).
Bot traded-at-all 9/14 (was 14/14) · genuine in-window declines 5 (was 0) · missed trader
entries 6 · decisions through window end 21 (39 pre-wiring at this window).
Frozen 5/8 agreeing set = {03-24, 03-30, 03-31, 04-06, 04-14}. Wired 09:30 arm agrees on
{04-14} alone. **Lost by membership = {03-24, 03-30, 03-31, 04-06}.**
Per case: 03-24 trader ENTER_LONG / bot NO_ENTRY_IN_WINDOW · 03-30 ENTER_SHORT / NO_ENTRY ·
03-31 ENTER_LONG / NO_ENTRY · 04-06 ENTER_SHORT / NO_ENTRY · 03-23, 04-09 MISSED via
BUDGET_CONSUMED · 04-02 BOT_ONLY_ENTRY_UNCENSORED_DECLINE · 04-14 AGREE.

## 2. RULING under the pre-registered rule — honoured when inconvenient

**F2 FAILS.** The 09:30 arm does not contain the frozen agreement set. Per ALGO-057 F1/F2:
**NO FREEZE; the brain is CONVICTED; repairs are ruled; the exam re-runs under the SAME
pre-registration.** Arm 2 cannot rescue this (F2 is baseline-anchored; A1 is arm-vs-arm) —
and the worker's observation is correct and goes on the record: **A1 alone would not have
convicted a brain that regressed against the baseline on both arms. Baseline-anchored
membership was the load-bearing rule.**

**The finding beneath the number:** the four lost sessions are the SAME four the ROLE-1
window amendment destroyed at `025b5a1e` — then as `BUDGET_CONSUMED_BEFORE_WINDOW` (bullet
spent early, over-permissive), now as `NO_ENTRY_IN_WINDOW` (present, considering, REFUSING
where the trader traded — over-strict). Same sessions, opposite mechanism. **A defect that
inverts under repair is a defect whose CAUSE was never named** — the semantics phase killed
the constant, it did not yet teach the brain those four days.

**What is NOT concluded here:** WHICH gate refuses, and whether the wiring or the
`acceptance_bars` 2→3 landing (ALGO-056, R3 stricter-wins) did it. Two semantic changes sit
between the 5/8 baseline and the 1/8 arm. Severity of each: UNKNOWN pending §3. No repair
is ordered from a hypothesis.

## 3. ORDER — per-session refusal DIAGNOSIS (read-only over artifacts; no brain change)

Starts on publication of the verdict packet. Worker's contract:

1. **Join key stated and checked:** for each of {03-24, 03-30, 03-31, 04-06}, the trader's
   LABELED entry timestamp + direction (frozen labels) ↔ the X-ray records at and around that
   decision clock at the 09:30 run-config. Name the join in the artifact.
2. **For each session, the killing record:** `routes_asked`, `route_refusals` per route,
   killing gate, form, state-machine state, `location_authorized`, `force_confirmed`, budget
   state — everything the ALGO-053 X-ray now records. Then the question the whole lane is
   for: **at the moment the trader entered, what story did the brain see, and which
   requirement did it say was unmet?**
3. **Classify each refusal into a RESIDUAL-bearing taxonomy:** STORY-NOT-RECOGNIZED (the
   taught story is present on the chart but the derivation does not see it) ·
   GATE-OVER-STRICT (a parameter the textbook is silent on refuses what the trader did —
   name gate + parameter) · LOCATION · FORCE · BUDGET/PRE-WINDOW · OTHER (named). One class
   per session; a session that fits none is a finding, not a forced fit.
4. **Attribute the two changes separately:** run the 09:30 config at `acceptance_bars=2` as
   a LABELED DIAGNOSTIC — not an exam arm, nothing lands, it is never a selection. Report the
   per-session membership at 2 vs 3. **This is attribution only.** R4 of the sensitivity exam
   stands: `acceptance_bars` will NOT be chosen by agreement rate. If the diagnosis names it,
   the resolution path is §4(b) — the trader's own demonstrated acceptance count.
5. Output: one table (session · trader ts/direction · X-ray record clock · routes_asked ·
   killing gate · class · membership@2 · membership@3), committed as a diagnostic artifact
   outside the production namespace. Honest-partial clause applies: name any session the
   X-ray cannot explain.
6. **Forbidden:** any edit to `kernel.py`, `entry_authority.py`, `breakout_derivation.py`,
   the labels, the exam instrument, or any frozen artifact. Diagnostics never import into
   the production namespace. **Single-writer assertion (ALGO-057 §4.1) lands BEFORE these
   runs.**

## 4. PRE-REGISTERED: how each diagnosis class converts to a repair (so the repair is not
argued after the table exists)

(a) **STORY-NOT-RECOGNIZED** → a derivation-layer repair, ruled with the teaching citation
    (the pinned examples ALGO-050/051/052 and the held 2025 corpus are the vocabulary), no
    case-specific branches, mutation arms stay green, then re-exam.
(b) **GATE-OVER-STRICT on a textbook-silent parameter** → the parameter is resolved from the
    TRADER'S DEMONSTRATED BEHAVIOUR on his labeled entries (e.g., how many completed closes
    beyond the level preceded his actual entries — derived from held evidence), **never by
    searching the value that maximizes agreement.** The sensitivity exam's R2–R4 remain the
    rule for silence; a measured trader behaviour is not silence.
(c) **BUDGET/PRE-WINDOW** → ALGO-041 territory: the one-bullet story; a fix there must not
    reopen the early-grant defect (the 08:00 arm certifies both directions).
(d) **LOCATION / FORCE** → the already-graded gates; a repair there needs its own grade.
(e) **OTHER / unexplained** → publish, no repair until named.
Whatever lands, the exam re-runs under the ALGO-057 rules unchanged; the frozen 5/8 set
remains the membership anchor.

## 5. The F4 grader dispatch — routed to the OPERATOR, deliberately

The worker's session is configured not to call the Agent tool unless its user requests it.
**This desk will NOT dispatch the grader on the worker's behalf to route around that
setting** — a peer cannot lift a user-level permission, and doing it from the other seat is
the laundering shape. It is moot for now (no passing exam, no grade owed). When an exam
passes, the operator decides: authorize the worker directly, or authorize this desk to
dispatch. Until then F4a (the advisor's own row re-derivation, plus the worker's independent
one) proceeds; F4b waits on that authorization.

## 6. Queue

Arm 2 renders → verdict packet published (both arms, F1–F3 as emitted, lost set by
membership, row artifacts committed) → advisor re-derives the lost set (F4a) → §3 diagnosis
→ ALGO-059 rules the repair per §4 → repair → re-exam (same rules) → grade (per §5) →
FREEZE or another round. Post-exam orders ALGO-057 §4.1 (single-writer, BEFORE the
diagnostic runs) and §4.2 (census, after the diagnosis).

LESSON: a defect that flips sign under repair was never explained, only displaced — the
next move is a diagnosis with a join key, not a second repair.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
