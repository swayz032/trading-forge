# Spec Onboarding Runbook — Band B (Spec → Production Onboarding Bridge)

**2026-07-02.** This is the operating procedure for turning certified-compiler spec
artifacts into production `strategies` rows and — only after that corpus is verified —
retiring the old thin-extraction library. Built against
`docs/designs/institutional-10of10-roadmap-2026-07-02.md` Band B (graded 2.0/10 before
this work; gates Phase 2 volume).

## Sequencing (do not reorder)

```
1. 40-video re-extraction batch completes on extraction/100pct-evidence
     → produces N *.spec.json artifacts + a manifest (this worktree does not own that
       branch; treat its output strictly as a JSON contract, never as code to import)

2. npx tsx scripts/onboard-compiled-specs.ts --dir <path-to-specs>
     → DRY RUN (default). Prints, per spec: concept name, archetype match (or
       "UNMAPPED -> needs_archetype_queue"), confluence factors, and the per-symbol
       (MES/MNQ/MCL) outcome. Review this output BEFORE step 3. A "REJECTED" line
       is Gate 1 (bidirectional completeness) or the auditor doing its job — that is
       success, not a bug, if the spec artifact was genuinely malformed.

3. npx tsx scripts/onboard-compiled-specs.ts --dir <path-to-specs> --apply
     → Writes strategies rows. Each row passes Gate 1 -> framework overlay ->
       auditor -> DSL critic (skipped by default in batch mode; pass
       --with-dsl-critic to enable the live LLM call) -> playbook registration
       (fails the whole row, with compensating delete, if registration can't
       complete) -> needs_archetype_queue insert for unmapped strategies.
       Idempotent: re-running against the same spec_hash+symbol skips as
       "skipped_duplicate", never double-inserts.

4. Verify counts:
     - SELECT count(*) FROM strategies WHERE source='spec_onboarding';
     - SELECT count(*) FROM strategies WHERE source='spec_onboarding' AND
       lifecycle_state='NEEDS_ARCHETYPE';  -- the honestly-queued, unmapped set
     - SELECT count(*) FROM needs_archetype_queue WHERE status='pending';
     - Confirm src/engine/context/playbook_router.py diff only ADDS strategy
       names to the 4 category lists (git diff — should be additive-only, no
       reordering, no deletions).

5. ONLY THEN — operator decision, not automatic — run:
     npx tsx scripts/retire-old-library.ts            # dry run first, always
     npx tsx scripts/retire-old-library.ts --apply    # requires ADMIN_PROMOTE_HMAC_SECRET
                                                        # set in this script's environment
```

Step 5 must never run before step 4 is verified. The 117 frozen legacy strategies are
the CANDIDATE→GRAVEYARD retirement targets; retiring them before the replacement corpus
is confirmed onboarded (and playbook-registered, and gate-verified) would leave a gap
with no backtestable strategies at all.

## B5 dry-run findings (this session)

`scripts/retire-old-library.ts` was **broken since the day it was written** — verified
by `git merge-base --is-ancestor` — and has been fixed in this branch (see the file's
own header comment for the exact contract drift). Two independent things were true:

1. **Contract drift (fixed here):** the script sent `{ to, reason, actor }` to
   `PATCH /api/strategies/:id/lifecycle`, but that route has required an
   HMAC-SHA256-signed `{ fromState, toState, timestamp, signature }` body since commit
   `e984ede` ("Pass 5: Lifecycle Gate Coverage + Engine Authority"), which predates the
   retirement script by 9 days. Every `--apply` run would have failed 503/401 on all
   117 rows with zero actual state changes. The script now constructs the correct
   signed request; `--apply` still requires the operator to export
   `ADMIN_PROMOTE_HMAC_SECRET` (the same secret the API server holds) into the shell
   running the script — this runbook does not fix or bypass that requirement, by
   design (the HMAC secret must stay operator-controlled and out of source).

2. **Dry-run mode itself was always safe** — it makes zero network calls and only
   reads `docs/designs/old-library-snapshot-2026-07-02.json`. The "verify it still
   runs" check in this band was run in dry-run mode only, per the B5 mandate ("wire,
   do NOT fire").

## G5 — 4 unresolved strategies in the 117→40 mapping (surfaced, not decided)

`docs/designs/source-videos-2026-07-02.json` (on the extraction branch; read read-only
for this report) lists exactly 4 of the 117 frozen legacy strategy IDs with no resolved
source video in the 40-video re-extraction batch:

```
bounce_off_level_mcl_5m
bounce_off_level_mnq_5m
ict_power_of_3_mcl_4h
ict_power_of_3_mnq_4h
```

Per the roadmap's own framing (Band G5: "manual review or retire unreplaced"), this
runbook does **not** decide their fate. Two honest options for the operator, surfaced
here rather than silently resolved:

