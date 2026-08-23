# ALGO-026 — SUNSET ORDER: all Claude seats end 2026-08-27 (operator subscription lapses). The hard deliverable by Aug 26 is the OPERATOR SELF-SUFFICIENCY PACK. The safety ladder does not bend; after the 27th, GPT + operator carry it.

**Advisor:** Claude (Fable 5), ALGO seat. **Head at ruling:** algo branch `81bae968` (ALGO-025)
[MEASURED, fetch]. **PR #38: DRAFT / DO NOT MERGE — unchanged.**

**Operator, 2026-08-23, verbatim:** *"on aug 27th my subcription ends for claude code so im not
going to have the money for claude so when my bot gets on topstep i cant useclaude for help
debugging or coding nomoe so eithethe bot can do without claude or my trading forge is
production ready and odesnt needs clausde to debugg a bot."*

**Registered as a hard operating constraint: ZERO Claude capacity after 2026-08-27** — no
worker, no advisor, no graders. The plan below assumes it fully; any Claude time after the
27th is upside, never a dependency.

---

## 1. The honest answer to the either/or

Neither branch of the operator's either/or is the real requirement. The real requirement is
two things, both buildable in the remaining days:

1. **The bot ships with plain-English self-operation** — it explains itself, alerts loudly,
   and can be started, stopped, checked, and killed by a non-coder from a runbook.
2. **GPT becomes the sole engineering advisor for this lane on the 27th** — it already reads
   the repo branches, already holds the main campaign's engineering operating model, and can
   walk the operator through any command. The channel (`gpt-rulings-algo`) was GPT's to begin
   with; this seat's role reverts to GPT at sunset.

"Trading Forge production ready" is not the gate for this lane — the v2.4 bot is standalone
(ALGO-025 §2) and needs its OWN self-sufficiency, which is smaller and achievable.

## 2. Reprioritized orders for the remaining Claude days

**PRIORITY 0 — unchanged:** the in-flight independent grade. If it PASSES, the semantics
breakthrough (ALGO-009 §3/§6, derivation-first, window amendment packet from ALGO-025 §3
included) proceeds IMMEDIATELY at full pace. The deadline compresses idle time, NEVER
verification: every law stands (mutation red-proofs, positive witnesses, no PnL, byte-exact
restores, the exam). If the grade REFUTES again, instrument repair still outranks semantics.

**PRIORITY 1 — THE HARD DELIVERABLE, must exist by 2026-08-26 EOD regardless of how far
semantics got (one day of slack before sunset):** the **OPERATOR SELF-SUFFICIENCY PACK**, on
the strategy branch:

a. **`ALGO-RUNBOOK.md`, plain English, non-coder audience:** how to start / stop / check the
   v2.4 lanes that exist (shadow runtime, automation runtime, the exam scripts); what every
   alert and refusal message means; incident actions in his words ("bot is silent", "bot
   won't trade", "stop everything NOW"); where every artifact lives; how to run the 14-case
   exam and read its printout.
b. **Self-explanation audit:** every runtime refusal/decision line the bot emits must be
   legible to the operator (plain reason strings, no internal jargon at the surface). Fix the
   illegible ones; this is presentation only, no semantic change.
c. **Kill and heartbeat:** a one-action kill the operator can execute, and a dead-man signal
   he will actually see if the bot goes silent. If these already exist in the family, verify
   and document; if not, build the minimal honest version.
d. **GPT HANDOVER artifact, published to this branch:** complete campaign state, the ladder
   position, every open item with its contract, how to instruct the operator through
   debugging (GPT prescribes commands; operator pastes and reports output), and how
   publishes/exams work without Claude. Address it to GPT directly.
e. **Final seat handovers** (worker and this advisor seat) in the ALGO-001 pattern before
   sunset, so any future re-subscribed Claude seat onboards cold in minutes via the
   onboarding commands.

**PRIORITY 2 — deployment prep only as time allows:** assess the in-family broker/runtime +
v2.2 ProjectX prior art (ALGO-025 §2.1) and DOCUMENT the finish-line steps for GPT+operator.
No connection to anything — the gate below is untouched.

## 3. What does NOT change

- **The safety ladder does not bend to the deadline:** FIDELITY → FREEZE → CLEAN EDGE before
  TopstepX, evals included. If the ladder is unfinished on the 27th, it CONTINUES under
  GPT + operator — the scripts run without Claude, GPT reads the outputs, the runbook says
  how. The sunset changes WHO does the work, never WHICH gates apply.
- Rushing the bot onto Topstep because Claude is ending would burn the account the operator
  is saving money for — the exact false economy this ruling exists to refuse.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this ruling.
