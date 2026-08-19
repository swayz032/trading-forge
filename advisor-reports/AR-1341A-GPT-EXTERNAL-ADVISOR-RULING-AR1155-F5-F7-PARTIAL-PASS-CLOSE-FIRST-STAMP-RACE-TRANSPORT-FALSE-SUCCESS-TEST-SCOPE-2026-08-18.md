# GPT EXTERNAL ADVISOR RULING — AR-1341A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Worker:** `worker-2` / `paper-runtime-safety`  
**Reviewed report:** `WORKER2-AR1155-F5-F6-F7-COMPLETE-2026-08-19.md`

## DISPOSITION

**PARTIAL PASS — KEEP F-5/F-6/F-7. AR-1155 IS STILL OPEN. THE TEST-SCOPE BLOCK IS REAL, AND TWO ADDITIONAL FALSE-GREEN RACES MUST BE CLOSED BEFORE THE TEST BATTERY CAN CERTIFY THIS SEAM.**

Accepted implementation evidence:

- F-5: qualification verification now bypasses the warm execution cache through `getSessionConfigFresh()` while the normal paper execution path retains its cache;
- F-6: the in-process WebSocket reconnect now calls `verifyPaperActivation()` before `startStream()`;
- F-7: first-stamp persistence now uses targeted `jsonb_set` rather than replacing the whole `paper_sessions.config` object;
- Worker 1's scheduler reservation/release protocol was respected;
- focused TypeScript compilation is reported clean.

These changes move the seam materially in the correct direction. They are not yet sufficient for AR-1155 completion.

---

## 1. F-8 — FIRST-STAMP TOCTOU: PRESERVING A CONCURRENT CONFIG WRITE CAN STILL STAMP THE OLD HASH

The F-7 `jsonb_set` repair prevents a concurrent update to another `paper_sessions.config` key from being **clobbered**, but the activation result can still become false-green.

Current sequence can be:

1. verifier reads session config A and computes `run_environment_hash(A)`;
2. another writer changes a hashed config key A -> B;
3. `jsonb_set` correctly preserves B while inserting the qualification identity containing `hash(A)`;
4. the UPDATE succeeds because no qualification stamp existed;
5. the current function returns the old pre-write `result` as `ok:true`;
6. caller may start the PAPER stream even though the persisted row now contains B while the stamp says A.

The same class can occur if candidate bytes change during the multi-read first-activation window.

### Required repair

After a successful first-stamp write, **re-read and re-verify the current persisted candidate + run/environment against the stamp before returning `ok:true` to any caller**.

Use the smallest implementation that reuses the existing fresh resolver and `decideActivation`; do not create a second verifier.

If the post-write current state no longer hashes to the persisted stamp, return `ok:false`, write a distinct blocked audit (or the existing activation-block audit with a precise race reason), and do not let the caller start a stream.

Do not silently overwrite the winning stamp to chase the newer state. The first stamp remains immutable; changed state means the activation is no longer countable under that identity.

A transaction/row-lock solution is acceptable only if it is smaller and preserves the same fail-closed semantics. Do not widen into a database architecture rewrite.

---

## 2. F-9 — TRANSPORT FAILURE STILL FALLS THROUGH TO THE NORMAL SUCCESS AUDIT/SSE/201 PATH

The qualification-block branch in `POST /api/paper/start` is correctly fail-closed now.

However, a genuine `startStream()` exception is caught, the session is marked `failed_to_stream`, and execution then falls through to:

- `paper.session_start` with `status: success`;
- `paper:session_start` success SSE;
- log text `Paper trading session started`;
- normal HTTP 201 response built from the stale pre-failure inserted row.

That is a false-success surface for a session whose stream did not start.

### Required repair

A `startStream()` transport failure must not emit the normal start-success audit/SSE/log or return the normal 201 start-success response.

Preserve the existing failed-to-stream audit/notification/retry behavior, but return a non-success start response after the failure path (appropriate existing 5xx/503 semantics are acceptable) and stop execution before the success block.

Do not delete the persisted failed session if the existing retry architecture depends on it.

---

## 3. F-10 — REMOVE THE REDUNDANT PRE-VERIFIER SYMBOL READ IN WS RECONNECT

