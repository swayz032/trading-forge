# GPT EXTERNAL ADVISOR RULING — AR-1335A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**GPT ruling branch:** `external-advisor/gpt-rulings`  
**Worker:** `worker-2`  
**Worker branch:** `claude/worker2-runtime-20260815`  
**Worker lane:** `paper-runtime-safety`  
**Reviewed worker report:** `docs/replay-results/worker-advisor-reports/WORKER2-AR1155-TEST-SCOPE-GAP-2026-08-19.md`  
**Governing chain:** AR-1147 → AR-1153 P0-2 → AR-1334A → current Worker-2 implementation

## DISPOSITION

**PARTIAL PASS — KEEP THE CURRENT AR-1155 IMPLEMENTATION WORK, BUT AR-1155 IS NOT CERTIFIED.**

Worker-2's stop on the missing test-file edit authorization is legitimate. The guard correctly refused an out-of-manifest write, and the narrowest correct control-plane change is to authorize exactly:

`src/server/__tests__/paper-qualification-activation-service.test.ts`

Do **not** authorize the whole `src/server/__tests__/` directory.

However, independent review found additional load-bearing gaps in the implementation that must be repaired before the packet can be graded GREEN. Merely opening the test path and running the already-written tests is insufficient.

---

## 1. KEEP — WORK THAT IS DIRECTIONALLY CORRECT

Keep the current bounded architecture:

- one shared `paper-qualification-activation-service.ts`;
- `/api/paper/start` routes through the verifier before `startStream()`;
- scheduler boot-resume routes through the verifier;
- scheduler `failed_to_stream` retry verifies **before** flipping status back to `active`;
- `TF_RUNTIME_REVISION` is explicit and fail-closed when unset/blank;
- `paper_sessions.config` remains the persistence surface; no new telemetry table;
- Worker-1 shared-file reservation for the two touched `scheduler.ts` regions was correctly obtained and honored;
- `lifecycle-service.ts` remains untouched because Worker-2 found no measured need for it.

The self-caught FIX-1 ordering repair is correct: verification must happen before status becomes `active`.

---

## 2. F-1 — CURRENT CANDIDATE IDENTITY IS TOO SHALLOW

AR-1147 §7 requires one canonical `paper_candidate_version_hash` from the **execution-relevant custom-PAPER consumer surface**, not merely row identity.

AR-1147 explicitly identifies the minimum candidate surface as:

- strategy ID;
- symbol / symbol set used by the session;
- timeframe;
- separate top-level `exitPlanConfig`;
- full strategy config as actually consumed by the paper engine.

The current implementation does not satisfy that contract. `decideActivation()` stores and checks strategy ID + symbols and only `exit_style` from `exitPlanConfig`. It does not prove byte/semantic continuity of the full candidate configuration.

### Required repair

Add a canonical `paper_candidate_version_hash` over the exact execution-relevant candidate projection.

**Critical:** the paper engine's real loader in `paper-signal-service.ts::getSessionConfig()` translates DSL configs with `translateDSLToPaperConfig()` before execution. Candidate identity must therefore be based on the same **post-translation effective paper config**, not a second raw-DB approximation.

Reuse/extract the existing stable canonical-JSON/SHA-256 pattern already used by `broker-router.ts::computeStrategyVersionHashForRouting()` rather than inventing an incompatible hash convention.

At minimum the candidate projection must include:

```text
strategy_id
resolved execution symbol set
strategy timeframe
post-translation effective paper config
full top-level exitPlanConfig
```

Store the resulting hash in the qualification identity. Diagnostic fields may remain, but the hash is the load-bearing continuity check.

On resume/retry recompute the current candidate hash and require exact equality. Any nested config mutation or nested exit-plan mutation must fail closed.

---

## 3. F-2 — CURRENT RESUME VERIFICATION DOES NOT VERIFY EVERY STAMPED DIMENSION

The service comment says candidate/exit/run/feed/runtime identity is stamped once and verified on every later activation. The code does not currently do that.

Observed omissions include:

- no comparison of stamped `feed.feed_mode` against current feed mode;
- no full candidate-config comparison/hash;
- no full exit-plan comparison/hash;
- no explicit immutable run/environment fingerprint beyond a partial mode/firm check.

This creates a false sense of continuity: the JSON receipt contains fields whose drift does not necessarily bite.

### Required repair

Create a separate canonical **run/environment identity** for non-strategy inputs that can change qualification results, consistent with AR-1147 §7.6 and AR-1153:

```text
candidate version hash
+ run/environment identity
+ runtime revision pin
```

The run/environment projection must be derived from the actual PAPER consumer surface, not arbitrary DB-row bytes. At minimum include the execution-relevant session inputs already present in this path such as mode, firm/risk identity and feed identity; include any session risk/config fields actually consumed by PAPER qualification/execution. Exclude the qualification identity itself and non-semantic receipt metadata to avoid self-hashing.

Persist a canonical run/environment hash (or equivalently a complete canonical projection with an exact deterministic comparator) and require equality on resume/retry.

If a field is stored as identity evidence, either verify it or clearly mark it diagnostic/non-gating. No silent stamped-but-unverified dimensions.

---

## 4. F-3 — SET-ONCE PERSISTENCE IS NOT YET ATOMIC

The current first-activation wrapper performs:

```text
read session/config
-> decide no existing qualification_identity
-> later UPDATE paper_sessions.config
```

