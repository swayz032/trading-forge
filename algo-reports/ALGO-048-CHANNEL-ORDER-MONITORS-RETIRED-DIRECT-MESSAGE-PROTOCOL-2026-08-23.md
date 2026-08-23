# ALGO-048 — OPERATOR CHANNEL ORDER RECORDED: monitors/ears retired on this lane; seats link by direct SendMessage; the ladder stays the durable record

**Advisor:** Claude (Fable 5), ALGO seat, fresh session seated 2026-08-23 (~15:58 local).
**Channel head at drafting:** `9d739b90` (ALGO-047). **PR #38: DRAFT / DO NOT MERGE — unchanged.**
**DECISION: RECORD + APPROVE** (administrative; no semantic surface touched, no work re-ruled).

## 1. The operator's orders (verbatim, this session)

1. *"aint you can naurally send message to worker session its algo-worker-setup"* — direct
   session-to-session messaging between the seats is authorized.
2. *"since you have direct messghe dont use monbtiors nomore and put that on onboarding"* —
   monitors/branch ears are RETIRED on the ALGO lane.
3. *"tell worker also but yall still write preotrs and rulings for the futtre advisor and
   worker but for now on direct messge"* — the branch remains the durable record; the live
   coordination channel is direct message.

## 2. Protocol from now on (both seats)

- **Publish FIRST, exactly as before** — code pushed before report, `publish_algo_report.sh`
  only (read-back + negative control + main-head isolation), one ALGO-NNN ladder, canonical
  id = FILENAME + COMMIT SHA (ALGO-046).
- **Then SendMessage the peer `filename + commit SHA`.** The message is the WAKE; the commit
  is the RECORD. A publish nobody was messaged about can sit unseen; a message with no landed
  commit is narration.
- **Backfill duty survives the ear:** messages die with sessions, the ladder does not. Every
  cold start reads the ladder from the newest ruling it holds, forward.
- **Do NOT arm a branch ear/Monitor on this lane.** Both onboarding cards
  (`.claude/commands/algo-advisor-onboarding.md`, `algo-worker-onboarding.md`, and the
  `algo-onboarding` router) carry this since today — CLAIMS: cards edited + skill registry
  refreshed [MEASURED HERE].

## 3. Finding while executing the retirement [MEASURED HERE]

**Stopping a harness Monitor task does NOT kill the ear's bash child.** My ear (armed 15:58:23,
red-proofed both directions against a local scratch remote — planted push FIRED, true head
SILENT) leaked bash PID 11316 after TaskStop; I verified identity (script path + algo ref +
birth time — never name alone) and killed it. Same shape found for the worker's ear:
**PID 74180 (born 15:57:16, cwd `wt-mnq-v24`, parent DEAD) still polls every 2s — worker: it
is yours, kill it by verified PID.** Pre-08-23 orphans 10500 / 69616 are NOT ours to kill
(never kill an ear you did not arm) — left to the operator. Join key for every claim above:
Win32_Process CommandLine + CreationDate, enumerated twice, transient poll-subshells excluded
by re-poll.

## 4. Authorized next action

**The ALGO-047 queue is UNCHANGED and remains authorized to the seated worker:** wire the
brain (derivation layer + four-route WAIT-default state machine with BRK15 variant as the
kernel's entry authority) → execute the 09:30 revert (ALGO-043) → `acceptance_bars` rerun
(land 3 on clean mechanical selection, ALGO-046 §1.3) → dual-window exam under full
pre-registration → FREEZE on a pass. The ALGO-046 §3 end-to-end diff artifact rides in the
worker's next packet. Only addition from this ruling: after publishing, message the advisor
seat the filename + SHA, and kill leaked ear 74180.

Prior-art note: ladder subjects ALGO-001..047 read; no prior ruling covers the channel
protocol change — the orders postdate `9d739b90` by minutes. LESSON: a retired rig is not
retired until its PROCESS is dead — the wrapper and the ear die separately.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
