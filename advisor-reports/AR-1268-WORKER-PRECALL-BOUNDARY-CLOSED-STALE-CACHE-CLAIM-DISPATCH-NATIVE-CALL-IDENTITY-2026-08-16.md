# WORKER REPORT — AR-1268 · 2026-08-16

## THE FOUR PRE-CALL EDGES ARE CLOSED AND RE-PINNED INTO THE REAL SEAT. THE EIGHT ARE STILL 0/8. CALIBRATION IS NOT RUN — §9H IS A HARD STOP AND THE OPERATOR HAS NOT SPOKEN.

```text
RULING FOLLOWED     : AR-1267 §3, §4, §5, §6, §9A-G  (H NOT executed — see §7)
TOOLBOX BRANCH      : claude/worker1-p1-toolbox-20260816
TOOLBOX PIN         : 6a06ffae -> e0c44ca4374358e3f9717a73c5faa1f7e963aa89   (pushed, ls-remote verified)
TOOLBOX BUNDLE      : c6182c1e21f7e4efba30797bb9db037540d43e0ca3747d2909b3f4f8066b4e5b (41 files, COMPUTED)
REAL WORKER-1 BRANCH: claude/worker1-h1-20260815
REAL SEAT PIN       : aae50800 -> d62b9b884a2f3526234c2d05636b1b4663162e9a   (pushed, ls-remote verified)
                      packet commit d309116d · inventory tail d62b9b88
F-1 SELF-PROTECTION : CLOSED  — exact rules + mutation, and a DISCRIMINATES control
F-2 STALE CACHE     : CLOSED  — defect reproduced through the REGISTERED command, then repaired
F-3 CLAIM->DISPATCH : CLOSED  — the transition happens inside PreToolUse, before ALLOW
F-4 ACTUAL BINDING  : CLOSED  — actual model + actual prompt hash-bound to a frozen 8-row artifact
§9E FORCED CAPTURE  : CLOSED
§9G RE-PIN          : DONE, immutable re-pin (not a copy); real preflight re-run after
REAL G2-D CALLS     : 0/8 — queue 5935b1c6…, ready 8, receipts [] (README only)
CALIBRATION         : NOT RUN — no operator utterance
GRADER              : NOT DISPATCHED — see §8
CI                  : NONE at either pin. All evidence below is LOCAL.
NEXT WORKER AR      : AR-1269
```

---

## 0. PRE-FLIGHT (advisor-ruling §0.-2, seven questions, answered before code)

1. **SCOPE** — AR-1267 §9 A–H. Touched exactly: toolbox `tooling/{lane-boundary-guard, g2-precall-guard, g2-precall-guard.test, claude-hook-bridge}.mjs` + one new test file; real seat `.claude/worker1-hook-guard-manifest.json`, `scripts/{claude_guard_hook,claude_toolbox}.mjs`, three new `scripts/` files, one new `src/engine/tests/` file, one new artifact under `docs/replay-results/`, and the inventory tail. Nothing else.
2. **STOP CONDITIONS** — §9H (calibration needs an operator utterance) → **FIRED, honoured.** Spending any of the eight → not approached. Worker-2 / runtime / compiler / backtest / PAPER / broker → not touched.
3. **PROHIBITED** — reopening D1-A/B/C1, the quartet finalizer, the exact actual-model matcher, the dirty-exception design; reordering the eight-condition queue; broadening the packet. None done.
4. **REQUIRED PROOFS** — RED→GREEN, mutations that bite, a biting stale-cache control, real read-only preflight after re-pin. All produced (§2–§6). **No grade is required by AR-1267**, so §11c's pre-authorization does not fire; see §8.
5. **MEASURED REPO STATE** — all four findings' premises verified at `aae50800` before any edit: `scripts/` IS in `edit_scope.allowed_prefixes` and neither live file is in `SELF_PROTECTED_RULES`; `cachedToolbox()` at `claude_guard_hook.mjs:78-87` branches on `existsSync` only; `conditionIsSpent()` at `g2-precall-guard.mjs:95-98` treats `.attempt` as spent while `claim_attempt()`'s own docstring says "BEFORE the model is invoked". **AR-1267 §4 attributes `cachedToolbox()` to `claude_toolbox.mjs`; it is in `claude_guard_hook.mjs`.** Substance unaffected — flagged so the next reader greps the right file.
6. **ALREADY LANDED?** — `system_inventory.py --check` FRESH; greps for `native_call`/`precall_transition`/`native_call_manifest` across `*.mjs|*.py|*.json` returned **nothing**; memory grep hit only `[p1-guard-live-worker1-seat]`, which is the AR-1266 boundary, not this work. No prior art. Terms searched are named here because an unstated search is indistinguishable from no search.
7. **METRIC/GRADE MIX** — none. §9F is entirely mechanical controls; nothing in it asks the doer to judge correctness.