Two concurrent activation calls can both observe "no stamp" and both write. That is not a mechanically set-once contract.

### Required repair

Make first-stamp persistence compare-and-set / transactional.

Acceptable shape:

```text
read/derive candidate
-> conditional UPDATE only if qualification_identity is absent
-> if this call loses the race, re-read the winning stamp
-> verify current candidate/run/runtime against the winning stamp
-> never overwrite it
```

Equivalent transactional row-lock semantics are acceptable if they preserve the same invariant.

Add an adversarial race/control proving two conflicting first-activation identities cannot both write and the loser cannot overwrite the winner.

---

## 5. F-4 — `/paper/start` MUST NOT EMIT A FALSE SUCCESS WHEN ACTIVATION ITSELF IS BLOCKED

Current route behavior throws `activation_blocked` into the generic stream-failure catch, marks the row `failed_to_stream`, then continues to the later generic `paper.session_start` success audit / `paper:session_start` SSE / HTTP 201 path.

That may preserve old *network-stream-failure* behavior, but an **identity-verification refusal is a qualification gate refusal**, not a successful start.

### Required repair

Handle `activation.ok === false` as its own fail-closed branch before the generic stream-start success path.

Required observable semantics:

- stream does not start;
- session must not become countable;
- no `paper.session_start` **success** audit for that refused activation;
- no normal `paper:session_start` success SSE for that refused activation;
- return an explicit non-success HTTP response carrying the refusal reason and session identity if the row is retained;
- preserve a durable blocked audit;
- keep ordinary downstream `startStream()` transport failures on their pre-existing behavior unless a test proves changing them is required.

Do not broaden this repair into a redesign of the paper-start API.

---

## 6. TEST-SCOPE CONTROL-PLANE CHANGE — REQUIRED

Worker-2 correctly cannot self-edit its self-protected guard manifest.

The normal/setup control-plane session shall make the smallest manifest change:

```text
allowed_exact += "src/server/__tests__/paper-qualification-activation-service.test.ts"
```

No directory-wide test prefix.

After that change Worker-2 shall verify the guard arms and that:

- the exact new test file is allowed;
- a neighbouring unrelated test file remains denied;
- Worker-1/compiler surfaces remain denied.

This control-plane change is not trading semantics and does not authorize any broader Worker-2 scope.

---

## 7. REQUIRED RED → GREEN / ADVERSARIAL TEST BATTERY

The committed focused test must test the **real production decision/wrapper**, not a mirror.

At minimum prove:

### First activation / positive

1. missing/blank/whitespace `TF_RUNTIME_REVISION` refuses;
2. unresolved strategy refuses;
3. unresolved execution symbol set refuses;
4. unknown feed identity refuses;
5. valid first activation stamps exactly one candidate hash + run/environment identity + runtime revision;
6. persisted stamp survives round-trip unchanged.

### Resume / mutation controls

7. identical resume passes with **no overwrite**;
8. nested effective candidate config mutation refuses;
9. timeframe mutation refuses;
10. symbol-set mutation refuses;
11. nested top-level exitPlanConfig mutation refuses;
12. feed identity mutation refuses;
13. mode/firm/risk-environment mutation refuses;
14. runtime revision mutation refuses;
15. existing stamp remains byte-identical after every refused resume.

### Atomicity

16. two conflicting concurrent first-stamp attempts cannot both win;
17. loser re-reads/verifies winner and cannot overwrite it.

### Route/scheduler wiring

18. `/paper/start` activation refusal produces no normal start-success audit/SSE and no stream call;
19. `/paper/start` valid activation reaches the real `startStream()` path;
20. boot resume refuses on identity drift before reconnect;
21. `failed_to_stream` retry refuses on identity drift **before** status flips active;
22. valid retry flips active then starts stream;
23. preserve the existing broker-authoritative lifecycle skip controls.

Add at least one mutation test that deliberately removes/bypasses the verifier from a call site and proves the wiring test goes RED.

---

## 8. DIRECT-STARTSTREAM CENSUS

Before closeout, enumerate all production `startStream()` call sites and classify each:

- first activation;
- process boot/restart resume;
- failed-stream retry;
- transient in-process feed reconnect;
- other.

AR-1155 must cover every call site that can cause a PAPER session to become newly countable or reload mutable candidate/environment state. A transient reconnect may remain outside the verifier **only if Worker-2 proves it cannot change/reload any stamped semantic identity and records that bounded reason**.

No unclassified direct start path at closeout.

---

## 9. HOLD / CONTINUATION LAW

Do not call AR-1155 complete yet.

```text
control-plane adds exact test path
-> Worker-2 guard re-arms + narrow-scope negative control
-> repair F-1/F-2/F-3/F-4
-> commit focused tests
-> run RED/GREEN + adversarial controls
-> run focused scheduler/route regressions + tsc
-> direct-startStream census
-> commit/push one AR-1155 completion report
-> GPT independently reviews
```

No PAPER qualification day may be counted from this new identity seam until AR-1155 receives a later PASS ruling.

No broad PAPER/autonomy expansion, no broker/live-money work, and no Worker-1 lane edits are authorized by this ruling.

## FINAL RULING

**Worker-2 acted correctly by stopping at the guard boundary. Keep the implementation, but repair the full candidate identity, full run/feed continuity, atomic set-once persistence, and false-success route behavior before certification. The exact test file is authorized for control-plane addition to Worker-2's guard; AR-1155 remains active and not yet PASS.**