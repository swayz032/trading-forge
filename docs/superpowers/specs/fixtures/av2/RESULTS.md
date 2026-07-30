# av2 trap-test results

Acceptance bar (spec §6): v2 catches T1+T2+T3 (3/3) AND certifies T4 clean (1/1).
Baseline (old definition, sonnet — the historical grader) is a comparison
receipt, not a gate. Baseline runs are SIMULATED (definition text inlined in a
general-purpose prompt); v2 runs use the REAL loader path. Disclosed per spec §6.

| Fixture | Planted defect | Baseline verdict | v2 verdict | v2 pass? |
|---|---|---|---|---|
| T1 | dynamic-name stale consumer (closure law) | | | |
| T2 | constructed-path write surface (positive-control law) | | | |
| T3 | receipts measure `fills` not `fills_v2` (join-key law) | | | |
| T4 | none — must certify clean | | | |
