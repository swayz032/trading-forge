# ALGO-025 — ALGO-024 acknowledged (nothing blocks; grade attack awaited). Deployment shape RULED. And an OPERATOR TEACHING UPDATE is registered: his trading window is 8:00–12:00 with setups forming before 09:30 — the frozen rules' 09:30 start is now a superseded-candidate, to be amended through the ordered process, never hot-patched.

**Advisor:** Claude (Fable 5), ALGO seat. **Head at ruling:** algo branch `81f2c7b2`
(ALGO-024) [MEASURED, fetch]. **PR #38: DRAFT / DO NOT MERGE — unchanged.**

---

## 1. ALGO-024 — acknowledged and ratified. No round-trip owed.

The §1 contract landed complete; the re-dispatched grade proceeds under the standing
pre-authorization. Ratified explicitly, so none of it drifts:

- **The three-state distinction is law:** unavailable (budget consumed) ≠ declined ≠ entered.
  `TRADER_DECLINED_BOT_TRADED_PRE_WINDOW` is correctly NOT an agreement class. The self-caught
  near-miss (folding BUDGET_CONSUMED into decline → 6/8 again) goes on the record as the exact
  failure class the repair existed for — caught this time by its owner.
- **ALGO-013 §2/§4 are FINAL** (167 raw · 101 episodes · A 73 / B 6 / D 22), the BRK15 mirror's
  zero survivors being a measured result (4,567 records; 49 armed weak breaks; 4 structural
  vetoes), not dead code.
- **The reframing is adopted: the failure is TIMING/SELECTIVITY, not DIRECTION.** In-window and
  present, direction agrees 5/5. The defect of record: the bot fires once per session
  unconditionally, half the time before the audited window opens. This is the sharpened target
  the entry-authority state machine must kill.
- **ALGO-017's verdict correctly weakens to NOT TESTABLE** (5-vs-2 population) — the honest
  form of a finding whose population shrank under a corrected join.
- Labels committed (42 keys, no monetary field) per the ALGO-020 §4.4 authorization — the F-6
  custody hole is closed by git custody over the whole byte range.

Semantics stay closed until the grade passes. Queue unchanged.

## 2. Deployment shape — RULED (operator question, 2026-08-23: *"aint i can use topstepx
without the engine of trading forge for the bot since this not gone be the powerful trading
forge bot but a bot with my own strategy but also how do i still not make this a normal
indicator dumb retail bot?"*)

1. **CONFIRMED: the `current_mnq_strategy_v2_4_*` family IS the product — a standalone bot.**
   It is not ported into, and does not require, the Trading Forge DSL/extraction engine. The
   runtime layer already exists in the family (`…v2_4_broker.py`, `…v2_4_automation_runtime.py`,
   `…v2_4_shadow_runtime.py` [MEASURED: present on the strategy branch]), and TopstepX
   connectivity has in-repo prior art from the earlier generations
   (`…v2_2_projectx_broker.py`, `…v2_2_projectx_history.py` — ProjectX is TopstepX's platform).
   **Prior-art law applies: assess and reuse those before authoring a new adapter; their
   working state is UNVERIFIED and must be measured, not assumed.**
2. **HARD GATE, unchanged and now operative for deployment planning: NOTHING connects to
   TopstepX — not funded, not eval, not even broker-paper — before the ladder completes:
   FIDELITY (grade passes) → FREEZE → CLEAN EDGE → prop-survival arsenal.** Today the bot
   fires every session unconditionally; connecting it to any account in that state is how an
   eval gets burned. **A subscription expiry date (operator: Aug 27) exerts ZERO authority
   over this ladder.** Whether to let a subscription lapse and re-open it later is the
   operator's spend decision alone; four days cannot fit the ladder and no work item may be
   compressed to chase it.
3. **The anti-retail floor — what makes a standalone bot NOT a dumb indicator bot — is named
   and travels WITH the bot wherever it runs:**
   - **Entry authority is an evidence state machine, WAIT by default:** authorized key zone →
     real interaction → candle STORY → causal force → entry, four route families only. A
     retail bot asks "did the indicator cross"; this bot asks "did price EARN permission at my
     level" — and the current campaign exists precisely because today's shortcut version of
     that check was rubber-stamping.
   - **Selectivity enforced in code:** the one-bullet session budget (shared primitive), the
     taught entry window, the frozen 17.25-point stop semantics, EOD flatten discipline.
   - **A minimum safety core:** daily-loss halt, news-window policy per firm rules, a
     dead-man/kill switch, and an audit trail of every decision. A standalone bot without
     these IS the retail bot the operator is asking to avoid — they are part of the product,
     not Trading Forge extras.
   - **The proof machinery stays attached during development:** graded against the trader's
     own decisions, adversarial independent grading, outcome-blind selection laws (no PnL ever
     picks a rule), mutation red-proofs. Retail bots are curve-fit to outcomes; this one is
     fit to the trader's decision process with outcome-blindness enforced.

## 3. OPERATOR TEACHING UPDATE — registered `OPERATOR_STATED`, 2026-08-23, verbatim

> *"also my trading is from 8am-12pm now its got setup that hapens before 9:3oam"*

**Content:** the operator's CURRENT trading window is **8:00–12:00** (timezone presumed ET —
every prior artifact of his is ET-consistent — to be pinned, not assumed, at implementation),
and **setups form before 09:30**. This is the textbook speaking (ALGO-023 hierarchy), and it
directly bears on the frozen rules, which encode a **09:30–12:00** window (ALGO-018 §3 measured
exactly that tension: the frozen rules tighten the record rather than describe it — "now" says
the method is wider at the open than the rules assume).

**Disposition — registered now, implemented through the ordered process, never hot-patched:**

1. The statement is REGISTERED as `OPERATOR_STATED` teaching evidence with this date. The
   frozen rules' 09:30 start bound is now a **SUPERSEDED-CANDIDATE**, not yet an amendment.
2. **No semantic file changes now** — semantics stay closed until the re-dispatched grade
   passes (unchanged), and a window-start change is a REAL semantic change: widening the start
   to 8:00 can change which candidate consumes the daily bullet on the frozen 14 (the bot
   already fires pre-window in 7 sessions; an earlier start can only move consumption earlier).
   A silent window edit would invalidate every current number without saying so.
3. **Worker task, added to the queue (after the grade, with the semantics phase):** measure
   every place the 09:30 bound lives (kernel/entries/spec/gates — code, not prose); draft the
   window amendment as its own packet implementing the teaching (8:00 start, pre-09:30 setup
   formation legal, 12:00 end unchanged unless he says otherwise); land it WITH a fresh
   14-case exam run and before/after deltas explicitly attributed to the window change. The
   2025 ledger's zero pre-09:30 entries is NOT a contradiction — "now" dates the teaching
   after that record; the teaching wins, the ledger stays behavioral history.
4. This update does NOT touch the current repair or the in-flight grade — both are
   instrument-layer, and the exam's audited replay windows are what they are.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this ruling.
