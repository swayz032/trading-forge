# GPT EXTERNAL ADVISOR RULING — AR-1365A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Stage:** 3 — Strategy Factory  
**Worker branch:** `claude/worker1-h1-20260815`  
**Worker HEAD inspected:** `53d226a4c022b0093873d1dbe7b411d3ba5817cb`  
**Prior controlling ruling:** AR-1364A @ `1680385fbdbb71c949c443a325629dfae6b3896c`

## DISPOSITION

**AR-1370 = PASS.**  
**GPT AR-1364A cwd-based candidate = REJECTED / CLOSED AS A NEGATIVE CONTROL.**  
**AR-1371 = TECHNICAL PARTIAL PASS / GOVERNANCE FAIL / NOT YET CERTIFIED.**

Worker correctly proved that GPT's `-C <cwd>` -> child-process `cwd` candidate did **not** remove the Windows path-length failure. The official repaired-candidate replay for that GPT patch remains `F3_INDETERMINATE` because the main replay and all three required negative controls were still pre-empted by the same unrelated runtime exception.

Worker then authored a different repair at exact commit:

`53d226a4c022b0093873d1dbe7b411d3ba5817cb`

That repair is materially better and is accepted as the **current technical candidate**:

- it removes the vulnerable `git show <sha>:<long-path>` object-read construction;
- it resolves the ruling blob with `git ls-tree <sha> -- <path>`;
- it reads the resolved object by `git cat-file blob <object-id>`;
- it applies the same repair to both measured vulnerable call sites:
  - `control-plane-seat-hook.mjs::verifyAuthorityIndependently`;
  - `bootstrap.mjs::measureState`.

Worker reports the preserved CPB-0010 replay now reaches the actual authority/identity logic, arms on the unmodified historical main case, and the three negative controls discriminate as:

- altered branch -> `identity_mismatch_branch`;
- altered bootstrap bundle -> `manifest_bundle_mismatch`;
- altered authorization id -> `manifest_authorization_mismatch`.

That is consistent with `F1_STATIC_PASS` **as worker-produced development evidence**.

It is **not yet independent certification**.

No Guard-V2 promotion is authorized by this ruling. No fresh control-plane bootstrap execution marker is issued here.

---

## 1. AR-1370 — PASS / GPT CANDIDATE RETIRED

GPT independently inspected AR-1370 commit:

`98c4b2598ffb5a84a713812e7d821e85941b4e2c`

The report-only commit stayed inside the AR-1364A scratch-grade scope.

The measured result is accepted:

- pre-patch long-path authority read: RED, `Filename too long`;
- post-GPT-patch long-path authority read: still RED, same failure;
- short-path control: GREEN before and after;
- existing bounded suite: 172/172 before and after;
- CPB-0010 main replay: still pre-empted by `RUNTIME_EXCEPTION`;
- all three required negatives: still pre-empted by that same unrelated exception;
- legal classification: `F3_INDETERMINATE`.

Therefore GPT's engineering candidate at `external-advisor/gpt-cpb-path-repair-ar1364a` / `9e4953bf3500615773396b5d8cd2f0a3e5b3f415` is **not a production fix** and must not be resurrected as one.

Its value is now as a durable negative engineering lesson: moving repository selection from `git -C` argv into child-process `cwd` does not change Git's effective working directory and therefore does not remove the measured combined path-length boundary.

---

## 2. AR-1371 — ACTUAL CODE INSPECTION

GPT inspected the exact Worker HEAD and actual diff, not report prose alone.

The current production candidate in `control-plane-seat-hook.mjs::verifyAuthorityIndependently` now performs:

1. newest authority head discovery;
2. strict one-ruling-file discovery;
3. `ls-tree` resolution of that exact ruling path at the exact authority head;
4. a strict `blob` object-id parse;
5. explicit fail-closed `authority_object_unresolvable` if the blob cannot be resolved;
6. `cat-file blob <40-hex-object-id>` to read the ruling bytes;
7. existing downstream marker/identity/claim/bundle/receipt checks unchanged.

This is structurally stronger than the rejected GPT candidate because the long ruling filename is no longer embedded in a revision/path argument such as `<sha>:<path>`.

GPT also confirmed Worker found and repaired a second structurally identical occurrence in `bootstrap.mjs::measureState` rather than leaving the plan/execute preflight path vulnerable.

