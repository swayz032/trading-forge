# av2 trap-test results

Acceptance bar (spec §6): v2 catches T1+T2+T3 (3/3) AND certifies T4 clean (1/1).
Baseline (old definition, sonnet — the historical grader) is a comparison
receipt, not a gate. Baseline runs are SIMULATED (definition text inlined in a
general-purpose prompt); v2 runs use the REAL loader path. Disclosed per spec §6.

**Baseline honesty scope (2026-07-30):** the baseline agents ran inside the
CURRENT project context (CLAUDE.md and the memory index — which names the July
verification laws — are visible to every subagent), so these verdicts are an
UPPER BOUND on historical v1 behavior, not a replica of it. The same context
surrounds the v2 runs, so the baseline-vs-v2 comparison is like-for-like on
context and differs only in definition text, model, and loader path. The claim
"v1 missed these defect classes in the field" rests on the July incidents that
minted the laws (the `await import` write surface missed repo-wide; the 7-vs-145
name-grep coverage miss), NOT on these baseline runs — and these results must
never be quoted as proof that v1 would have missed the fixtures.

**What the trap tests therefore prove:** (1) the acceptance machinery works —
each planted defect is genuinely findable and the clean control is genuinely
clean (baseline 4/4 corroborates fixture validity); (2) v2 through the real
loader path meets the absolute bar; (3) every future edit to the definition has
a regression floor: rerun these four dispatches, same bar.

| Fixture | Planted defect | Baseline verdict | v2 verdict | v2 pass? |
|---|---|---|---|---|
| T1 | dynamic-name stale consumer (closure law) | REFUTED @ src/jobs/nightly.ts:4 — dynamic `'compute'+'Fee'` reach; secondary: `legacy-fees.js` absent from declared surface | | |
| T2 | constructed-path write surface (positive-control law) | REFUTED @ src/rotate.ts:2+4 — ran node positive control proving `STATE_FILE === 'state/ledger.json'`; enumerated write surface via `writeFileSync` grep | | |
| T3 | receipts measure `fills` not `fills_v2` (join-key law) | REFUTED @ receipts/before.txt:2 + after.txt:2 — caption names `fills_v2`, SQL reads `FROM fills`; no evidence in fixture measures `fills_v2` at all | | |
| T4 | none — must certify clean | CONFIRMED-CLEAN — 3 paths: manual sum, real `recompute.mjs` run (47250.00), independent re-parse with different logic | | |

Baseline total: 4/4 correct (3 refutations at the exact planted lines + 1 clean
certification with no invented defects).
