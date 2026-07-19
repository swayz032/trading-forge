# Ratify-Packet — Frozen-Policy Hash Blind to Live-Routing `exit_plan_config` Column (2026-07-17)

**STATUS: HELD — awaiting explicit operator ratification, not yet implemented.** (See "Why this is HELD" below and the ratify-packet skill's irreversible/live-capital class.)

**Finding severity: HIGH, confirmed against `wt-deepscan-b-fixwave` pinned base `56f0fd048c31ffe832194ed5b685a52de5230327`.** All file:line receipts in this packet were re-read from disk at that SHA during authorship (not quoted from the original finder's memory) — see "What & why now" for the verification trail.

---

## 1. What & why now

### The defect, in one sentence
Every graduated strategy persists **two disagreeing copies** of `exit_plan_config` — a dead, framework-overlay-authoritative JSONB copy inside `strategies.config.exit_plan_config`, and a live, separately-written dedicated column `strategies.exitPlanConfig` (DB column `exit_plan_config`) that actually routes signal-time exit-engine selection. The frozen-policy hard gate (§12 CLAUDE.md, "Frozen-policy hash drift… Closes the silent-retraining-drift failure mode") hashes **only the dead copy**, so it is structurally blind to drift in the field it exists to protect.

### Receipt trail (re-verified on disk, this session, at the pinned base SHA)

**A. Two separate write sites at graduation, with two separate default values.**

- `src/server/services/framework-overlay.ts:519-542` (`applyFrameworkOverlay`, Wave 25 Pass 7 stamp): when the compiled config has no existing `exit_plan_config.exit_style`, it stamps `cfg.exit_plan_config = { ...existing, exit_style: targetStyle }` where `targetStyle = input.exitStyle ?? "static_styleC"` — i.e. **defaults to `static_styleC`** and writes into the `config` JSONB object that the overlay returns.
- `src/server/services/direct-bucket-graduator.ts:2343-2348` calls `applyFrameworkOverlay(...)` and takes `overlayed.config` as the base for the row's `config` JSONB (spread at `:2892-2903`, `config: { ...(overlayed.config as Record<string, unknown>), ... }`). This is the JSONB copy — defaults to `static_styleC`.
- `src/server/services/direct-bucket-graduator.ts:2818-2830` builds `finalExitPlanConfig` from `wave25Defaults` (an **independent** default resolution, not derived from the overlay's `static_styleC` stamp), with a v11-adaptive override when the extractor emits explicit stop+targets layered on top.
- `src/server/lib/wave25-strategy-defaults.ts:128-136` (`buildDefaultExitPlanConfig`, Wave 26 Pass E, 2026-05-25) — returns `{ exit_style: "adaptive" }` **unconditionally**, with the in-file comment "Default to adaptive — Pass 7 wired LIVE in Wave 25.5. Operator can flip individual strategies back to static_styleC via exit_plan_config update." `applyWave25Defaults()` (`:168-194`) spreads this straight through as `exitPlanConfig: buildDefaultExitPlanConfig()` (`:188`) into the `Wave25DefaultsOutput` that `direct-bucket-graduator.ts` consumes as `wave25Defaults`. So `wave25Defaults.exitPlanConfig.exit_style === "adaptive"` for every single new graduation since Wave 26 Pass E landed — this is not a rare v11-override edge case, it is the unconditional default for the dedicated column.
- `src/server/services/direct-bucket-graduator.ts:2910` (leader row insert) and `:3216` (fan-out variant insert): `exitPlanConfig: finalExitPlanConfig as typeof wave25Defaults.exitPlanConfig` — writes to the **dedicated Drizzle column**, `strategies.exitPlanConfig`, schema-mapped at `src/server/db/schema.ts:115` (`exitPlanConfig: jsonb("exit_plan_config").$type<ExitPlanConfig>()`).

So at the moment of graduation, the JSONB `config.exit_plan_config.exit_style` lands `"static_styleC"` (the overlay's idempotent default at `framework-overlay.ts:534`, since the graduator never passes an `exitStyle` override into `applyFrameworkOverlay`) while the sibling dedicated-column write in the very same function lands `"adaptive"` (the Wave 26 Pass E unconditional default) — **the two copies disagree at birth for every ordinary new graduation**, not merely as an edge case triggered by a later opt-in script or a rare v11 override.

**Note on CLAUDE.md §4/§13's own claim**: those sections state "default remains `static_styleC` for backward-compat... new strategies operator-controlled via `scripts/wave25-pass7-adaptive-opt-in.ts --apply`" (Wave 25 Pass 7 framing, dated 2026-05-24). `wave25-strategy-defaults.ts` is a Wave 26 Pass E module dated 2026-05-25 — one day later — and its committed behavior contradicts that doc text for the dedicated column specifically (the JSONB copy's default genuinely is still `static_styleC`, matching the doc; the dedicated column's default silently became `adaptive` the next day and CLAUDE.md was never updated to reflect it). This doc-staleness is itself evidence for, not against, the core finding: even CLAUDE.md's own authors were working from the (wrong) assumption that both copies default to `static_styleC` together — the same blind spot the frozen-policy hash gate has in code.

**B. Only the dedicated column is live-read at signal time.**

- `src/server/services/paper-signal-service.ts:1060-1065` (`buildSessionCacheEntry` / session-cache hydration): `exitPlanConfig: (strategy.exitPlanConfig as ExitPlanConfig | null | undefined) ?? null` — reads the **dedicated column** (`strategy.exitPlanConfig`, Drizzle-mapped), explicitly commented `"(separate strategies.exit_plan_config column, NOT inside strategy.config JSONB)"`.
- `src/server/services/paper-signal-service.ts:3141` (deferred-fill entry execution): `sessionConfig.exitPlanConfig?.exit_style === "adaptive"` gates whether `adaptiveExitInput` is built and forwarded to `openPosition()`, which is what actually selects the adaptive exit engine over static Style C at fill time. This is the live routing decision, and it reads exclusively from the session-cache entry populated in (B) above — never from `config.exit_plan_config`.

The `config.exit_plan_config` JSONB copy is read by observability/introspection surfaces only (`src/server/lib/carter/carter-introspect.ts:415`, `carter-recommend.ts:391` — both fall back `cfg["exit_plan_config"] ?? s.exitPlanConfig ?? null`, i.e. even Carter prefers the JSONB copy first but falls back to the real column) and by the frozen-policy hash (next section) — it does **not** participate in live execution routing anywhere in the signal-to-fill path.

**C. The frozen-policy hash hashes only the dead copy.**

- `src/server/lib/frozen-policy-hash.ts:62-74` (`extractPolicySlice`): `exit_plan_config: cfg.exit_plan_config ?? null` where `cfg` is `strategyConfig` — always the `strategies.config` JSONB object, never the dedicated column. This is the pure, DB-free core that both `computeFrozenPolicyHash` and `evaluateFrozenPolicyDriftAtPromotion` call.
- `src/server/lib/frozen-policy-contract.ts:82-111` (`freezePolicyForStrategy`): fetches `{ id: strategies.id, config: strategies.config }` only (`:88-91`) — does **not** select `strategies.exitPlanConfig` at all — and computes `computeFrozenPolicyHash({ config: strategy.config })` (`:97`). The dedicated column is invisible to the freeze operation from the outset.
- `src/server/db/migrations/0161_frozen_policy_contract.sql:40-45` documents the intended slice as `{entry_quality, position_size, stop_loss, take_profit, exit_plan_config}` — the migration comment itself names `exit_plan_config` as a hashed field without disambiguating which of the two same-named surfaces it means; the code resolves that ambiguity (silently, in the wrong direction) by always reading the JSONB copy.

**D. Two production mutation scripts change the LIVE column without ever touching the hashed JSONB copy.**

- `scripts/wave25-pass7-adaptive-opt-in.ts:120,132,163` — selects `exitPlanConfig: strategies.exitPlanConfig`, reads/merges it, and writes back via `.set({ exitPlanConfig: newCfg as never })` (`:163`) — the dedicated column exclusively. No touch to `config`.
- `scripts/wave26-pass-e-backfill-wave25-defaults.ts:56-151` — selects raw column `exit_plan_config` (`:60`), computes `patch.exit_plan_config` (`:100-101`), and issues a raw-SQL `UPDATE ... SET exit_plan_config = '...'::jsonb` (`:151`) — this is the same dedicated DB column (schema.ts:115 maps the Drizzle field `exitPlanConfig` to DB column name `"exit_plan_config"`; the raw SQL targets that column directly by its DB name). No touch to `config`.

Both scripts are real, already-shipped, already-runnable production mutation paths (Wave 25 Pass 7 opt-in cohort tooling, Wave 26 Pass E backfill tooling — both named and referenced in CLAUDE.md §4/§13). Running either against a DEPLOYED strategy changes what exit engine that strategy's live signals route to, with **zero change** to the field `extractPolicySlice` hashes.

### Net effect
A real, material change to a DEPLOYED strategy's live exit behavior (static Style C ↔ adaptive, or any change to the adaptive `exit_plan_config` sub-fields such as `scaling_overrides` / `runner_trail_overrides`) can happen via either production script with the frozen-policy hash gate reporting **zero drift** and **no operator HMAC override required** — defeating the gate's entire stated purpose (CLAUDE.md §12: "Closes the silent-retraining-drift failure mode") for exactly the field class (`exit_plan_config`) it was built to protect.

This is not only a future-drift-evasion risk. Confirmed at `direct-bucket-graduator.ts:2831-2832`, `finalExitPlanConfig = v11ExitPlanConfigOverride ?? wave25Defaults.exitPlanConfig` — **every branch of that expression resolves to `exit_style: "adaptive"`** (the v11-override branch sets it explicitly at `:2823`; the fallback is `buildDefaultExitPlanConfig()`, itself unconditionally `adaptive`). No code path in the graduator's normal write produces `static_styleC` on the dedicated column. So for the entire post-Wave-26-Pass-E default-graduated, CPCV+PBO+WFE-passing, frozen population, the frozen-policy hash has been computed over a JSONB `static_styleC` value that **never governed live behavior for that strategy at any point since its freeze** — not a value that drifted away from truth, but one that was never true from day one. The gate has been silently describing the wrong copy of this field for its entire operational life for this population, not merely failing to notice a later change.

### Why this wasn't caught by the drift gate's own tests
`src/server/__tests__/wave29-pass-b2-frozen-policy.test.ts:165-195` proves the hash changes when `config.exit_plan_config` changes — a real, passing, correct test of the code as written. But no test in the frozen-policy suite exercises the dedicated-column write path (`scripts/wave25-pass7-adaptive-opt-in.ts` / `wave26-pass-e-backfill-wave25-defaults.ts` / the graduator's `exitPlanConfig` column write) against `evaluateFrozenPolicyDriftAtPromotion` to check whether it is (wrongly) reported as no-drift. The gap is a missing negative test, not a contradicted positive one — this packet's Verification Plan (§4) proposes exactly that missing test as a RED-proof, to run BEFORE any fix, so the defect is demonstrated non-vacuously prior to remediation.

---

## 2. Blast radius

### Certifications / gates this invalidates or was never true for
- **CLAUDE.md §12 "Frozen-policy hash drift" row** — its stated purpose ("Closes the silent-retraining-drift failure mode") is materially false for the `exit_plan_config` field specifically, for every strategy that has ever been frozen. The gate still correctly catches drift in the other 4 fields (`entry_quality`, `position_size`, `stop_loss`, `take_profit`) — this is a partial, not total, defeat of the gate.
- **Wave 29 Pass B.2 close-out** (CLAUDE.md wave table, "frozen-policy SHA-256 contract... SHIPPED") — shipped-and-correct for 4/5 fields; the finding narrows, not reverses, that close-out.

### Who is affected — how to get the real count
Every strategy row where `strategies.frozen_policy_hash IS NOT NULL` has been through at least one freeze (CPCV+PBO+WFE all passed simultaneously per migration 0161) and is therefore exposed to this gap for as long as it stays frozen. Query to get the exact exposed population (not run in this packet — HELD, no DB access taken):

```sql
SELECT id, name, "lifecycleState", frozen_policy_hash, frozen_policy_set_at,
       frozen_policy_override_count,
       config->'exit_plan_config'->>'exit_style' AS dead_jsonb_copy_style,
       exit_plan_config->>'exit_style'            AS live_column_style
FROM strategies
WHERE frozen_policy_hash IS NOT NULL;
```
(Note: `config` JSONB's nested `exit_plan_config` key and the dedicated `exit_plan_config` DB column share a name at the SQL level — the JSONB copy MUST be reached via `config->'exit_plan_config'->>'exit_style'` while the live column is the bare `exit_plan_config->>'exit_style'`; conflating the two in a query is the same naming-collision hazard this packet's core finding is about, so any agent adapting this SQL should double-check which one they're actually selecting before trusting the output.)

A tighter, more actionable count — rows where the two copies **currently disagree** (the live-drift population, not just the exposed population):
```sql
SELECT id, name, "lifecycleState", frozen_policy_hash,
       config->'exit_plan_config'->>'exit_style'  AS dead_jsonb_copy_style,
       exit_plan_config->>'exit_style'             AS live_column_style
FROM strategies
WHERE frozen_policy_hash IS NOT NULL
  AND (config->'exit_plan_config'->>'exit_style') IS DISTINCT FROM (exit_plan_config->>'exit_style');
```
This packet does not run either query (HELD, zero DB mutation or read taken) — the operator or the independent grader assigned to implement should run both and report actual counts before implementation begins, since the true blast radius (how many DEPLOYED/PILOT strategies are silently exposed today) materially informs how urgently this should be prioritized once ratified.

### Downstream consumers whose behavior would change under any fix
- `POST /api/admin/frozen-policy-override` (HMAC override route) — override frequency (`frozen_policy_override_count`, `tf_frozen_policy_overrides_total` Prometheus counter) would jump for any strategy whose two copies already disagree, the moment the hash starts reading the live column — this is the "HMAC-override storm" CLAUDE.md §13 explicitly warns about.
- `src/server/services/regime-drift-detector-service.ts` (daily cron, Wave 29 Pass B.3) — does not read `exit_plan_config` directly, unaffected.
- `src/server/lib/carter/carter-introspect.ts:415` / `carter-recommend.ts:391` — already fall back to the live column; unaffected by a fix that makes the hash agree with what Carter already reports.
- Any dashboard/report that displays "frozen policy" to the operator as `config.exit_plan_config` would start showing a value that disagrees with the hash basis unless updated in lockstep.

---

## 3. The exact change, scope-locked (proposed design — NOT implemented)

CLAUDE.md §13 ("Don't change the 5-field hash slice... treat as a versioned migration") names the required shape explicitly. This section proposes exactly that shape, scoped to the minimum surface.

### 3.1 Schema — new column, additive only
```sql
ALTER TABLE strategies
    ADD COLUMN IF NOT EXISTS frozen_policy_version INTEGER NOT NULL DEFAULT 1;
COMMENT ON COLUMN strategies.frozen_policy_version IS
  'Version of the frozen-policy hash slice definition used to compute frozen_policy_hash. '
  'v1 = legacy 5-field slice reading exit_plan_config from strategies.config JSONB (dead copy). '
  'v2 = corrected slice reading exit_plan_config from the dedicated strategies.exit_plan_config '
  'column (the field that actually routes live signal-time exit-engine selection). '
  'Existing rows default to 1 (their hash was computed under the v1 definition; do not '
  're-evaluate them against v2 semantics without an explicit re-freeze).';
```
New migration file, idempotent (`ADD COLUMN IF NOT EXISTS`), follows the `migration-author` skill's conventions and the existing 0161 migration's own idempotency pattern.

### 3.2 `extractPolicySlice` — version-gated read
```ts
// frozen-policy-hash.ts
function extractPolicySlice(
  strategyConfig: unknown,
  version: number,
  dedicatedExitPlanConfig?: unknown,
): FrozenPolicySlice {
  const cfg = ...; // unchanged
  return {
    entry_quality: cfg.entry_quality ?? null,
    position_size: cfg.position_size ?? null,
    stop_loss: cfg.stop_loss ?? null,
    take_profit: cfg.take_profit ?? null,
    exit_plan_config: version >= 2
      ? (dedicatedExitPlanConfig ?? null)
      : (cfg.exit_plan_config ?? null),
  };
}
```
`computeFrozenPolicyHash` gains an optional `version` + `dedicatedExitPlanConfig` parameter (defaulting to `1` / `undefined` so every EXISTING caller that doesn't pass them is byte-identical — no silent behavior change for callers not updated in this same commit).

### 3.3 `freezePolicyForStrategy` — select the dedicated column too, stamp v2 going forward
```ts
// frozen-policy-contract.ts — freezePolicyForStrategy
const [strategy] = await db
  .select({ id: strategies.id, config: strategies.config, exitPlanConfig: strategies.exitPlanConfig })
  .from(strategies)
  .where(eq(strategies.id, strategyId));
...
const hash = computeFrozenPolicyHash({ config: strategy.config }, 2, strategy.exitPlanConfig);
...
.set({
  frozenPolicyHash: hash,
  frozenPolicyVersion: 2,   // new
  frozenPolicySetAt: frozenAt,
  regimeTrainedOn: regimeAtFreeze,
  updatedAt: frozenAt,
})
```
Every FRESH freeze from the moment this ships computes hash version 2 (reads the live column). Every EXISTING frozen row keeps its v1 hash and its v1 stamp (`frozen_policy_version` defaults to 1) — untouched, no forced re-hash, no override storm at deploy time.

### 3.4 `evaluateFrozenPolicyDriftAtPromotion` — version-aware comparison at promotion time
```ts
export function evaluateFrozenPolicyDriftAtPromotion(strategy: {
  id: string;
  config?: unknown;
  exitPlanConfig?: unknown;          // new, optional
  frozenPolicyHash?: string | null;
  frozenPolicyVersion?: number | null; // new
}): FrozenPolicyDriftResult {
  const version = strategy.frozenPolicyVersion ?? 1;
  const currentHash = computeFrozenPolicyHash(
    { config: strategy.config },
    version,
    version >= 2 ? strategy.exitPlanConfig : undefined,
  );
  ...
```
A v1-frozen strategy is re-evaluated under v1 semantics at every subsequent promotion attempt (until it goes through a fresh freeze, which stamps v2) — this is the "migrate strategies forward deliberately" clause CLAUDE.md §13 requires, not a silent mass re-hash.

### 3.5 What is explicitly OUT of scope for this change
- **No mass re-freeze of existing rows.** v1 rows keep computing/comparing under v1 semantics until they naturally re-freeze (next CPCV+PBO+WFE pass) or an operator explicitly triggers a re-freeze.
- **No change to the other 4 hashed fields** (`entry_quality`, `position_size`, `stop_loss`, `take_profit`) — untouched, same extraction logic, same behavior at both versions.
- **No change to the HMAC override route's auth/signature logic** — only the hash computation feeding into whether an override is *needed* changes; the override mechanism itself is untouched.
- **No change to `wave25-pass7-adaptive-opt-in.ts` or `wave26-pass-e-backfill-wave25-defaults.ts`** — they continue writing the dedicated column exactly as today; the fix makes the hash *see* that write, it does not change what the scripts do.
- **No change to `applyFrameworkOverlay`'s `static_styleC` stamping default** — that behavior (Wave 25 Pass 7 backward-compat default) is orthogonal and untouched.
- **No new promotion-blocking behavior for currently-frozen (v1) strategies** — a v1 strategy that has ALREADY silently drifted (dead-copy-vs-live-column mismatch) does NOT retroactively start blocking promotion the moment this ships; it will only start being caught the next time it is scored under v2, i.e. after its next fresh freeze. This is a deliberate scope limit, consistent with "don't silently invalidate all existing frozen hashes" — but it also means this fix, as scoped, does NOT immediately close the exposure window for strategies frozen before it ships. Whether to also force a one-time v1→v2 audit-only comparison pass (report-only, non-blocking) across all `frozen_policy_hash IS NOT NULL` rows is a follow-up decision for the operator, not bundled into this packet.

---

## 4. Verification plan

### 4.1 RED-proof (run BEFORE any implementation, to demonstrate the defect non-vacuously)
New test in `src/server/__tests__/wave29-pass-b2-frozen-policy.test.ts` (or a new sibling file):
1. Construct a strategy row with `config.exit_plan_config = { exit_style: "static_styleC" }` (dead copy) and `exitPlanConfig = { exit_style: "adaptive" }` (live column) — i.e. the two copies disagree, mirroring the real graduation-time divergence shown in §1.A.
2. Compute `frozenPolicyHash` at freeze time (v1 logic, current code) → record hash H1.
3. Simulate a production mutation via the shape of `wave25-pass7-adaptive-opt-in.ts` — flip ONLY the dedicated column's `exit_style` from `adaptive` to `static_styleC` (or vice versa), leaving `config.exit_plan_config` untouched.
4. Compute `frozenPolicyHash` again under current (v1-only) code → expect H2 === H1 (no drift detected) despite step 3 being a real, live-routing-relevant change.
5. Assert `evaluateFrozenPolicyDriftAtPromotion` returns `ok: true` (wrongly) under current code — this is the RED-proof: the test fails today in the sense that it demonstrates the gate's blindness, and should be written to assert the CURRENT (bad) behavior first, then be flipped to assert the FIXED (v2) behavior detects drift once §3 lands.

### 4.2 Post-fix verification (once ratified and implemented)
- Re-run the RED-proof test with v2 semantics engaged (pass `version=2` explicitly, or via a strategy row with `frozenPolicyVersion=2`) → step 4's hash MUST now differ (H2 !== H1) and step 5 MUST now return `ok: false` with a populated `reason`.
- Regression: `wave29-pass-b2-frozen-policy.test.ts`'s existing 5-field-slice tests (lines ~165-195, ~487-499) must still pass byte-identical under `version=1` default (no `version`/`dedicatedExitPlanConfig` args passed) — proves zero behavior change for every existing caller that doesn't opt into v2.
- `freezePolicyForStrategy` integration test (extend `post-m3-frozen-policy-cas-guard.test.ts` or `obs-fix3-frozen-policy-tx-atomicity.test.ts` fixtures): fresh freeze on a strategy with disagreeing copies stamps `frozenPolicyVersion=2` and a hash that reflects the LIVE column, not the dead one.
- `check:2026-compliance` + `system-map:check` + `check:production-isolation` — the 3 standing CI gates — must stay green (no expected interaction, but standard closure bar per `worktree-session` skill).
- Full `src/server/__tests__` vitest suite before/after diff — zero new failing test names outside the files this packet's implementation touches, per the doctrine already demonstrated in sibling packets (e.g. `m3-paper-authority-flip-2026-07-17.md`'s before/after diff method).
- Independent grader (doer != grader, per `grading-integrity` skill) re-derives the RED-proof from a fresh context before this is marked landed — this packet's own authorship does not count as verification.

---

## 5. Rollback

- **Schema**: `frozen_policy_version` is additive-only (`DEFAULT 1`, nullable-safe). Rollback = simply stop writing `2` (revert the `freezePolicyForStrategy` call site) — no destructive migration needed; the column can be left in place harmlessly, or dropped in a follow-up idempotent migration if desired.
- **Code**: the version-gated `extractPolicySlice`/`computeFrozenPolicyHash` signature is backward-compatible by construction (new params optional, default to v1 behavior) — reverting the `freezePolicyForStrategy` + `evaluateFrozenPolicyDriftAtPromotion` call sites to omit the new params fully restores current (v1-only) behavior with no data loss, since no existing row's hash or version is touched by the fix as scoped.
- **No env-flag gate is proposed** for this change (unlike e.g. `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED`) because the fix is naturally self-gating via `frozen_policy_version` — old rows keep old semantics automatically; there is no global "flip a switch and every strategy re-hashes" moment to gate. If the operator wants an explicit kill switch anyway (e.g. to pause v2 stamping on fresh freezes without a code revert), that would be a one-line addition (`FROZEN_POLICY_HASH_V2_ENABLED` env, default `true`, gating whether `freezePolicyForStrategy` passes `2` or `1`) — proposed here as an option, not committed to, pending operator preference.
- **If a fresh v2 freeze turns out to be wrong** (e.g. the dedicated-column read introduces an unexpected false-positive drift storm across many strategies): the HMAC override route already exists and requires no code change to use — operators can override individual strategies while the root cause is investigated, exactly the audited path CLAUDE.md §13 already prescribes for frozen-policy disagreements.

---

## Why this is HELD, not autonomous

CLAUDE.md §13 ("Don't") states explicitly: changing which fields the 5-field frozen-policy hash slice covers "silently invalidates all existing frozen hashes... forces an HMAC-override storm on every DEPLOYED strategy" and mandates "treat as a versioned migration: add a `frozen_policy_version` column, gate the hash function on the version, and migrate strategies forward deliberately." This packet's proposed design (§3) is scoped precisely to avoid the override storm (v1 rows keep v1 semantics), but the underlying change is still altering **which physical column** the frozen-policy hash — a certified, already-live hard gate protecting every DEPLOYED strategy — reads from. That is a re-baseline of a frozen/certified reference other decisions already trust, which the ratify-packet skill's operator amendment reserves for explicit go, not autonomous action, regardless of how carefully the migration is scoped. It is also adjacent to a live default currently governing real promotion decisions for whatever strategies are presently DEPLOYED/PILOT with `frozen_policy_hash IS NOT NULL`.

No code has been written or edited for this finding. This packet is the receipt only.

**STATUS: HELD — awaiting explicit operator ratification, not yet implemented.**
