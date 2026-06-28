# Pre-Sync Baseline — 2026-06-28 (NOT a validation result)

> **This is a baseline characterization, not a preregistered validation run. It does NOT count toward Gate 1.**
> Recorded so there is a clean, timestamped "before" against which the post-synchronization Gate 1 run is
> later judged.

| field | value |
|---|---|
| **Purpose** | Establish the known starting state of the production backend BEFORE the extraction-subsystem sync. |
| **Backend measured** | `:4000` (production) running branch `hardening/phase-0` — lacks the `schemaOverride` extraction fix. |
| **Source** | stored outputs `tmp/generalization/*.result.json` (the original `:4000` run) scored vs `extraction-golden-2026-06-28.json`. No fresh extraction was issued against `:4000` (avoids loading the other agent's backend). |
| **Expected outcome** | FAIL, due to the known branch divergence. |
| **Interpretation** | This is NOT a validation result and does NOT count toward Gate 1. It documents the pre-sync state only. |

## Measurement

| video | speaker_items (pre-sync) | golden | outcome |
|---|---|---|---|
| psH--oXkD8M | 0 | 7 | FAIL (0 items = stale branch) |
| l-2iKbcm5UI | 0 | 7 | FAIL |
| h6TnE7QClJg | 0 | 10 | FAIL |
| MKsjbL0WNjg | 0 | 22 | FAIL |

**Pre-sync baseline: 0/4 non-zero (expected 0).** Coverage verdict `coverage_failed` on all four — the
self-evident-heuristic fallback that fires when the enumerator returns nothing (the `schemaOverride` fix is
absent on `hardening/phase-0`).

## Label discipline (so history is clear)

| run | endpoint | expected | counts as Gate 1? |
|---|---|---|---|
| **Pre-sync baseline** (this doc) | `:4000` (stale prod) | FAIL | NO — documents the "before" |
| **Reference self-check** (not run) | the branch that produced the golden | PASS | NO — checks a system against its own reference |
| **Gate 1 validation** (future) | `:4000` AFTER the sync lands | unknown — that's the test | **YES** — the real preregistered run |

The first run of `scripts/verify-extraction-golden.ts` against `:4000` **after** the extraction-subsystem sync
is the actual Gate 1 validation under the frozen protocol (`validation-preregistration.md`). Neither this
baseline nor a reference self-check substitutes for it.

## Next milestones (no further offline evidence until then)

1. Synchronize the extraction subsystem onto the production branch (coordination — owner of `hardening/phase-0`).
2. Run the actual Gate 1 validation against the synchronized `:4000`.
3. If Gate 1 PASS → replay (Gate 2), once engine-attach exists.
4. If Gate 2 PASS → blind validation (Gate 3).
