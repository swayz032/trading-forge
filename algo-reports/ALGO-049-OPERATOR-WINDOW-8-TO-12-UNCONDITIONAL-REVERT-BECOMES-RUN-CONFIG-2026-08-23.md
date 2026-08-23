# ALGO-049 — OPERATOR REASSERTED THE WINDOW: 8:00am–12:00pm. The deployment window is now UNCONDITIONAL; the 09:30 baseline becomes a RUN-CONFIGURATION of the exam, not a committed constant flip.

**Advisor:** Claude (Fable 5), ALGO seat. **Channel head at drafting:** `85a8c5fd` (ALGO-048,
this desk's own — channel administration; it does not bear on the window). **PR #38: DRAFT /
DO NOT MERGE — unchanged.** **DECISION: AMEND ALGO-043 (`32116672`) mechanics; substance
preserved.**

## 1. What happened and what is measured

- **Operator, verbatim, 2026-08-23:** *"but i said the time suppose to be 8am-12pm"* — in
  direct response to this desk describing the pending 09:30 revert. A statement of the
  operator's intent about his own strategy — the one category no artifact can overrule.
- **Prior art [cited, not re-decided]:** the 8:00–12:00 teaching is ALREADY REGISTERED at
  ALGO-025 §3 and enforced by the window-bound census
  (`tests/test_current_mnq_strategy_v2_4_window_bound_census.py`, whose ROLE-1 pins the
  one-place `core.TRADE_START` path). His message is a REASSERTION, not new teaching.
- **Measured repo state [MEASURED HERE, tree `wt-mnq-v24` working tree]:**
  `research/current_mnq_strategy_v2_2_engine.py:43-44` = `TRADE_START 08:00`,
  `LAST_ENTRY 12:00`. The END of his window is already the committed truth on every surface
  greped (kernel, shadow, replay-lab, evidence-eras). The ALGO-043 revert has NOT landed
  (worker's pre-flight message agrees — join key: same file/constant).
- **Layer scope of the convicting finding:** `e25a66d1` measured "8:00 makes fidelity worse"
  **on the OLD kernel** — a wider window feeding an over-permissive GATE. That layer is the
  one being REPLACED by the brain right now. The finding convicts the old gate, not the
  operator's hours.

## 2. RULING

1. **The deployment window is 8:00–12:00, UNCONDITIONAL.** ALGO-043's phrasing "08:00 becomes
   the deployment window at FREEZE only via a passing arm" is AMENDED: a failing 08:00 arm
   **blocks FREEZE and convicts the brain — we fix the brain until it earns his hours.** A
   09:30-deployed bot is not a fallback and never was his strategy. (ALGO-043's own law
   already pointed here: "the window is never the fix and never the casualty.")
2. **The committed constant revert to 09:30 is WITHDRAWN as a code change.** The committed
   kernel stays at the taught 8:00–12:00. What ALGO-043 actually needs — baseline numbers
   defined and comparable at 09:30, where the frozen 5/8 lives — is satisfied by the
   dual-window exam running its 09:30 arm as a RUN-CONFIGURATION (parameterized window for
   that arm's run), never by flipping the committed constant. Mechanics are the worker's;
   the property is: **both arms run under the full pre-registration; the 09:30 arm's numbers
   are produced under exactly the baseline's window; committed constants remain 8:00/12:00.**
3. **Everything else in ALGO-043/046/047 STANDS:** dual-window exam with the
   no-lost-agreement rule for the 08:00 arm; censoring classes; `acceptance_bars` rerun on
   clean mechanical selection (now: on the wired brain, baseline arm at the 09:30
   run-configuration); mutation arms green through the wiring; 5/8 is the number to beat
   honestly and the pre-registered rules decide.

## 3. Authorized next action (queue, amended in place)

Wire the brain (in flight, unchanged) → **skip the constant revert; implement the 09:30 arm
as exam run-configuration** → `acceptance_bars` rerun (ALGO-046 §1.3 semantics) → dual-window
exam under full pre-registration → FREEZE on a pass. STOP condition: if parameterizing the
09:30 arm requires touching semantic entry logic beyond configuration plumbing, publish
before landing. The ALGO-046 §3 end-to-end diff artifact still rides in the worker's next
packet.

LESSON: a contingent clause about the operator's own taught truth was the wrong shape — his
window was never the variable under test; the brain is.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
