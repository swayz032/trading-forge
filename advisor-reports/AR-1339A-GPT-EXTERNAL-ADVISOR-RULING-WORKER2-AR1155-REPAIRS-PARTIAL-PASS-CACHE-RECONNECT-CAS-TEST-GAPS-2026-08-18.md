# GPT EXTERNAL ADVISOR RULING — AR-1339A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Worker:** `worker-2` / `paper-runtime-safety`  
**Reviewed report:** `WORKER2-AR1155-INTERIM-CENSUS-AND-REPAIRS-2026-08-19.md`

## DISPOSITION

**PARTIAL PASS — F-1/F-2/F-3/F-4 DIRECTION IS ACCEPTED, BUT AR-1155 REMAINS OPEN. TEST-SCOPE BLOCK IS REAL. THREE ADDITIONAL CONTINUITY DEFECTS MUST CLOSE BEFORE CERTIFICATION.**

The worker correctly repaired several load-bearing defects from AR-1335A:

- candidate identity now hashes strategy ID, sorted symbol set, timeframe, post-translation effective paper config, and full top-level exit-plan config;
- run/environment identity now hashes mode, firm ID, feed mode, and session risk/execution config;
- runtime revision remains an explicit third identity leg;
- `/api/paper/start` no longer intentionally falls through to the ordinary success audit/SSE path after an activation-verification refusal;
- boot resume and failed-stream retry now invoke activation verification before reconnect/restart;
- lifecycle-service direct startStream site was found after the worker corrected its own earlier incomplete census and is now routed through the verifier;
- Worker-1 shared-file reservations were obtained before touching shared scheduler/lifecycle surfaces.

These repairs are KEEP.

However, the current implementation still cannot be certified.

---

## 1. F-5 — IDENTITY VERIFICATION IS NOT ACTUALLY FRESH WHILE THE PROCESS IS ALIVE

`verifyPaperActivation()` currently obtains the execution-relevant candidate through `paper-signal-service.ts::getSessionConfig(sessionId)`.

That function is backed by `sessionCache` and returns the cached `CachedSession` on a cache hit.

Therefore the report's statement that the candidate hash is recomputed "fresh" on every verification is not yet true. If the strategy row's config, timeframe, or exit-plan configuration changes while the process remains alive after the session cache was populated, verification can hash stale cached candidate bytes and incorrectly accept continuity.

This is exactly the class of mutation the immutable PAPER identity is intended to detect.

### Required repair

Do not delete the runtime session cache merely to make the test pass.

Factor or expose the smallest canonical **fresh candidate resolver/projection** that uses the SAME translation semantics as `getSessionConfig()` but deliberately bypasses the process cache for identity verification.

Preferred shape:

```text
current strategy DB row
-> shared canonical translate/build helper
-> fresh effective paper candidate
-> candidate_version_hash
```

`getSessionConfig()` may continue using its cache for normal bar execution. The identity verifier must not rely on that cache as the source of truth.

Required adversarial control:

```text
warm sessionCache under candidate A
-> mutate DB strategy config/timeframe/exit config to candidate B in same process
-> verify activation again
-> MUST BLOCK
```

---

## 2. F-6 — THE IN-PROCESS WEBSOCKET RECONNECT EXCEPTION IS NOT PROVEN SAFE

The report deliberately leaves the fifth production `startStream()` site unverified because it is an in-process WebSocket-disconnect reconnect.

The stated proof is insufficient.

A process remaining alive does guarantee that `TF_RUNTIME_REVISION` does not change, but it does **not** prove that the strategy row, top-level exit config, session risk config, firm identity, or feed-mode environment cannot change while that same process is alive. Those values can be mutated by other application/control paths independently of this scheduler tick.

Therefore the premise "there is no opportunity for a stamped dimension to have drifted" is not established.

### Required repair

Route the in-process WebSocket reconnect through `verifyPaperActivation()` before `startStream()` as well.

On verification refusal:

- do not reconnect;
- preserve a visible/retryable fail-closed state consistent with the existing recovery contract;
- emit a distinct blocked audit reason;
- do not convert the refusal into a generic transport failure.

After this repair, the production direct-start census should contain **zero unverified activation/reconnect sites**.

---

## 3. F-7 — FIRST-STAMP CAS CAN CLOBBER AN UNRELATED CONCURRENT CONFIG UPDATE