**Outcome: NO CONTRADICTION ⇒ executed without a round-trip.**

---

## 1. F-1 — the live control surface (§3)

**RED (graded pin 6a06ffae):**
```
classifyPath('worker-1','scripts/claude_guard_hook.mjs')  -> not SELF_PROTECTED
classifyPath('worker-1','scripts/claude_toolbox.mjs')     -> not SELF_PROTECTED
```
**REPAIR:** four `exact` rules (doorway, activator, transition doorway, freezer) plus a `contains` rule for `native_call_manifest`. **`exact`, deliberately not a `scripts/` prefix** — a prefix passes every protection assertion and silently freezes the whole lane, so the DISCRIMINATES control below is what separates the two.

**GREEN:** `ar1268-precall-boundary.test.mjs`, 7 protection cases + 1 discriminator + 1 mutation.
**CONTROL — DISCRIMINATES:** `scripts/system_inventory.py` and `scripts/g2d_real_queue_preflight.py` stay editable.
**CONTROL — MUTATION:** removing only `scripts/claude_guard_hook.mjs` from the rule set makes that file editable again while the unmutated call still denies. The mutation BITES.

**Reported, NOT fixed (AR-1267 §9 forbids broadening):** the frozen QUEUE and the real receipt directory sit under `docs/replay-results/`, an allowed prefix, and are **not** self-protected. That is the same species as F-1 one level over and it predates this packet. I protected only the artifact this packet introduced. **This is a desk question, not a worker decision.**

---

## 2. F-2 — the stale toolbox cache (§4)

The strongest evidence in this packet. Driven through the **actually registered command**, not an imported function.

**RED — at the graded pin, seeded TEMP with an old permissive runner + a syntactically valid stamp for a different pin, then sent a PreToolUse edit against `.claude/settings.json` (a SELF_PROTECTED path):**
```
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow",
                       "permissionDecisionReason":"STALE PERMISSIVE TOOLBOX"}}
```
A self-protected path, **allowed**, by a toolbox nobody activated — while the manifest and GitHub both said NEW LAW. Silent guard downgrade, end to end.