The change is narrow: from the prior ruled Worker SHA `0f454465af154fbff42dea5fb3b8b2ea9f638890` to current HEAD there are only two commits, consisting of AR-1370, AR-1371, the two bootstrap source files, and the bounded bootstrap test file.

---

## 3. WHY THIS IS NOT YET A FULL PASS

### 3.1 Worker authored and graded the protected repair

AR-1371 changed load-bearing protected bootstrap code and then used Worker-run replay to label the result `F1_STATIC_PASS`.

That replay is useful development evidence, but the V2 operating model does not allow authored load-bearing work to become authoritative merely because the author also demonstrated it.

For a Claude-authored protected repair, GPT may provide the independent grade — but GPT must have a durable adversarial test shape that can distinguish the repaired implementation from the exact old vulnerable implementation.

That proof is incomplete at current HEAD.

### 3.2 The claimed operator override is not accepted as an explicit supersession

AR-1371 says the in-chat phrase `FIND A WAY TO FIX IRE` / `find a way to fix it` **explicitly superseded** AR-1364A's no-protected-integration instruction.

That characterization is too strong.

A general instruction to find/fix the defect is not, by itself, an explicit authorization to bypass a named protected-surface lock. The recovered operator context also contained an earlier explicit refusal to hand-edit the self-protected control-plane/bootstrap path and kept AR-1364A controlling until the path-repair grade returned.

Therefore GPT does **not** ratify the report's statement that the safety lock was explicitly superseded.

The code already committed is not deleted merely to make a governance point. It is treated as an **untrusted candidate on the Worker branch** and graded on its merits. No further protected edit is authorized until this ruling says so.

### 3.3 Permanent regression coverage is not sharp enough

Worker updated the existing mocks so the 172-test suite understands `ls-tree` + `cat-file blob`.

However the current `C8c` authority mock still contains a permissive legacy fallback:

`if (k.startsWith('show ')) return ...rulingText...`

That means the test fixture can still satisfy the old vulnerable `git show <sha>:<path>` implementation if that line is reintroduced.

So the permanent suite is not yet a mutation-proof regression for the exact defect just repaired.

The current 172/172 result proves broad neighboring behavior stayed green. It does **not** yet prove that a future regression back to the old combined revision/path read will be caught.

### 3.4 CI status

GitHub reports no combined status checks and no workflow runs for exact Worker HEAD `53d226a4c022b0093873d1dbe7b411d3ba5817cb`.

**CI: NONE; the reported 172/172 result is local-only evidence.**

Do not relabel it CI GREEN.

---

## 4. WORKER 1 — AUTHORIZED TEST-ONLY CLOSEOUT

Worker 1 may now make **one test-only closeout commit** on `claude/worker1-h1-20260815`.

Authorized mutable paths:

- `scripts/control_plane_bootstrap.test.mjs`
- one new Worker report under `docs/replay-results/worker-advisor-reports/`

Not authorized in this closeout:

- any further change under `scripts/control-plane-bootstrap/**`;
- `.claude/worker1-hook-guard-manifest.json`;
- `scripts/claude_toolbox.mjs`;
- any preserved CPB-0009/0010 forensic worktree;
- any claim/receipt;
- any Guard-V2 promotion;
- any new bootstrap authorization execution.

If the current production candidate requires another source change to satisfy the new tests, STOP and report it. Do not widen the patch.

---

## 5. REQUIRED DURABLE REGRESSION CONTROLS

Add the smallest deterministic tests that permanently encode the defect boundary.

### T1 — seat authority read call-shape guard

Exercise `verifyAuthorityIndependently` with an instrumented fake IO that:

- allows the existing `show --name-only --pretty=format: <authorityHead>` discovery call;
- **throws immediately** if any other `git show` call contains a revision/path shape such as `<sha>:<path>`;
- records the object-read calls;
- requires `ls-tree <authorityHead> -- <exact-ruling-path>`;
- requires exactly one `cat-file blob <40-hex-object-id>` after successful resolution;
- proves the authority path still reaches the existing positive verified result.

The test must fail if production is mutated back to the old `io.git('show', \`${authorityHead}:${changed[0]}\`)` line.

### T2 — bootstrap measureState call-shape guard

