# Ratify-Packet — Gate Contract Restoration: BIF / PBO / WFE / Parameter-Drift Grandfather-Contract Regression Cluster (2026-07-17)

**STATUS: STAGED — receipts complete, not yet implemented.** Per the `ratify-packet` skill's 2026-07-11 operator amendment, none of the 4 items below sit in the irreversible/live-capital reserved class (pre-live system — CLAUDE.md §2, "nothing live-trading yet, by design"; no schema/threshold/formula change; no frozen/certified ref invalidated), so this packet proceeds AUTONOMOUSLY through the agent-loop (scope-locked implementer → fresh-context independent grader, doer≠grader) once staged — no operator go/no-go needed for items 1/3/4 (revert to documented PROCEED). **Item 2 is the one exception on process, not substance:** the operator has already been consulted and ratified the current BLOCK behavior for PBO's CPCV-exempt branch is correct (task instruction, 2026-07-17) — this packet's job for item 2 is to make the code's own comments and the test suite agree with that ratified decision, not to re-litigate it.

Base worktree pin: `56f0fd048c31ffe832194ed5b685a52de5230327` (`wt-deepscan-b-fixwave`).

## Summary table

| # | File | Branch(es) | Current code | Docstring/CLAUDE.md says | Verdict this packet stages |
|---|---|---|---|---|---|
| 1 | `src/server/lib/bif-gate.ts` | `:254` legacy-null, `:200` CPCV-unmeasured | `passed:false` (BLOCKS) | `passed:true`, "NEVER block on missing data" | **REVERT to `passed:true`** |
| 2 | `src/server/lib/pbo-gate.ts` | `:172-186` CPCV-degenerate/is-unavailable | `ok:false` (BLOCKS) | (stale) `ok:true` | **KEEP `ok:false`** (operator-ratified 2026-07-17) — fix docs/tests only |
| 3 | `src/server/lib/wfe-gate.ts` | `:148` cpcv_exempt, `:226` legacy_null | `passed:false` | `passed:true`, "gate PASSES with a DISTINCT audit action" | **REVERT to `passed:true`** |
| 4 | `src/server/lib/parameter-drift-gate.ts` | `:120` cpcv_exempt, `:131` legacy_null | `passed:false` | `passed=true`, "allow + audit" | **REVERT to `passed:true`** |

All 4 land in the **same commit**, `85e1500b76996e26a2e3f5943f832485aeb3e072` ("Harden validation promotion gates", 2026-07-12 21:44:42 -0400, author Tonio).

---

## 0. Cluster provenance and precedent (read this before Part 1)

This is not a novel bug class. On the same day this packet was written, commit `707810b748024181732adfa3db8c366ded3183f4` ("fixwave: capital-safety-compliance-gates", 2026-07-17 11:55) fixed the **identical pattern** on `pbo-gate.ts`'s legacy-null branch (a 5th instance in the same file, distinct from the CPCV-exempt branch this packet's item 2 covers) — reverting `ok:false`→`ok:true`, updating `wave29-pass-a2-pbo-gate.test.ts` (5 assertions), and verifying both `lifecycle-service.ts` call sites had a dead PROCEED branch sitting immediately after the BLOCK check, waiting to be activated. That commit's own message explicitly flagged, as an out-of-scope carry-forward:

> "Two PRE-EXISTING test files disagree about whether the CPCV-degenerate-PBO 'cpcv_exempt' path should PROCEED (`finding1-pbo-cpcv-degenerate.test.ts`, predates this wave) or BLOCK (`wave29-pass-a2-pbo-gate.test.ts`'s own pre-existing docstring + the actual shipped code, also predates this wave)... Needs an operator/ratify decision on which contract is correct, not a code fix."

**This packet's item 2 is that flagged decision's resolution.** The operator ratified BLOCK on 2026-07-17 (per the task instruction commissioning this packet). Items 1/3/4 are the same defect class as the ALREADY-FIXED PBO legacy-null branch, just in the 3 sibling gate files the `707810b7` session didn't touch.

**A 5th sibling of this exact pattern exists and is explicitly OUT OF SCOPE for this packet:** `src/server/lib/b14-ci-gate.ts::evaluateDsrWalkForwardGate`, `legacy_proceed` branch (currently `~:137` `passed:false`, `~:144` `blocked:true`), flipped by the SAME commit `85e1500b`:

```diff
   if (dsrPass === undefined || dsrPass === null) {
     return {
-      passed: true,
+      passed: false,
       status: "legacy_proceed",
       ...
-        blocked: false,
+        blocked: true,
```

This is currently RED at `gate-chain-integration.test.ts:550` ("LEGACY PASS: no dsr_pass key (pre-Wave-A backtest) → gate proceeds (grandfather)", `expect(result.passed).toBe(true)` → received `false`) and `:571` (DISCONNECT variant), and also RED at `deepscan14-shadow-stage.test.ts` ("evaluateDsrWalkForwardGate proceeds (legacy grandfather) when dsr_pass is null/undefined"). This is flagged here so it is not silently dropped (zero-carry-forward discipline: named, with exact file:line, not parked) — it is a 5th file, not one of the 4 named in this packet's scope-lock, and needs its own packet (identical shape to this one; CLAUDE.md's **Wave close-out registry, "/goal deep-scan WAVE 2 (goalscan-crit) CLOSED 2026-07-16" row** already documents the sibling class: "Grader-surfaced pre-existing follow-up: `b14-ci-gate.ts` `legacy_proceed` returns passed:false vs docstring PROCEED (mirrored not fixed; needs own packet)" — recorded 2026-07-16, still open). **No code in `b14-ci-gate.ts` is touched by this packet.**