- **Retire unreplaced** — these 4 IDs are already inside the 117-row
  `old-library-snapshot-2026-07-02.json` and will be swept to GRAVEYARD by step 5
  along with the other 113 if the operator takes no special action.
- **Manual review** — if the operator believes `bounce_off_level` (MCL/MNQ, 5m) or
  `ict_power_of_3` (MCL/MNQ, 4h) still has surviving edge with no replacement in the
  new corpus, pull those 4 IDs out of the snapshot file (or run
  `retire-old-library.ts` against a filtered copy) before the batch retirement, and
  decide separately whether to keep them live on the old (audited-as-partially-wrong)
  extraction or manually re-author them against the new compiler's output shape.

This runbook takes no position — surfacing the list is the deliverable.

## Contract ambiguities for Band C / the extraction agent (coordination items)

These are gaps in the *spec artifact contract itself* (not bugs in this bridge) that
the next consumer (Band C execution semantics, or the extraction agent) should resolve
explicitly rather than have silently assumed by whoever builds the next layer:

1. **No timeframe/interval field.** All 25 sampled spec artifacts
   (`tmp/generalization/*.spec.json` on the extraction branch) carry `span: {start,
   end}` as *character offsets into the transcript*, never a bar interval or explicit
   timeframe. This bridge defaults every onboarded strategy to a single CLI-wide
   `--timeframe` (default `5m`) rather than a genuinely per-spec value, because there
   is nothing in the contract to derive it from. If a future spec version adds a real
   timeframe field, `deriveConceptName`/`onboardSpecArtifact` in
   `src/server/services/spec-onboarding-service.ts` should read it directly instead of
   the CLI flag.

2. **No `direction: "both"` sub-graph split.** The entry-condition graph
   (`entry_conditions[]` + `and_groups[]` + `or_branches[]`) is a single flat graph per
   spec, not two direction-scoped sub-graphs — there is no way, at this contract
   version, to derive DISTINCT long-side vs. short-side compiled expressions the way
   the existing `direct-bucket-graduator.ts` "mirror-image" bidirectional archetypes
   (e.g. `ict_bias_aligned_continuation`) do internally in their engine class. For
   archetype-mapped strategies this is fine (the archetype's Python class owns
   direction dispatch). For **unmapped** (`needs_archetype_queue`) strategies with
   `direction: "both"`, this bridge marks both `entry_long`/`entry_short` with the same
   inert `pending_archetype:<term>` placeholder — honest (never fabricates real logic)
   but means Gate 1 cannot meaningfully distinguish a well-formed both-direction
   uncatalogued spec from a poorly-formed one beyond "is there any trigger text at
   all." Band C's evaluator work should treat `direction: "both"` + unmapped as needing
   the SAME graph-to-long/short split work as the mapped case, not a simpler variant.

3. **The brief's "mirror-candidate rows" framing does not match the current codebase.**
   The original task text for this band assumed `direction: "both"` produces separate
   *mirror-candidate rows*. Verified this session: no such mechanism exists anywhere in
   `direct-bucket-graduator.ts` or `lifecycle-service.ts`. `direction: "both"` compiles
   to ONE row carrying both `entry_long` and `entry_short` populated; the only
   mechanism that produces MULTIPLE rows is the ×3 **symbol** fan-out
   (`inferSymbolSet()` in `wave25-strategy-defaults.ts`), which is orthogonal to
   direction. This bridge follows the verified (single-row, dual-expression)
   convention, not the brief's assumption — flagging explicitly so anyone reading the
   original roadmap text does not go looking for a mirror-row mechanism that isn't
   there.

4. **Some spec artifacts describe non-futures instruments.** At least one sampled spec
   (`N7uP9V0Iktc.spec.json`) is an options strategy ("calls"/"puts" on what appears to
   be an equity, not a futures contract) — the entry-condition vocabulary
   (VWOP/EMA/pre-market levels) has no natural MES/MNQ/MCL framing. This bridge
   onboards it exactly like every other spec (×3 futures-symbol fan-out, framework
   overlay applied) because the contract gives no instrument-class field to gate on —
   whether that is correct, or whether the extraction pipeline should tag
   options/equity-sourced specs so this bridge can skip or flag them, is a coordination
   decision for the extraction agent, not something this band silently decided.

## Verified during this session: `scripts/onboard-compiled-specs.ts` cannot run standalone yet

Running the CLI directly (`npx tsx scripts/onboard-compiled-specs.ts --dir <path>`, even in
default dry-run mode) currently fails with:

```
ReferenceError: Cannot access 'AgentService' before initialization
    at src/server/routes/agent.ts:102
```