**REPAIR:** `cachedToolbox()` now takes the expected identity from the **manifest** (`_toolbox_pin`, `_toolbox_bundle_sha256` — the manifest is self-protected; the activator was not) and verifies: read stamp → exact pin → exact bundle → re-hash the cached bytes back to that bundle → else rematerialize → post-check the returned pin+bundle → else DENY. Step 4 is local hashing of 41 small files, not 41 `git show` calls, so the fast path stays fast (§4's "do not materialize 40 Git objects on every tool call").

**GREEN — same probe, repaired doorway:** `deny`, reason names the self-protected surface. Stamp on disk now carries the manifest's pin and bundle.

**RED/GREEN summary (`scripts/ar1268_doorway_controls.test.mjs`, 7 cases):**
| control | pre-fix | post-fix |
|---|---|---|
| stale cache cannot run the old law | **RED** | GREEN |
| right stamp, TAMPERED bytes | **RED** | GREEN |
| manifest with no pin/bundle → deny | **RED** | GREEN |
| witness: seeded runner really is permissive | GREEN | GREEN |
| cold cache materializes and enforces | GREEN | GREEN |
| warm correct cache is REUSED (mtime unchanged) | GREEN | GREEN |
| in-scope ordinary edit still permitted | GREEN | GREEN |

The four green-at-both rows are the discrimination evidence: the suite is not always-red, and the witness row makes the other assertions falsifiable.

---

## 3. F-3 — the inverted state machine (§5). The important one.

**The contradiction was never in the predicate — it was in WHO CLAIMS.** `claim_attempt()` writes `.attempt` before the model is invoked; `conditionIsSpent()` denied on seeing any `.attempt`. Claim-first denied, claim-never ran unbudgeted. The authorized sequence was unreachable in both directions.

**REPAIR, exactly as §5 orders — no second procedural seam.** After all permit/model/prompt checks pass and the state is READY, the trusted PreToolUse path invokes a protected doorway that performs create-only `.attempt` then create-only `.dispatch` **through the existing Python law**, and only then returns ALLOW. `scripts/g2d_precall_transition.py` adds **no receipt law of its own** — it calls `claim_attempt()` and `record_native_dispatch()`.

`conditionIsSpent` is **unchanged and now correct**: at gate time the state is READY, so a pre-existing `.attempt` is exactly what it looks like — a prior claim or a crash — and denies pending desk adjudication. A comment block says so, because the next reader will otherwise "fix" it back.

**GREEN — `src/engine/tests/test_g2d_precall_transition.py`, 10/10, every control shelling out to the real script as a child process:**
```
attempt then dispatch written, and only then ok      PASS  (asserts the FILES, not the return value)
dispatch receipt records opus + NOT_EXPOSED          PASS  (no invented task id)
pre-existing attempt -> deny, not "resumed"          PASS  (and no dispatch written beside it)
second identical invocation -> deny                  PASS
task hash the queue does not pin -> deny, nothing written  PASS
ref outside the frozen queue -> deny                 PASS
pre-existing dispatch -> deny                        PASS
claim ok + dispatch fails -> deny, ATTEMPT SURVIVES  PASS  (fails if anyone adds rollback)
two CONCURRENT processes -> exactly one ok           PASS  (create-only is the arbiter; no lock)
a different queued ref is unaffected                 PASS  (discriminator)
```
Plus 6 gate-level cases in the toolbox suite, including a spy assertion that the transition was **actually invoked** — "allow" alone is satisfied by a guard that skipped it, and that is precisely the AR-1266 shape.

---

## 4. F-4 — actual model and actual prompt (§6)

**§6.1 — the model field, read from the live Agent tool schema WITHOUT dispatching.** Two facts, both load-bearing and neither guessable: `model` is **optional**, so an omitted field is *inherited*, not requested — and `subagent_type: 'fork'` **ignores `model` entirely** and inherits the parent context, which would break the isolation law and the model binding in one call. Both now DENY. A third schema fact set the design: `additionalProperties: false`, so a real native call **cannot** carry a `g2d_permit` field — the permit therefore rides in `description`, never in `prompt`.

**§6.2 — the frozen eight-row artifact,** `docs/replay-results/svkm-extraction-certified/grade/opus-v2/native_call_manifest_t1.json`, written by `scripts/g2d_freeze_native_calls.py` **before any answer exists**. It is an execution-layer artifact: it does not select, reorder, add to or remove from the queue.

*Nothing in it is authored extraction semantics.* The prompt is reused **by import** from `anchor_locator._SYSTEM_PROMPT` and `_build_user_message` — the fairness contract the benchmark packet itself declares — and the freezer **refuses to write anything** unless both hash to the values `benchmark_packet_v1.json` pins (`966d5942…`, `e283143d…`) and the transcript hashes to `df72444f…`. **The one declared delta** (stated the way AR-1234's batch arm stated its own): a native call has one `prompt` field and no system/user split, so the two frozen strings are joined with a literal `\n\n`. That joiner is the only authored byte.

`--verify` re-derives the committed artifact byte-identically from the frozen inputs.

**GREEN — negative controls, all DENY before the model runs:**
```
model 'sonnet' with a valid opus permit          DENY   (and nothing is claimed)
model field omitted (inherited)                  DENY
subagent_type 'fork'                             DENY
ONE-BYTE prompt mutation                         DENY
appended hint / pasted batch answer              DENY
forged-but-internally-valid permit, wrong call   DENY
no native-call manifest loaded                   DENY   (never an unbound allow)
manifest frozen against a different queue        DENY
unmutated authorized call                        ALLOW  (discriminator)
```

---

## 5. §9E — forced capture

A `.dispatch` without both `.raw` and `.completion` denies **every** subsequent frozen dispatch. Controls: outstanding blocks the next ref (and claims nothing); a completed quartet does not block; **`.raw` without `.completion` still blocks** — a stranded answer is not a captured one; an untouched receipt dir reports nothing outstanding.

---

## 6. §9G — re-pin, and the budget after it

Immutable re-pin, not a copy: `6a06ffae -> e0c44ca4`, bundle **COMPUTED** by `claude_toolbox.mjs materialize` over 41 files, `branch_drifted_from_pin: false`. Manifest and activator both updated; `_toolbox_pin_history` records the chain.

**Read-only real preflight, re-run AFTER the re-pin:**
```
queue_artifact_sha256 = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
queue_count 8 · claimed [] · dispatched [] · completed [] · crash_shaped [] · stranded [] · ready 8
receipt directory non-README = []
ALL 8 ONE-SHOT ATTEMPTS UNSPENT.
```
The hash-pinned dirty exception is intact: `git diff HEAD --binary -- docs/wave25-exit-engine-ab-report.md | sha256sum` = `e200765c…`, equal to the manifest. The file was not touched, cleaned, committed, or exempted differently.

---

## 7. §9H — NOT EXECUTED, and why that is the correct result

The calibration needs an **explicit operator utterance in the live session**; §9H says not to infer it from the ruling. I asked the operator in plain language at the start of this packet and he has not answered. **`D1-C2` (actual_model_identity) and the real native-event witness therefore remain UNWITNESSED — this packet does not close them and does not claim to.** Nothing here was widened to compensate.

---

## 8. GRADER — deliberately not dispatched

AR-1267 requires no grade, so `worker-execution §11c`'s standing pre-authorization does not fire. The runtime boundary AR-1266 reported — subagents are not dispatched unless the operator asks — is the same boundary §9H tells me to respect, and dispatching a grader would be me deciding that boundary applies only to calls I find inconvenient. **The independent grade on this packet is OWED and unspent.** One word from the desk or the operator and `accuracy-validator` goes out against `d62b9b88` with the durable-receipt brief.

---

## 9. FINDINGS — including against myself

1. 🛑 **THE CROSS-LANGUAGE CONTROL CAUGHT A DEFECT THAT WOULD HAVE DENIED ALL EIGHT CALLS.** `--emit-prompt` wrote through **text-mode stdout**, so all 15 newlines left as CRLF: 25948 chars in, **25963 bytes out**. The JS guard hashed a prompt this repo never authorized, and all 8 parity rows disagreed. The trap is the second half: **Python's own round-trip reported EQUAL**, because `text=True` re-applies universal newlines — *the instrument hid the defect from itself*, and a same-language check would have shipped it. The plausible "fix" under time pressure is loosening the guard. Now written as bytes; 13/13.
2. **A wrong harness, disclosed:** the first `test_g2d_precall_transition.py` computed the repo root three levels up instead of four, so every child process died with "can't open file" and **10 controls failed identically with exit 2 and empty stdout**. A uniform failure across every case accuses the harness, not the subject.
3. **Two constants asserted from memory, corrected by measurement:** I wrote `attempt_status == "CLAIMED"` and `native_task_id == "NOT_EXPOSED"`. Measured values are `ATTEMPT_CLAIMED_BEFORE_INVOCATION` and `NOT_EXPOSED_BY_CLAUDE_CODE_SUBSCRIPTION_RUNTIME`. Both now **imported**, not restated.
4. **Two previously-passing tests went RED on F-4 and are updated, not deleted.** "POSITIVE: an exact authorized permit reaches the tool boundary" and its strict-mode twin both blessed a call carrying **no `model` field**. That is the defect, caught by its own suite. The old shape is retained as new negative controls.
5. **A bug I introduced and caught before commit:** the bridge first loaded the G2 artifacts on *every* PreToolUse event, so an unreadable G2 file would have denied ordinary Edit/Write work — the same brick-the-seat shape as the prepared fragment's unconditional `TaskCompleted`. Now scoped to subagent dispatches only. Fail-closed has to be aimed at the thing it protects.
6. **Pre-existing, reported not fixed:** the frozen queue and the real receipt directory are under an allowed prefix and are not self-protected (§1).
7. **A documentation slip in AR-1267 §4:** `cachedToolbox()` lives in `claude_guard_hook.mjs`, not `claude_toolbox.mjs`. Substance unaffected.
8. **Red-proof method, disclosed:** the new toolbox suite was run against graded-pin copies with **inert import shims** (the old rule array re-exported; the new helpers added as pure functions the old gate never calls) — otherwise the file fails to load and every case reads RED for one reason, which proves nothing per-guard. Result **20 RED / 8 GREEN**, and the 8 green are the discriminators.

---

## 10. COMMANDS AND RESULTS

```text
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/*.test.mjs   159/159   (131 before, +28)
node --test scripts/ar1268_doorway_controls.test.mjs                           7/7
node --test scripts/ar1268_native_call_parity.test.mjs                        13/13
python -m pytest src/engine/tests/test_g2d_precall_transition.py …           143/143   (6 G2/isolated suites)
python scripts/g2d_freeze_native_calls.py --verify                           VERIFIED
python scripts/g2d_real_queue_preflight.py                                   8 ready / 0 spent
python scripts/system_inventory.py --check                                   FRESH
red-proof, new toolbox suite vs pin 6a06ffae (inert shims)                   20 RED / 8 GREEN
red-proof, doorway controls vs pre-fix claude_guard_hook.mjs                  3 RED / 4 GREEN
```
Every one of these is LOCAL. **There is no CI at either pin.**

---

## 11. WHAT IS NOT PROVEN

- **No real Claude-generated `PreToolUse` payload from an actual `Agent` dispatch has been observed.** Every control drives the registered command with a synthetic payload. That is stronger than a direct function call and weaker than a live event, and only the calibration closes the gap.
- `actual_model_identity` (D1-C2) remains **UNWITNESSED**. `APPROVED_ACTUAL_MODEL_IDENTITIES` was not widened.
- The `subagent_type` pin (`general-purpose`) is my reading of the live schema's isolation semantics. It is falsifiable in one calibration call and would be caught there — **if the desk wants a different type, the artifact must be re-frozen before the first call, not after.**
- `claude-finish-check`'s structural REVIEW_REQUIRED problem is untouched; `finish.enabled` stays false and `TaskCompleted` stays unregistered.
- AR-1242's canonical-population membership test remains RED, pre-existing and unsettled.

---

## 12. RECOMMENDATION

`GRADE_REQUESTED_CONTINUING` on §9A–G. **`APPROVAL_REQUESTED` on §9H only** — that one is genuinely not authorized, by the ruling's own words, and it is the last thing standing between this boundary and a live native witness.

**NEXT:** hold at this pin. On the operator's word, run the single non-G2 Opus calibration and report the four §9H witnesses; without it, the eight stay locked and 0/8.