---

## 1. What & Why Now — receipts

### Item 1 — `bif-gate.ts` (BIF gate, PAPER → DEPLOY_READY HARD)

**The regressing diff** (`git show 85e1500b -- src/server/lib/bif-gate.ts`):

```diff
   if (opts?.bifReliable === false) {
     return {
-      passed: true,
+      passed: false,
       reason: "bif.cpcv_unmeasured",
       ...
-        blocked: false,
+        blocked: true,
   }
   if (bifNum === null) {
     return {
-      passed: true,
+      passed: false,
       reason: "bif.legacy_null_pre_wave3",
       ...
-        blocked: false,
+        blocked: true,
   }
```

Current file state (verified by direct read, `wt-deepscan-b-fixwave` @ pinned SHA): `:200` (`opts?.bifReliable === false` branch, "CPCV-unmeasured path") returns `passed: false`; `:254` (`bifNum === null` branch, "Legacy null" path) returns `passed: false`.

**Contradicted docstring** — the module's own header, `bif-gate.ts:13-17` (UNCHANGED by `85e1500b`):

> "1. bif === null / undefined (pre-Wave-3 backtests) → legacyNull=true, passed=true, reason "bif.legacy_null_pre_wave3" → documented grandfather warn; NEVER block on missing data."

And the `legacyNull` field's own JSDoc, `:90-95` (also unchanged): "Gate is ALWAYS passed=true when legacyNull=true — NEVER block on missing data." And the `bifReliable` option's JSDoc, `:151-154`: "Gate ALWAYS passed=true when bifReliable===false — do NOT block on a measurement-limitation."

**Contradicted CLAUDE.md** — §12 gate table, BIF row: "Legacy backtests with no `bif` (pre-Wave-3) grandfather-pass with a documented warn; fail-OPEN on infra read error."

**Live blocking call sites (2, both gate on the raw `.passed` boolean today):**
- `lifecycle-service.ts:6940-6982` (autonomous cron, PAPER→DEPLOY_READY): `const bifResult = evaluateBifGate(...)`; `if (!bifResult.passed) { ...return blocked... }` at `:6982`.
- `paper-to-deploy-ready-gates.ts:823-838` (manual/HMAC dashboard path): `if (!bifResult.passed) { ...return { passed: false, failedGate: "bif" }... }` at `:825`. This function's very next branch, `:840-841` (`if (bifResult.legacyNull) { logger.info(...grandfather pass...) }`), is **dead code** today — it can never execute because `.passed` is always `false` for `legacyNull===true`, so the `return` at `:830-837` fires first. This is the identical dead-branch shape the `707810b7` precedent commit found and activated for PBO.

**RED test evidence (actual run, this session):**
```
FAIL gate-chain-integration.test.ts > BIF gate ... > LEGACY PASS: bif=null (pre-Wave-3 backtest) → grandfather pass
  expected false to be true
  ❯ gate-chain-integration.test.ts:1277:27
    1276|     const result = evaluateBifGate(rawBif, null);
    1277|     expect(result.passed).toBe(true);
```
Plus 6 companion assertions in `wave3-track3b-bif-gate.test.ts` and 1 in `bif-gate-proxy-basis.test.ts` — see Part 4.

**Correct direction: PROCEED.** Revert both branches to `passed: true` / `blocked: false`.

### Item 2 — `pbo-gate.ts` (PBO overfit gate, TESTING → SHADOW/PAPER HARD) — KEEP BLOCK, fix docs/tests

**The regressing diff** (`git show 85e1500b -- src/server/lib/pbo-gate.ts`), CPCV-degenerate branch:
```diff
   if (pboRaw == null && backtestResult.pbo_degenerate_reason === "cpcv_is_sharpe_unavailable") {
     return {
-      ok: true,
+      ok: false,
       ...
-        blocked: false,
+        blocked: true,
         cpcv_exempt: true,
   }
```
Current file state: `pbo-gate.ts:172-186` returns `ok: false` / `blocked: true`. **This is unchanged since `85e1500b` and this packet does NOT propose changing it** — the operator has ratified BLOCK is correct.

**Contradicting artifacts that need to catch up to the ratified decision** (all currently stale, asserting the pre-ratification PROCEED contract):