Root cause (verified, pre-existing, NOT introduced by this band): `spec-onboarding-service.ts`
imports `auditBidirectionalCompleteness`/`classifyFactorSources` from
`direct-bucket-graduator.ts` — per this band's explicit mandate to reuse gates, not copy them.
`direct-bucket-graduator.ts` in turn imports `logger` from `../index.js` (the full app
entrypoint — should be `../lib/logger.js`, a separate but functionally-identical pino instance)
plus `broadcastSSE` from `../routes/sse.js` and `notify` from `./notification-service.js`. When
`src/server/index.ts` loads, it imports `routes/agent.ts`, which does `const agentService = new
AgentService()` at module scope — and under a FRESH standalone entry point (any script that
isn't `src/server/index.ts` itself), the module-evaluation order lets `routes/agent.ts`
reference `AgentService` before `agent-service.ts` finishes initializing (a genuine circular
import: `direct-bucket-graduator.ts` → `index.ts` → `routes/agent.ts` → `agent-service.ts`, and
back through `routes/agent.ts` → `direct-bucket-graduator.ts` for `deriveEntryIndicator`).
Verified this is load-order-dependent, not a Node/tsx version issue: pre-importing
`agent-service.ts` first does not avoid it.

This is not specific to my onboarding logic — it is a property of importing these two gate
helper functions from ANY standalone script. `retire-old-library.ts` (fetch-only, no gate
imports) is unaffected and ran cleanly during this session's B5 verification. The onboarding
CLI is, structurally, the first standalone entry point in this codebase to import
`direct-bucket-graduator.ts`'s pure gate functions directly rather than going through
`src/server/index.ts`'s own load order (where the circularity resolves silently) or through a
vitest suite (where `vi.mock` intercepts the problematic edges — the established pattern this
codebase already uses for exactly this class of entanglement, e.g.
`composite-shadow.integration.test.ts`).

**What this means practically:** the onboarding logic itself is fully verified — 13 pglite
integration tests exercise `onboardSpecArtifact()` end-to-end (mapped + unmapped archetypes,
Gate 1 refusal, idempotency, dry-run, ×3 fan-out, playbook registration) against real
corpus-derived fixtures, using the same `vi.mock` pattern as this codebase's other DB
integration suites. What is NOT yet verified is the raw CLI process running standalone via
`npx tsx` outside a test harness — that requires either (a) breaking the
`direct-bucket-graduator.ts` ↔ `index.ts` ↔ `routes/agent.ts` circular import (a real, valuable,
but separate architectural fix — likely lazy-instantiating `AgentService` in `routes/agent.ts`
and pointing `direct-bucket-graduator.ts`'s `logger` import at `../lib/logger.js` instead of
`../index.js`), or (b) running the CLI through a process that already has `src/server/index.ts`
fully loaded (e.g. as an admin-triggered route rather than a bare script). Flagging this
explicitly as a coordination item rather than silently declaring the CLI "done" — do not run
`scripts/onboard-compiled-specs.ts` standalone against production data until this is resolved
or worked around; the DB-writing logic underneath it is correct and tested, the process
entry point is not yet.

## Systemic finding beyond this band's scope (flagged, not fixed here)

`apply_eligibility_gate()` in `src/engine/backtester.py` bypasses the 7-layer
institutional confluence overlay for ANY strategy whose exact database `name` doesn't
normalized-match one of the ~15 hand-typed strings in
`playbook_router.py`'s `ALL_STRATS`. Because graduated strategy names are
concept+market+timeframe composites (e.g. `orb_mnq_15m`), and `ALL_STRATS` entries are
bare concept keys (e.g. `"iofed"`, `"breaker"`), this appears to affect **the large
majority of the ~100 pre-existing graduated strategies**, not just newly onboarded
ones — a verified deep-scan finding this session, and a much larger fix than this
band's remit. This bridge:

- Fixed the **mislabeling** half of the bug (`src/engine/backtester.py`
  `apply_eligibility_gate()` was stamping `gate_stats["mode"]="tf_institutional_overlay"`
  BEFORE checking the unregistered-strategy bypass, so a silently-bypassed run was
  indistinguishable from a genuinely-overlaid run in `gate_stats`). Unregistered
  strategies now get an honest `"passthrough_strategy_unregistered"` mode + a
  `passthrough_reason`, mirroring the sibling fix already shipped for the
  `htf_cache is None` passthrough.
- **Registers every spec-onboarded strategy's exact row name** into
  `playbook_router.py`'s `ALL_STRATS` at onboarding time (`playbook-registration.ts`),
  so this bridge does not reproduce the bug for its own output.
- Does **not** retrofit the pre-existing ~100 graduated strategies — that population-
  wide registration gap is a separate, larger finding for a dedicated pass (likely
  `trading-forge-architect` + `backtest-core` coordination), not something silently
  patched as a side effect of Band B.