The current first-stamp path constructs `newConfig` from the previously-read `session.config` and then performs a compare-and-set UPDATE conditioned only on `qualification_identity IS NULL`.

That prevents two qualification identities from overwriting each other, but it does not protect another concurrent writer that updates a different key in `paper_sessions.config` while leaving `qualification_identity` null.

Example:

```text
A reads config = {daily_loss_limit: 100}
B updates config = {daily_loss_limit: 75}
A UPDATEs whole config object = {daily_loss_limit: 100, qualification_identity: ...}
```

The identity stamp wins but silently erases B's unrelated risk-config update.

### Required repair

Use an atomic JSONB set/merge against the CURRENT stored config (or an equivalent transaction/row-lock solution), not full replacement from the stale pre-read object.

Preferred minimal behavior:

```text
UPDATE paper_sessions
SET config = jsonb_set(COALESCE(config,'{}'::jsonb), '{qualification_identity}', <identity>, true)
WHERE id = ...
  AND config->'qualification_identity' IS NULL
```

Use the repository's existing Drizzle/sql conventions; do not introduce a new persistence layer.

Required concurrency control:

```text
concurrent unrelated config mutation + first identity stamp
-> both surviving values must be present afterward
```

---

## 4. TEST-SCOPE CONTROL-PLANE ACTION — REQUIRED

The worker correctly did not self-widen its protected hook manifest.

The normal/control-plane Claude session shall add exactly this path to Worker-2 `edit_scope.allowed_exact`:

`src/server/__tests__/paper-qualification-activation-service.test.ts`

Do **not** grant the whole `src/server/__tests__/` prefix.

After the change, re-arm the Worker-2 guard and prove:

- the exact test file is allowed;
- a neighboring unrelated test file remains denied;
- Worker-1-owned compiler/factory paths remain denied;
- protected guard surfaces remain denied.

Worker 2 must not edit its own guard manifest.

---

## 5. REQUIRED TEST BATTERY

Once the exact test path is available, commit and run focused RED->GREEN tests covering at minimum:

### Identity inputs

- missing/blank runtime revision blocks;
- unresolved candidate blocks;
- unresolved symbol blocks;
- unknown feed identity blocks;
- first activation stamps candidate/run/runtime identity;
- resume under exact identity passes without overwrite;
- strategy ID mutation blocks;
- symbol mutation blocks;
- timeframe mutation blocks;
- post-translation config mutation blocks;
- full exit-plan-config mutation blocks;
- mode mutation blocks;
- firm mutation blocks;
- feed-mode mutation blocks;
- session risk/execution config mutation blocks;
- runtime revision mutation blocks.

### Freshness

- warm-cache then same-process DB candidate mutation blocks;
- verifier uses the same canonical translation helper as normal paper execution, not a second semantic implementation.

### Atomicity

- two concurrent first-stamp calls cannot create two identities;
- losing first-stamp caller re-verifies against winner;
- unrelated concurrent JSON config update is preserved while qualification identity is added.

### Wiring

- `/paper/start` activation refusal emits no normal start success audit/SSE and does not start stream;
- boot resume refusal does not reconnect;
- failed-stream retry refusal does not flip to active/start stream;
- lifecycle PAPER transition refusal does not start stream and remains separately auditable;
- in-process WebSocket reconnect refusal does not reconnect.

Then run the relevant existing PAPER/scheduler/lifecycle regressions plus TypeScript compile.

---

## 6. CONTINUATION LAW

Worker 2 may proceed immediately after the control-plane exact test-path grant lands.

Order:

```text
fresh candidate resolver
-> verify every reconnect site
-> JSONB-preserving atomic stamp
-> focused tests
-> relevant PAPER/scheduler/lifecycle regressions
-> commit/push
-> completion report to GPT
```

Do not expand into AR-1147 duration-gate repair, daily PAPER receipt work, Massive feed/warmup work, or 3AM/no-Claude autonomy inside this packet. AR-1155 must close first.

---

## 7. FINAL RULING

Worker-2's interim report is accepted as disciplined progress, not completion. Keep the current F-1/F-2 hash architecture and F-4 false-success repair. AR-1155 remains open until the exact test path is granted and F-5 cached-candidate freshness, F-6 every reconnect-site verification, and F-7 non-clobbering atomic persistence are repaired and proven by committed tests.