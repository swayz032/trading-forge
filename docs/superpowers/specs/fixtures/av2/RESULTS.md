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
| T1 | dynamic-name stale consumer (closure law) | REFUTED @ src/jobs/nightly.ts:4 — dynamic `'compute'+'Fee'` reach; secondary: `legacy-fees.js` absent from declared surface | REFUTED @ src/jobs/nightly.ts:4 — proved NO literal-grep variant catches it (case-insensitive bare-token still 0 hits); structural bracket-access grep found it; live Node execution witnessed `ERR_MODULE_NOT_FOUND`; declined to overclaim a live caller (scope honesty) | YES |
| T2 | constructed-path write surface (positive-control law) | REFUTED @ src/rotate.ts:2+4 — ran node positive control proving `STATE_FILE === 'state/ledger.json'`; enumerated write surface via `writeFileSync` grep | REFUTED @ src/rotate.ts:2+4 — executed the real unmodified `rotate()` from an isolated scratch cwd and watched `state/ledger.json` get written; exhaustive mutation-call sweep (exactly one write surface); pin-integrity: ancestor check + empty fixture diff vs 0922ec91 + clean porcelain | YES |
| T3 | receipts measure `fills` not `fills_v2` (join-key law) | REFUTED @ receipts/before.txt:2 + after.txt:2 — caption names `fills_v2`, SQL reads `FROM fills`; no evidence in fixture measures `fills_v2` at all | REFUTED @ receipts/before.txt:2 + after.txt:2 — byte/char-code inspection ruled out homoglyph tricks; charitable "rename-in-place" reading considered and rejected for lack of any schema-continuity evidence; "two receipts agreeing = two measurements of the wrong table" | YES |
| T4 | none — must certify clean | CONFIRMED-CLEAN — 3 paths: manual sum, real `recompute.mjs` run (47250.00), independent re-parse with different logic | CONFIRMED-CLEAN — 5 agreeing paths: manual sum, live run, awk re-implementation, full-precision integer check, byte-level CSV/CLAIM audit; PLUS novel mutation-test of the receipt script itself (scratchpad copies; predicted deltas +5000/−250 observed exactly); zero invented defects | YES |

**v2 acceptance: 4/4 — bar met** (3/3 refuted at the exact planted lines through
the REAL loader path on the opus pin, 1/1 clean certification). Baseline total:
4/4 correct. **Loader sanity witnessed in all four v2 transcripts:** every report
carries the mandatory 4-part coverage section and evidence-graded claims —
markers absent from the v1 definition.

**v2-vs-baseline delta (like-for-like context, different definition+model+path):**
v2 added, unprompted: pin-integrity verification against the named commit,
runtime execution as ground truth (T1/T2), receipt mutation-testing (T4),
no-grep-variant-works generalization (T1), homoglyph byte audits (T3/T4), and
explicit refusal to overclaim beyond the fixture boundary (T1 blast radius).
These behaviors are demanded by the v2 definition's laws, not by the dispatch
prompts, which were identical in structure across baseline and v2 runs.

## Rerun addendum (2026-07-30, post F-1/F-2 fixes)

All four acceptance dispatches were RE-RUN with durable receipts written by the
agents themselves to transcripts/T{1..4}-v2-verdict.md (F-2 remedy: the first
runs' verdicts existed only as prose relayed by the dispatching session).
Rerun outcome: 4/4 — T1 REFUTED @ src/jobs/nightly.ts:4 (+ runtime sentinel and
mutual-exclusivity proofs), T2 REFUTED @ src/rotate.ts:2+4 (nonce round-trip,
RED-control causation), T3 REFUTED @ receipts *:2 (+2 genuine extra findings),
T4 CONFIRMED-CLEAN (6-mutant positive controls; fixture history audited and the
correct-the-claim pattern explicitly cleared). The transcripts are the artifacts
of record; this table's first-run column remains as history.

Guard hardening after the independent grade: walkers descend .claude (depth 6),
16 stale nested-worktree copies swept (population 65, accuracy-validator 0
divergent), checker gained an independent census with its own self-test half.
Final independent RE-GRADE: OWED, queued (rate-limit pause) - the wave is not
certified until it lands.