1. `pbo-gate.ts` itself, `:133-135` — a comment inside the **sibling** plain-WF-degenerate branch (untouched by `85e1500b`, still correct in its own right) makes a stale forward-reference: *"This is therefore distinct from BOTH the CPCV-exempt PROCEED and the legacy-null grandfather PROCEED... never confused with either PROCEED path."* Only the legacy-null path still PROCEEDs; the CPCV-exempt path now BLOCKS. This is an internal self-contradiction within the file (the comment at `:133` and the code 30 lines below it at `:172-186` now disagree).
2. `walk_forward.py:850-851` (producer-side comment, DSL/CPCV PBO computation block): *"(Merge 2026-06-29: adopted over the deepscan-wiring BLOCK approach — CPCV is the default WF_MODE, so BLOCK-on-degenerate would strangle the whole pipeline.)"*
3. `walk_forward.py:890-896` (twin comment, same block, `elif` branch): *"...the TS lifecycle gate PROCEEDS with an explicit cpcv_exempt audit (NOT a silent grandfather-pass, and NOT a BLOCK — CPCV is the default WF_MODE, so blocking would strangle the whole pipeline; Wave 30 per-path IS Sharpe is the real fix)."*
4. `walk_forward.py:898-905` — a `print(..., file=sys.stderr)` diagnostic emitted at runtime on every CPCV-degenerate PBO computation, ending "→ TS gate PROCEEDS with cpcv_exempt audit (walk_forward.pbo_cpcv_degenerate)". This is live operator-facing stderr output that will actively mislead anyone reading backtest logs after this packet lands, if left unchanged.
5. `finding1-pbo-cpcv-degenerate.test.ts:17-20` (module docstring): *"WHY PROCEED, NOT BLOCK: CPCV is the default WF_MODE, so a BLOCK-on-degenerate would strangle the ENTIRE pipeline..."* and `:22-25` (CRITICAL DISTINCTION block): *"CPCV degenerate (reason set) → PROCEED via pbo_cpcv_is_unavailable (DISTINCT)."*
6. `finding1-pbo-cpcv-degenerate.test.ts:42-49` — test asserts `r.ok===true`, `r.auditPayload.blocked===false`. **Currently failing** (verified this session, see below).
7. `finding1-pbo-cpcv-degenerate.test.ts:58` comment — *"// Both proceed, but they must be queryably different (the honesty guarantee)."* — currently passes (only asserts `reason`/`legacyNull` differ, not `ok`), but the comment becomes factually false once one path blocks and the other proceeds.
8. `gate-chain-integration.test.ts:1158` — `expect(result.ok).toBe(true)` in the "CPCV PBO: pbo_degenerate_reason=cpcv_is_sharpe_unavailable → gate reason=pbo_cpcv_is_unavailable, legacyNull=false" test. **Currently failing.**