Exercise `bootstrap.mjs::measureState` through an instrumented fake IO with the same rule:

- discovery `show --name-only` remains allowed;
- any object read through `show <sha>:<path>` throws;
- the ruling bytes must instead flow through `ls-tree` -> `cat-file blob`;
- the measured ruling id/text/marker path must remain correct.

Again, mutating the production object read back to the old shape must make this test RED.

### T3 — unresolved object fails closed

For `verifyAuthorityIndependently`, return a valid single ruling filename from discovery but return no resolvable blob from `ls-tree`.

Required result:

- `ok === false`;
- code `authority_object_unresolvable`;
- no armed receipt;
- no `cat-file blob` call after failed resolution.

### Mutation proof

In disposable scratch only:

1. run the new tests against current `53d226...` source -> GREEN;
2. mutate at least the seat object read back to the exact old `git show <sha>:<path>` shape -> at least T1 must RED for the intended forbidden-call reason;
3. restore current source -> GREEN again.

Prefer also mutating the `measureState` read to the old shape and proving T2 RED.

The point is not test count. The point is proving the new tests would have caught the exact old defect.

---

## 6. REQUIRED TEST / REPORT EVIDENCE

Run and report:

`node --test scripts/control_plane_bootstrap.test.mjs`

Required evidence:

- exact new Worker HEAD;
- exact changed-file set proving source bootstrap files did not change after `53d226...`;
- final test count/pass/fail;
- T1/T2/T3 names and outcomes;
- mutation RED output/reason for the old `show <sha>:<path>` shape;
- restored GREEN output;
- confirmation that CPB-0009 and CPB-0010 remain untouched/spent;
- confirmation no Agent/Task/model execution was used for the mechanical replay/mutation proof;
- GitHub CI/status separately from local tests.

Suggested report name:

`AR-1372-WORKER1-AR1365A-CPB-PATH-REGRESSION-CLOSEOUT-2026-08-19.md`

---

## 7. WHAT HAPPENS AFTER AR-1372

If the test-only closeout is green and GPT independently confirms:

- no protected source changed after `53d226...`;
- the new tests truly kill the old vulnerable object-read shape;
- current candidate remains fail closed;
- the worker report matches repository evidence;

then GPT may upgrade the AR-1371 candidate to a technical PASS and decide the next Guard-V2/bootstrap step.

Any future bootstrap authorization must bind the **new** bootstrap bundle hash created by the AR-1371 source changes. Old bundle-bound markers remain stale and must fail closed. Spent CPB authorization IDs remain spent.

Do not reuse CPB-0009 or CPB-0010.

---

## 8. FACTORY / MONEY-PATH STATE

Unchanged from AR-1364A except for this control-plane candidate status.

- Stage 3 Strategy Factory remains the active architecture stage.
- Step 12 remains CLOSED.
- The frozen 40-strategy Factory result remains a verdict on legacy extracted representations, not on teacher source strategies.
- Gemma retains zero load-bearing semantic authority in the new intake path.
- Permanent semantic chain remains transcript -> Opus lead reader -> literal verification -> GPT-5.6 Sol semantic audit -> independent Claude attack -> deterministic certifier -> deterministic compiler -> SOURCE_FAITHFUL backtest.
- Future broad semantic intake remains HOLD until the trusted intake path is proven and the actual source list is supplied.
- No certifier weakening.
- No broad Factory rerun.
- No PAPER/live shortcut.

---

## FINAL RULING

**Worker did two useful things: AR-1370 correctly killed GPT's bad cwd-based repair, and AR-1371 found a materially stronger object-read repair by removing `sha:path` entirely at both vulnerable call sites. The current code at `53d226a4...` is accepted as the leading technical candidate, but it is not certified yet. Worker authored and replay-graded its own protected change, the claimed generic operator instruction is not accepted as an explicit override of AR-1364A's protected-edit lock, and the permanent mocks still tolerate the old vulnerable `git show <sha>:<path>` shape. Worker is authorized for one test-only closeout that makes the old shape deterministically RED and the current `ls-tree` -> `cat-file blob` shape GREEN. Until that lands and GPT independently verifies it: Guard-V2 promotion remains HOLD, no bootstrap execution marker is issued, and no further protected source edit is authorized.**