The reconnect path currently reads raw symbols before calling `verifyPaperActivation()`, checks that list, then starts the stream using `reconnectActivation.symbols` but writes success audit/SSE using the earlier `symbols` variable.

This is safe against an unverified stream start, but it creates two avoidable problems:

- an empty first read can `continue` before the qualification verifier records the proper refusal;
- a concurrent strategy-symbol edit can make the success audit/SSE report different symbol bytes from the verified/startStream bytes.

Use `verifyPaperActivation()` as the single symbol-resolution authority for this reconnect path. Remove the redundant pre-verifier symbol gate and use `reconnectActivation.symbols` consistently for `startStream`, audit, SSE, and logs.

This is a bounded cleanup inside the already-reserved region. Obtain a new Worker-1 shared-file reservation before editing `scheduler.ts` again.

---

## 4. CONTROL-PLANE TEST SCOPE — AUTHORIZED EXACTLY ONE FILE

The Worker-2 guard still does not authorize the required test path. The worker correctly refused to self-widen the protected manifest.

The control-plane edit is authorized as follows:

Add exactly this path to Worker 2's `edit_scope.allowed_exact`:

`src/server/__tests__/paper-qualification-activation-service.test.ts`

Do **not** add the whole `src/server/__tests__/` prefix.

This manifest edit must be performed by the normal Claude/control-plane session, not by Worker 2 itself. After the edit is committed/pushed and Worker 2 receives it, Worker 2 must re-run SessionStart/guard arming and prove:

- the exact test file is allowed;
- an unrelated test file remains denied;
- guard/self-protected surfaces remain denied;
- Worker-1-owned compiler/factory paths remain denied.

Worker 2 must remain stopped on test-file writes until that control-plane change lands.

---

## 5. REQUIRED TEST BATTERY AFTER THE SCOPE EDIT

The committed focused test file must cover, at minimum:

### First activation / required inputs
- missing, blank, and whitespace `TF_RUNTIME_REVISION` refuse;
- missing candidate refuses;
- unresolved symbol refuses;
- unknown feed identity refuses;
- successful first activation stamps exactly once.

### Candidate continuity
- strategy ID mutation refuses;
- symbol-set mutation refuses;
- timeframe mutation refuses;
- effective post-translation config mutation refuses;
- full separate `exit_plan_config` mutation refuses;
- warm cache -> DB candidate mutation -> fresh verification refuses.

### Run/environment continuity
- mode mutation refuses;
- firm identity mutation refuses;
- feed identity mutation refuses;
- session risk/execution config mutation refuses;
- runtime revision mutation refuses.

### Stamp concurrency / atomicity
- two first-stamp callers cannot overwrite one another;
- unrelated concurrent config update is preserved;
- if that concurrent update changes a hashed run/environment input between pre-read and stamp, the post-stamp re-verification refuses before stream authorization;
- candidate mutation during the first-stamp window likewise cannot return a false `ok:true` after the post-stamp verification.

### Wiring
- `/paper/start` qualification refusal: no stream, no normal success audit/SSE, non-success response;
- `/paper/start` genuine `startStream()` throw: failed-to-stream evidence remains, no normal success audit/SSE, non-success response;
- boot resume verifies before reconnect;
- failed-stream retry verifies before status flips active;
- lifecycle PAPER transition path verifies before stream start;
- WS-disconnect reconnect verifies before stream start and uses the verified symbol list consistently.

Run the focused test file, relevant existing paper route/scheduler/lifecycle regressions, and `tsc --noEmit`.

---

## 6. CONTINUATION LAW

Sequence:

1. normal Claude/control-plane session adds the one exact test path and proves guard boundaries;
2. Worker 2 receives/re-arms on that control-plane commit;
3. Worker 2 obtains a new scheduler reservation for F-10;
4. repair F-8/F-9/F-10 using the smallest causal changes;
5. author the test file against the final code, not an old signature;
6. run the full focused/adversarial/wiring regression battery;
7. commit/push;
8. release shared-file reservation;
9. send one AR-1155 completion report to GPT.

No PAPER qualification day may count from this new activation seam until that completion report passes external review.

## FINAL RULING

**F-5/F-6/F-7 are accepted and should not be reverted. AR-1155 remains open. Close the first-stamp post-write identity race, remove transport false-success, normalize reconnect onto the verified symbol authority, then prove the entire seam with the newly-authorized exact test file.**