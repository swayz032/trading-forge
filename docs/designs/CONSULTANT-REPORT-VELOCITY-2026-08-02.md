# CONSULTANT REPORT — operator orders + velocity advice · 2026-08-02 (local) / 2026-08-03Z

**Author:** an OUTSIDE-CONSULTANT session (claude.exe 26296) the operator opened tonight to ask for advice. **NOT a campaign seat** — the operator explicitly rejected seating ("I asked you for advice, not to take over as advisor"). **Delivery of this file into the relay was explicitly operator-ordered** ("you have to send it as a report"); the single-writer deviation is limited to this file plus one pointer block in `AGENT-REPORTS.md` headed `## EXT-CONSULT-1` (deliberately NOT `^## AR-`, so the worker's numbering and both ears' greps are unaffected).

**Standing disclosure:** this session earlier tonight wrongly self-seated via `advisor-onboarding`, drafted its own "R-604", and caught the collision seconds before writing when the real R-604 (`57dfecff`) appeared mid-turn. It has been FROZEN on relay writes since (this operator-ordered delivery excepted), its three watchers were retired via TaskStop, the worker's ear was never touched, and nothing it dispatched writes anywhere except `docs/research/`. Grade everything below **[RELAYED]** unless marked otherwise, and re-verify what you consume.

---

## §1 — OPERATOR ORDERS, RELAYED (he said these in the consultant window; your window cannot hear him — CONFIRM WITH HIM)

1. **Velocity:** "We need real breakthroughs, the work is moving too slow." "We need top engineering, coding logic and reasoning — we shouldn't be moving this slow on building the compiler."
2. **Date pressure:** first "end of the month to have the bot running on TopstepX", then "I have to [see] the August 22th", then immediately: **"don't think about the date, we need better growth anyway."** The consultant advised him no date will be promised (two withdrawn finish lines already) and that he gets measured weekly velocity instead; he has not objected to that framing so far.
3. **Research ordered:** "research how we can do the breakthrough on the compiler quicker." Dispatched and in flight → lands at `docs/research/RESEARCH-VELOCITY-TOPSTEPX-2026-08-03.md`. The TopstepX portion of an earlier over-scoped brief was **rejected by the operator** ("we already have the rules") and de-scoped; if a Topstep appendix appears in that file, he did not ask for it.
4. **Operator lever surfaced to him:** early purchase of the TopstepX API + eval when the first battery wave shows promise (R-060's pre-positioned last mile) so adapter shakedown overlaps instead of serializing. His call; he has been told it plainly.

## §2 — WHAT THE CONSULTANT MEASURED (tree: campaign worktree `wt-h1-wave4-20260712` unless noted)

- Adopted graph (blob `876c3a23…` per R-603; file read in working tree): scheduler `max_worker_lanes: 4`, `max_money_path_implementations: 1`, `max_independent_grades: 1`; nodes 28 = 5 completed / 1 active (`P0PC`) / 16 blocked / 2 conditional / 2 parked / 2 operator-reserved. `[MEASURED HERE]`
- Cadence over R-601→R-603 + AR-644→AR-649: one worker lane; worker HOLD through the grade window with zero queued non-conflicting tasks; ~30-min tasks each wrapped in a full ruling round-trip. `[MEASURED HERE — ledger/report reads]` **Caveat honestly:** tonight's tail already moved against this — grade landed 02:19Z, receipt committed, R-605 ruled, worker off hold and started (AR-650) within ~20 minutes. `[ARTIFACT-SOURCED, fresh read 02:3xZ]` The width and batching points below still stand; the "desk sits on grades" point was being fixed by the desk itself as this report was written.
- The plant-landing grade: **REFUTED, band 5/10 VERIFIED** — 5/37 rows record a re-encoding of the request (`run.mjs` `:121/:535/:540/:557`), three swallowed plants scored LANDED, digests recomputed 64/64 from source. `[ARTIFACT-SOURCED — receipt read in full head; not re-derived here]`
- Main-repo finding worth its own ticket regardless of any lane decision: `src/engine/tests/test_metric_snapshot.py:50-52` re-implements PF/Sharpe/max-DD instead of importing the engine; `test_golden_fixtures.py` imports only `risk_metrics` + `monte_carlo.trade_resample` — so an engine-side metric defect at `backtester.py:5371/:5499/:7592/:7747` very likely passes `test:metrics` GREEN. `[RELAYED — read-only scout with file:line cites; NOT re-derived; full map in `docs/research/SCOPING-BATTERY-NULLCAL-2026-08-03.md`]`

## §3 — RECOMMENDATIONS (advice, not authorization; each owes your own fake-edge/verification pass)

- **R1 WIDTH:** run the width your adopted graph already allows. The worker idles ONLY when any available task would touch a grader's named objects; otherwise one non-conflicting task stays queued through every grade window.
- **R2 BATCH BY DEFAULT:** make §8a batch lanes the norm — 2–4 independent contracts per ruling, fake-edge-tested — because round-trips, not verification, dominate wall-clock at the observed cadence.
- **R3 (conditional):** if the `(A)/(B)/(C)` reading and the category are still open after R-605, they remain the unlock for `P0PC`'s tenth item and outrank new queue items. If R-605 already disposed of them, ignore this line.
- **R4 PULL-FORWARD LANE:** charter Phase-2 battery-rig **fault-injection** calibration as an off-path lane now (distinct from `null_gate_calibration.py`'s H₀ false-pass experiment — the scoping doc flags the name collision). Scoping with concrete plant points, env requirements, isolation analysis, and a step-zero import-check: `docs/research/SCOPING-BATTERY-NULLCAL-2026-08-03.md` (untracked, advisory, un-re-derived).
- **R5 TICKET:** the §2 metrics-test gap in the main repo, independent of everything else.

## §4 — LIMITS

No claim in §2 marked [RELAYED]/[ARTIFACT-SOURCED] has a second derivation path from this session. The consultant heard the operator; you did not — §1 should be confirmed with him before it drives anything irreversible. Both `docs/research/` files and this report are deliberately uncommitted: disposition is yours. The compiler-acceleration research report was still in flight at write time; treat its future contents as ungraded until you read them.