**NOT stale / already correctly aligned to the ratified BLOCK contract — do not touch:** `wave29-pass-a2-pbo-gate.test.ts`'s own CPCV-exempt section (`describe("evaluatePboGate — CPCV-exempt path (hardening/phase-0)")`) already asserts `ok:false`/`blocked:true` and is currently GREEN (verified this session, 118/118 across all 4 companion gate-unit-test files) — it was rewritten in `85e1500b` and never reverted, so it already matches the ratified decision. Also unaffected: `pbo-gate.ts`'s CPCV-exempt branch header comment at `:160-166` (neutral about PROCEED/BLOCK, doesn't assert a stale direction) and the plain-WF-degenerate branch's own logic at `:127-158` (a structurally distinct, always-correctly-BLOCKing reason string, `"plain_wf_is_unavailable"`, untouched by `85e1500b` and not part of this packet).

**RED test evidence (actual run, this session):**
```
FAIL finding1-pbo-cpcv-degenerate.test.ts > ... > PROCEEDS with the distinct cpcv-exempt audit when pbo_degenerate_reason is set and pbo_overall is null
  expected false to be true
  ❯ finding1-pbo-cpcv-degenerate.test.ts:44:18
    44|     expect(r.ok).toBe(true);

FAIL gate-chain-integration.test.ts > CPCV-exempt gate round-trip ... > CPCV PBO: pbo_degenerate_reason=cpcv_is_sharpe_unavailable → gate reason=pbo_cpcv_is_unavailable, legacyNull=false
  expected false to be true
  ❯ gate-chain-integration.test.ts:1158:23
    1158|     expect(result.ok).toBe(true);
```

**Correct direction: KEEP `ok:false` / `blocked:true` at `pbo-gate.ts:172-186` exactly as-is.** Update the 6 stale artifacts above to describe and assert the ratified BLOCK contract instead of the pre-ratification PROCEED contract.

### Item 3 — `wfe-gate.ts` (WFE hard-floor gate, PAPER → DEPLOY_READY HARD)

**The regressing diff:**
```diff
   if (wfeStatus === "cpcv_not_applicable") {
     return {
       status: "cpcv_exempt",
-      passed: true,
+      passed: false,
   }
   if (wfeOverall == null) {
     return {
       status: "legacy_null",
-      passed: true,
+      passed: false,
   }
```
Current file state: `:148` (cpcv_exempt) and `:226` (legacy_null) both `passed: false`.

**Contradicted docstring**, `wfe-gate.ts:19` (UNCHANGED): *"wfe_overall null (legacy pre-Pass-B.1) → PASS, emit legacy audit"*. And `:143-144` (CPCV-exempt branch's own comment, unchanged): *"The gate PASSES with a DISTINCT audit action so the exemption is visible and auditable rather than silently grandfather-passing."*

**Contradicted CLAUDE.md** — §12 WFE row: *"Legacy null (pre-W27.5 backtests with no `wfe_overall`) → PROCEED + `lifecycle.wfe_unavailable_legacy` warn audit (one-time documented fallback during the grandfather window)."*

**Currently non-blocking in practice ONLY because of an explicit caller workaround** — `lifecycle-service.ts:2038-2041` (comment) and `:2174` (code): *"WFE blocks on `status==="blocked"||"degenerate_is_block"` — NOT on `.passed`, since `legacy_null` and `cpcv_exempt` both carry `passed:false` but do NOT block."* All 4 WFE call sites in `lifecycle-service.ts` (`:2161`, `:4441`, `:5393`) and both in `paper-to-deploy-ready-gates.ts` (`:667`, block-check at `:670`) branch on `.status`, never on `.passed`, for exactly this reason — this is a **documented workaround for a known-wrong field**, not evidence the field is harmless. Any future caller/refactor that trusts `.passed` directly (the field's own name and docstring both say it should be trustworthy) inherits a live landmine.

**Metrics side-effect:** `lifecycle-service.ts:138-141` (`recordWfeGateOutcome`) DOES key off `.passed` directly: `const outcome = !result.passed ? "block" : isLegacy ? "legacy" : "pass";` — so today every `legacy_null`/`cpcv_exempt` WFE evaluation increments the Prometheus `wfeGateTotal{outcome="block"}` counter even though the promotion itself proceeds. Dashboards currently over-report the WFE block rate for these two branches.

**RED test evidence (actual run, this session):**
```
FAIL gate-chain-integration.test.ts > WFE gate ... > DISCONNECT (wrong key): producer writes wfe_score=0.30; consumer reads wfe_overall=null → grandfather PASS
  expected false to be true
  ❯ gate-chain-integration.test.ts:236:27
    236|     expect(result.passed).toBe(true);

FAIL gate-chain-integration.test.ts > CPCV-exempt gate round-trip ... > CPCV WFE: wfe_status=cpcv_not_applicable → gate returns cpcv_exempt, NOT legacy_null
  expected false to be true
  ❯ gate-chain-integration.test.ts:1132:27
    1132|     expect(result.passed).toBe(true);
```
Plus 5 companion assertions in `wave27-5-pass-b-wfe-gate.test.ts` — see Part 4.

**Correct direction: PROCEED.** Revert both branches to `passed: true`.

### Item 4 — `parameter-drift-gate.ts` (parameter-drift overfit gate, PAPER → DEPLOY_READY HARD)

**The regressing diff:**
```diff
   if (paramStabilityStatus === "cpcv_not_applicable" || classification === "cpcv_not_applicable") {
     return {
       status: "cpcv_exempt",
-      passed: true,
+      passed: false,
   }
   if (classification == null) {
     return {
       status: "legacy_null",
-      passed: true,
+      passed: false,
   }
```
Current file state: `:120` (cpcv_exempt) and `:131` (legacy_null) both `passed: false`.

**Contradicted docstring**, `parameter-drift-gate.ts:18` (UNCHANGED): *"classification == null (legacy or no regime data) → allow + audit"*. And `:25-27`: *"this gate returns a DISTINCT `cpcv_exempt` result (passed=true, auditAction='lifecycle.parameter_drift_cpcv_exempt') — modeled EXACTLY on the wfe-gate.ts cpcv_exempt precedent."*

**Contradicted CLAUDE.md** — §12 "Parameter drift overfit_drift gate" row: *"Null/missing classification → PROCEED (legacy backtests)."*

**Same caller-workaround shape as WFE:** `lifecycle-service.ts:2196-2197,2211` and `paper-to-deploy-ready-gates.ts:715-716` branch on `status==="blocked"||"blocked_classifier_error"`, never on `.passed` — same non-blocking-in-practice-but-landmine pattern, same metrics mislabeling risk at `lifecycle-service.ts:149-150`.

**RED test evidence (actual run, this session):**
```
FAIL gate-chain-integration.test.ts > Parameter-drift gate ... > DISCONNECT (wrong key) ... → legacy_null PASS
  expected false to be true
  ❯ gate-chain-integration.test.ts:1479:27

FAIL gate-chain-integration.test.ts > Parameter-drift gate ... cpcv_exempt round-trip ... > CPCV: gate returns cpcv_exempt + distinct audit, NOT legacy_null
  expected false to be true
  ❯ gate-chain-integration.test.ts:1576:27

FAIL gate-chain-integration.test.ts > Parameter-drift gate ... cpcv_exempt round-trip ... > Legacy: neither key → legacy_null grandfather
  expected false to be true
  ❯ gate-chain-integration.test.ts:1588:27
```
Plus 5 companion assertions in `wave27-5-pass-b-parameter-drift-gate.test.ts` — see Part 4.

**Correct direction: PROCEED.** Revert both branches to `passed: true`.

---

## 2. Blast radius

**Severity is NOT uniform across the 3 revert items.** BIF genuinely blocks live promotion attempts today at 2 call sites (`lifecycle-service.ts:6982`, `paper-to-deploy-ready-gates.ts:825`) — any strategy with no `bif` field (every pre-Wave-3 backtest) or `bif_reliable===false` (every backtest run in CPCV mode, the current default `WF_MODE`) is unconditionally refused PAPER→DEPLOY_READY promotion today, contradicting the intended grandfather/advisory design. WFE and parameter-drift are currently **non-blocking in practice** (all 6 call sites across `lifecycle-service.ts` and `paper-to-deploy-ready-gates.ts` branch on `.status`, not `.passed`) but the `.passed` field is exported, named to be trusted, and documented as trustworthy — it is a landmine for the next caller or refactor, not a live blocker today.

**Collateral test damage measured directly this session** (not estimated): fixing item 1 (BIF) alone is expected to auto-heal a large secondary blast radius, because many gate-fixture tests unrelated to BIF don't set a `bif` value and rely on the (documented, currently broken) grandfather-PROCEED to reach the gate they're actually testing:
- `paper-to-deploy-ready-gates.test.ts`: **15 of 21 test-file failures** trace to `result.failedGate === "bif"` where the test expected a DIFFERENT gate (`frozen_policy`, `wave26_orchestrator`, composite-shadow, B15, survival-twin) to be the one under test. Example: `Gate 9 — Frozen-policy drift > blocks when frozen hash mismatches` expects `failedGate: "frozen_policy"`, receives `failedGate: "bif"` — the fixture never set `bif`, so BIF's legacy-null block fires FIRST and the frozen-policy gate is never reached.
- `paper-to-deploy-ready-gates-parity.test.ts`: **6 failures**, same root cause (Scenarios 1, 8, 9, 10, 11, 12).
- `bif-gate-proxy-basis.test.ts`: 1 failure ("genuine legacy-null (no computationError) still grandfathers... unchanged").
- `gate-chain-integration.test.ts`: 9 failures total (7 in-scope across items 1/3/4, 2 out-of-scope DSR sibling — see Part 0).
- `finding1-pbo-cpcv-degenerate.test.ts`: 1 failure (item 2).

Total measured: **~32 currently-red assertions attributable to this cluster** (30 in-scope + 2 DSR out-of-scope), none of which are new — all pre-date this packet and pre-date this session.

**Companion direct-unit-test files are currently GREEN only because `85e1500b` rewrote them to assert the bug.** `wave3-track3b-bif-gate.test.ts`, `wave27-5-pass-b-wfe-gate.test.ts`, and `wave27-5-pass-b-parameter-drift-gate.test.ts` (118/118 tests green, verified this session) all had their legacy-null/cpcv-exempt assertions flipped in lockstep with the production-code flip. **Reverting the production code WITHOUT also reverting these 3 test files will turn 13 currently-green tests red** — this is not optional cleanup, it is required to avoid introducing a NEW regression while fixing the old one. `wave29-pass-a2-pbo-gate.test.ts` needs NO change (already correctly aligned to the ratified BLOCK contract for item 2, and its legacy-null section was already independently fixed by `707810b7`).

**Metrics dashboards:** `lifecycle-service.ts:138-141` / `:146-151` currently mislabel every WFE/parameter-drift legacy_null and cpcv_exempt evaluation as `outcome="block"` in the `wfeGateTotal` / `parameterDriftGateTotal` Prometheus counters, even though promotion proceeds. This self-corrects once `.passed` is reverted (no code change needed there — those two functions read `.passed` and will start reading the right value).

**Not touched, no re-baselining:** no threshold, formula, measurement, or classifier logic changes. No schema/migration. No frozen or certified reference is invalidated (no `frozen_policy_hash`, no golden fixture, no live promotion threshold in force is altered — this changes a boolean's *direction*, not a formula or a number). System is pre-live (CLAUDE.md §2: "nothing live-trading yet, by design") — nothing in the reserved irreversible/live-capital class per the `ratify-packet` skill.

**Named, explicit, NOT silently dropped, out-of-scope follow-up:** `b14-ci-gate.ts::evaluateDsrWalkForwardGate` `legacy_proceed` branch — same commit, same pattern, currently RED at `gate-chain-integration.test.ts:550,571` and `deepscan14-shadow-stage.test.ts` ("evaluateDsrWalkForwardGate proceeds (legacy grandfather)..."). Already flagged since 2026-07-16 in CLAUDE.md's Wave close-out registry, goalscan-crit WAVE 2 row ("mirrored not fixed; needs own packet") — not the §12 WFE gate row. This packet does not touch `b14-ci-gate.ts` — it is a 5th file outside this packet's 4-file scope-lock and needs its own packet (mechanically identical shape to this one).

---

## 3. Exact change, scope-locked

### 3a. `src/server/lib/bif-gate.ts` — 2 branches
- `:199-201` (inside the `opts?.bifReliable === false` block): `passed: false` → `passed: true`.
- `:207-208` (`blocked` field in the same block's `auditPayload`): `blocked: true` → `blocked: false`.
- `:253-255` (inside the `bifNum === null` block): `passed: false` → `passed: true`.
- `:261-262` (`blocked` field in the same block's `auditPayload`): `blocked: true` → `blocked: false`.
- Optionally restore the two `logger.warn` message strings to their pre-`85e1500b` wording ("proceeding with legacy grandfather warn" / "gate passes with distinct audit") — cosmetic, not required for correctness, but keeps runtime log text truthful.

### 3b. `src/server/lib/pbo-gate.ts` — NO behavior change
- Do **not** touch `:172-186`. `ok:false` / `blocked:true` stays exactly as-is.
- `:133` and `:135` (comment inside the sibling plain-WF-degenerate branch): reword to stop calling the CPCV-exempt path "PROCEED" — e.g. "distinct from BOTH the CPCV-exempt BLOCK and the legacy-null grandfather PROCEED" / "never confused with the legacy-null PROCEED path." Add one line noting the operator ratified BLOCK for the CPCV-exempt branch on 2026-07-17 (mirrors the dated-comment convention already used at `:193-214` for the legacy-null fix).

### 3c. `src/server/lib/wfe-gate.ts` — 2 branches
- `:145-153` (`wfeStatus === "cpcv_not_applicable"` block): `passed: false` → `passed: true`.
- `:222-231` (`wfeOverall == null` block, comment currently reads "Missing WFE cannot authorize a fresh promotion." at `:222`): `passed: false` → `passed: true`. Restore the original comment wording ("Legacy path — wfe_overall key genuinely absent...") or leave the current wording if it stays accurate for a PROCEED-with-audit branch (it does not need to change to fix the bug; only the returned boolean does).

### 3d. `src/server/lib/parameter-drift-gate.ts` — 2 branches
- `:117-124` (`cpcv_not_applicable` block): `passed: false` → `passed: true`.
- `:128-135` (`classification == null` block): `passed: false` → `passed: true`.

### 3e. `src/engine/walk_forward.py` — 2 comment blocks + 1 print statement, all in the DSL/CPCV PBO-computation region (`~838-907`)
- `:850-851` — reword away from "adopted over the deepscan-wiring BLOCK approach... BLOCK-on-degenerate would strangle the whole pipeline" to state the operator-ratified BLOCK decision instead. Cite CLAUDE.md §13's "ship gates strict, then loosen with data" principle and the 2026-07-17 ratification date.
- `:890-896` — same reword; the phrase "the TS lifecycle gate PROCEEDS with an explicit cpcv_exempt audit (NOT a silent grandfather-pass, and NOT a BLOCK...)" must become "the TS lifecycle gate BLOCKS with an explicit cpcv_exempt audit."
- `:898-905` — the `print(..., file=sys.stderr)` diagnostic text "→ TS gate PROCEEDS with cpcv_exempt audit (walk_forward.pbo_cpcv_degenerate)" must become "→ TS gate BLOCKS with cpcv_exempt audit (walk_forward.pbo_cpcv_degenerate)". This is live stderr output, not just a comment — leaving it stale actively misleads anyone reading backtest logs post-fix.
- **Do not touch** `:537`, `:1160-1170`, `:1985-2049` (the plain-WF-degenerate `"plain_wf_is_unavailable"` block, lines 1990-2044) — verified these either don't assert a stale direction or correctly describe the ALREADY-correct, always-BLOCKing plain-WF-degenerate path, which is a structurally distinct reason string untouched by `85e1500b` and out of this packet's scope.

### 3f. Companion test-file updates (required in lockstep with 3a/3c/3d — not optional, not scope creep)

**`src/server/__tests__/wave3-track3b-bif-gate.test.ts`** (revert the `85e1500b` rewrite):
- `:82-119` (`describe("evaluateBifGate — null/undefined bif → block")`): revert all 5 `expect(result.passed).toBe(false)` → `true` (`:85,95,102,110,117`), `:89` `blocked:true`→`false`. Restore describe/it titles to "legacy grandfather pass" language.
- `:289-296`, `:297-305`, `:307-314` (3 `bifReliable=false` tests in `describe("evaluateBifGate — CPCV-unmeasured path")`): revert `expect(result.passed).toBe(false)` → `true` at `:291,301,312`.
- `:339-348` ("cpcv_unmeasured audit payload contains threshold fields"): `:343` `blocked: true,` → `blocked: false,`.

**`src/server/__tests__/wave27-5-pass-b-wfe-gate.test.ts`**:
- `:140-153` (`describe("evaluateWfeGate — null WFE...")`): revert `:144,152` `passed:false`→`true`. Restore title to "legacy proceed."
- `:198-203` ("legacy null blocks promotion until WFE is recomputed"): revert `:201` `passed:false`→`true`. Restore title to "legacy null → proceed (grandfather path unchanged)."
- `:237-244` (cpcv_exempt null wfeOverall test): revert `:241` `passed:false`→`true`. Restore title language.
- `:246-254` (cpcv_exempt precedence test): revert `:252` `passed:false`→`true`.

**`src/server/__tests__/wave27-5-pass-b-parameter-drift-gate.test.ts`**:
- `:117-131` (`describe("evaluateParameterDriftGate — null classification")`): revert `:121,129` `passed:false`→`true`. Restore titles to "allows promotion with legacy_null..."
- `:136-145` (cpcv_exempt "returns DISTINCT cpcv_exempt" test): revert `:142` `passed:false`→`true`.
- `:147-154` (cpcv_exempt precedence test): revert `:152` `passed:false`→`true`.
- `:176-183` ("cpcv_exempt is distinct from legacy_null in audit trail"): revert **both** `:181` (`cpcv.passed`) and `:182` (`legacy.passed`) `false`→`true` (both branches PROCEED under the corrected contract).

**`src/server/__tests__/bif-gate-proxy-basis.test.ts`**: the failing assertion ("genuine legacy-null (no computationError) still grandfathers (passed, legacyNull) — unchanged") needs its expected value flipped back to `true` — locate and confirm exact line at implementation time (not independently re-verified line-by-line in this packet; flagged here so the implementer doesn't miss it, confirmed failing this session).

**`src/server/__tests__/gate-chain-integration.test.ts`** — no structural change, only the expected-value literals at the 7 in-scope failing assertions flip back to match the reverted code (see Part 4 for the full list with line numbers); this file's own test bodies/fixtures do not need editing beyond the `expect(...)` calls already failing.

**`src/server/__tests__/finding1-pbo-cpcv-degenerate.test.ts`** (item 2 — opposite direction from the others: align to BLOCK):
- `:17-20` module docstring "WHY PROCEED, NOT BLOCK..." paragraph: rewrite to explain why BLOCK is now correct (operator-ratified 2026-07-17; CLAUDE.md §13 "ship gates strict, then loosen with data").
- `:22-25` "CRITICAL DISTINCTION" block: `"CPCV degenerate (reason set) → PROCEED via pbo_cpcv_is_unavailable (DISTINCT)"` → `"...→ BLOCK via pbo_cpcv_is_unavailable (DISTINCT)"`.
- `:42-49` (test 1): rename to "BLOCKS with the distinct cpcv-exempt audit..."; `:44` `expect(r.ok).toBe(true)` → `false`; `:48` `expect(r.auditPayload.blocked).toBe(false)` → `true`.
- `:51-60` (test 2, "is DISTINCT from the legacy-null grandfather path"): no assertion literal needs to change (it never asserted `.ok`), but update the comment at `:58` ("Both proceed, but they must be queryably different") since it becomes factually wrong — one blocks, one proceeds.
- `:62-66` (test 3, "carries pbo_p_value..."): unaffected, no change.
- `:69-94` (legacy-null and standard block/pass describe blocks): unaffected, no change (legacy-null was already independently fixed by `707810b7` and this packet doesn't touch it).

**`src/server/lib/__tests__/paper-to-deploy-ready-gates.test.ts` and `paper-to-deploy-ready-gates-parity.test.ts`**: **no edits needed.** These 21 failures are collateral damage from item 1 (BIF) and are expected to return GREEN automatically once `bif-gate.ts`'s legacy-null revert lands — the fixtures were never wrong, BIF's bug was short-circuiting them. Verify this happens (do not assume) as part of Part 4's verification pass; if any of the 21 do NOT auto-heal, that is new information requiring investigation before landing, not a silent "close enough."

### Explicitly OUT OF SCOPE (do not touch)
- `src/server/lib/b14-ci-gate.ts` (any branch, including `evaluateDsrWalkForwardGate`'s `legacy_proceed` — see Part 0).
- Any BIF/WFE/parameter-drift/PBO branch not named above (block thresholds, warn bands, computation-error fail-closed paths, classifier_error fail-closed path, degenerate_is block, plain-WF `"plain_wf_is_unavailable"` block — all correct and untouched).
- Any file outside the 4 named gate files + their direct companion unit tests + `gate-chain-integration.test.ts` + `finding1-pbo-cpcv-degenerate.test.ts` + `walk_forward.py`'s 2 named comment regions.
- `lifecycle-service.ts` / `paper-to-deploy-ready-gates.ts` production code — both already correctly branch on `.status` for WFE/param-drift and will correctly start blocking-when-appropriate for BIF once `.passed` is truthful again; no call-site code changes are needed anywhere.

---

## 4. Verification plan

**Every test below was run against the pinned worktree HEAD this session** (`node node_modules/vitest/vitest.mjs run <file>`) — this is not a projection, it is the actual current state.

### Must flip from RED to GREEN (exact current failures, file:line):
| Test | File:line | Item |
|---|---|---|
| BIF LEGACY PASS: bif=null → grandfather pass | `gate-chain-integration.test.ts:1277` | 1 |
| WFE DISCONNECT (wrong key) → grandfather PASS | `gate-chain-integration.test.ts:236` | 3 |
| CPCV WFE: cpcv_exempt, NOT legacy_null | `gate-chain-integration.test.ts:1132` | 3 |
| CPCV PBO: reason=pbo_cpcv_is_unavailable | `gate-chain-integration.test.ts:1158` | 2 (assert flips to `false`) |
| Param-drift DISCONNECT → legacy_null PASS | `gate-chain-integration.test.ts:1479` | 4 |
| Param-drift CPCV: cpcv_exempt + distinct audit | `gate-chain-integration.test.ts:1576` | 4 |
| Param-drift Legacy: neither key → legacy_null | `gate-chain-integration.test.ts:1588` | 4 |
| PROCEEDS with distinct cpcv-exempt audit... | `finding1-pbo-cpcv-degenerate.test.ts:44` | 2 (assert flips to `false`) |
| bifReliable=false×5 + legacy-null×5 (unit) | `wave3-track3b-bif-gate.test.ts` (multiple) | 1 |
| legacy_null×3 + cpcv_exempt×2 (unit) | `wave27-5-pass-b-wfe-gate.test.ts` (multiple) | 3 |
| legacy_null×2 + cpcv_exempt×3 (unit) | `wave27-5-pass-b-parameter-drift-gate.test.ts` (multiple) | 4 |
| genuine legacy-null still grandfathers | `bif-gate-proxy-basis.test.ts` (1 test) | 1 |

Plus (**must auto-heal without direct edits** — verify, don't assume):
- `src/server/lib/__tests__/paper-to-deploy-ready-gates.test.ts` — 15 of 21 file failures.
- `src/server/lib/__tests__/paper-to-deploy-ready-gates-parity.test.ts` — 6 of 6 file failures.

### Explicitly DO NOT flip (out of scope, pre-existing, unrelated defect classes — confirm they are STILL failing after this packet's fix, for the same reason, not a new reason):
- `gate-chain-integration.test.ts:550,571` (DSR gate — Part 0's named 5th-sibling follow-up).
- `deepscan14-shadow-stage.test.ts` DSR test + its unrelated "stamps the frozen-policy baseline" test (mock-content mismatch, confirmed unrelated to this cluster).
- `deepscan17-dsl-guards-manual-path.test.ts`'s 2 SHADOW→PAPER failures (missing `getMinSampleSize` mock export — confirmed unrelated, a stale test-mock gap in a different gate).
- `deepscan7-lifecycle-manual-path-parity.test.ts`'s 2 "needsFirstTimeFreeze" failures (spy called with an extra `"PAPER"` argument — confirmed unrelated to any of the 4 gates in scope).

### No-regression requirement
No currently-passing test in `gate-chain-integration.test.ts` (80 of 89 currently pass) may newly fail. Re-run the full file after the fix and diff pass/fail counts against this session's baseline (80 passed / 9 failed, 7 of the 9 in-scope) — expect 87 passed / 2 failed (the 2 DSR failures, unchanged, out of scope).

### Commands (run in smallish batches — a single combined run across ~19 files OOM'd this session; the tool's own hard-rule real-binary invocation applies)
```
node node_modules/vitest/vitest.mjs run src/server/__tests__/gate-chain-integration.test.ts --reporter=verbose
node node_modules/vitest/vitest.mjs run src/server/__tests__/finding1-pbo-cpcv-degenerate.test.ts --reporter=verbose
node node_modules/vitest/vitest.mjs run src/server/__tests__/wave3-track3b-bif-gate.test.ts src/server/__tests__/wave27-5-pass-b-wfe-gate.test.ts src/server/__tests__/wave27-5-pass-b-parameter-drift-gate.test.ts src/server/__tests__/wave29-pass-a2-pbo-gate.test.ts --reporter=verbose
node node_modules/vitest/vitest.mjs run src/server/__tests__/bif-gate-proxy-basis.test.ts --reporter=verbose
node node_modules/vitest/vitest.mjs run src/server/lib/__tests__/paper-to-deploy-ready-gates.test.ts src/server/lib/__tests__/paper-to-deploy-ready-gates-parity.test.ts src/server/lib/__tests__/finding2-bif-cpcv-advisory.test.ts --reporter=verbose
```
Plus, at implementation time (not run in this staging pass, since no `.ts`/`.py` file was edited to author this packet): `node node_modules/typescript/bin/tsc --noEmit` on the 4 touched `.ts` files and `python -m pytest src/engine/tests/ -k walk_forward` (or the project's equivalent scoped pytest invocation) for `walk_forward.py`'s comment-only edit (should be a no-op — no functional Python change, but confirm collection doesn't break on the comment edit).

---

## 5. Rollback

Each of the 4 files' changes is independently, cleanly revertible (`git revert` of the single landing commit, or a targeted `git checkout <prior-sha> -- <file>` if landed as part of a larger commit — land as isolated, file-scoped diffs to keep this cheap). No new environment variable, feature flag, or migration is introduced — this restores the exact `passed`/`ok` contract the module docstrings, CLAUDE.md, and (for item 2) the operator's own ratification already document as canonical, so there is no new "default" to flag-gate per the skill's rollback guidance (mirrors the precedent commit `707810b7`, which also shipped a straight revert with no flag). Item 2 (`pbo-gate.ts`) has **zero code to roll back** — only comments/docstrings/tests change, so its "rollback" is simply reverting those file's prose, with zero runtime effect either way.

---

## Plain-English for the operator

Four small pieces of code that decide whether a strategy is allowed to move from paper-testing toward live-capital readiness got flipped backwards by a commit on 2026-07-12, so that "we don't have this measurement yet, so don't block on it" (the intended, documented behavior) silently became "we don't have this measurement, so block it forever" for old backtests and for the CPCV mode your system runs in by default. One of the four (BIF) is actively blocking promotions right now. Three of the four (BIF, WFE, parameter-drift) are being restored to their originally-intended, documented behavior — nothing new is being made looser than it was designed to be, this is fixing an accidental over-tightening back to spec. The fourth (PBO) is the one case where you already looked at this and said "no, keep it strict" — that one's code stays exactly as it is; only the comments and tests that still say the old thing get corrected to match your decision. Nothing here touches money, live trading, or any threshold number — it only fixes which direction a pass/fail flag points.
