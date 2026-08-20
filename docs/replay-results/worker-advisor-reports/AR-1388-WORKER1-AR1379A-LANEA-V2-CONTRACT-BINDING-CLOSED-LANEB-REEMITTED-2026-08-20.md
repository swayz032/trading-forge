# AR-1388 -- AR-1379A Lane A CLOSED (repair + independent grade + all 6 grade-driven fixes), Lane B step 1-2 done: V2 E8 task re-emitted

RULING : AR-1379A (`origin/external-advisor/gpt-rulings` @ `06d4bf0d9ef23d158a03a82bf884048ab3813b0e`, file `advisor-reports/AR-1379A-GPT-EXTERNAL-ADVISOR-RULING-AR1385-AR1387-PASS-WITH-CONTRACT-BINDING-BLOCKER-REEMIT-E8-ROUND3-2026-08-20.md`).

PIN : branch `claude/worker1-h1-20260815`, HEAD `4cae6c15` (SYSTEM-INVENTORY regen on top of the three work commits below).

## Cold-start note: the ruling was missed on first pass

This session's onboarding initially concluded "nothing new has landed from GPT" after checking `origin/external-advisor/gpt-engineering` and a `sort -t- -k2 -n` scan of `origin/external-advisor/gpt-rulings` that put AR-1379A's file out of visible range. The operator corrected this mid-turn ("GPT DIC RULE ALREAADY"). Re-checking `git log -1` on every `external-advisor/*` branch by commit date (not filename sort) found `gpt-rulings` @ `06d4bf0d`, dated 2026-08-20 17:45 -0400, containing AR-1379A. Lesson: date-sort branch heads directly, don't filename-sort files inside them.

## Work completed

### Lane A -- V2 semantic-contract identity binding (`81abf5cb`)

Added `build_task_v2`/`render_prompt_v2`/`_validate_response_v2`/`emit_v2`/`ingest_v2` to `scripts/strategy_factory_gpt56_semantic_audit.py`, binding `semantic_contract_id`/`semantic_contract_sha256 = sha256(ROLE_ASSIGNMENT_CONTRACT)` into the object hashed into `task_sha256`, per AR-1379A section 2. `render_prompt_v2` fails closed if the task's bound contract hash no longer matches the live contract; `ingest_v2` requires the response to echo the exact id/hash. New schema identities (`tf-gpt56-semantic-audit-{task,response,receipt}-v2`) and CLI subcommands (`emit-v2`/`ingest-v2`). **V1 `build_task`/`render_prompt`/`_validate_response`/`emit`/`ingest` are byte-for-byte untouched** -- verified via `git diff --numstat` (416 insertions, 0 deletions vs pre-repair HEAD `6deba50e`, both hunks pure-insert) and independently confirmed by the grader below via a second instrument (line-range SHA-256).

All 8 of AR-1379A section 5's required repair-proof points demonstrated in `scripts/_gpt_strategy_factory_gpt56_semantic_audit_ar1379a_v2_contract_binding_proof.py`. The 3 pre-existing V1 regression proofs (`_ar1378a_repair_proof`, `_proof`, `_grader_response_proof`) rerun unmodified, all still pass.

### Independent grade (self-dispatched, pre-authorized per CLAUDE.md 0-CTRL.2 -- "Independent grader/attack is required because this changes load-bearing audit identity")

Dispatched `accuracy-validator` with a DISPROVE mandate against pinned commit `81abf5cb`, no restrictions, told to find novel attacks beyond my own controls. Full durable receipt: `docs/replay-results/worker-advisor-reports/GRADE-AR1379A-V2-CONTRACT-BINDING-2026-08-20.md`.

**Verdict: PASS WITH FINDINGS, band 7 VERIFIED.** All 6 of my claims confirmed true via two non-overlapping paths each. 27 adversarial cases run; cross-schema confusion, hash-normalization laxity, task-file tamper (even resealed), and the strict PASS law all held. Four real findings, none CRITICAL, none blocking:

- **F-A** (MEDIUM): `semantic_contract_id` bound into `task_sha256` but never validated against the live `SEMANTIC_CONTRACT_ID` constant -- only the hash was re-checked. A hash-correct, resealed, but relabelled task was ACCEPTED.
- **F-B** (MEDIUM): the delivered prompt BYTES were never bound into the receipt. Stripping the entire `ROLE_ASSIGNMENT_CONTRACT` block from the emitted `prompt.txt` after task emission still ingested to PASS -- the ruling's own three literal requirements were all met, but the "was the contract actually delivered" seam (which the ruling itself flagged as open re: `index.json`) stayed open.
- **F-C** (MEDIUM): `emit_v2` shared V1's exact filenames with no exists-guard, silently truncating a same-named V1 task/prompt -- a real risk against AR-1379A section 2's explicit "Preserve historical V1 evidence" clause, and directly load-bearing since Lane B's next step re-emits into the same E8 directory tree.
- **F-D** (MEDIUM, proof-quality only): the proof's own "V1 untouched" check compared an already-imported module against itself via `importlib.reload` -- structurally unable to go red even if V1 had been rewritten. The underlying claim was still true (grader proved it independently via git).
- **F-E/F-F** (LOW hygiene): `_validate_response_v2` used bare subscripting (KeyError instead of the harness's SystemExit idiom) and a non-bool-strict `!=` comparison (JSON `0` satisfied a `false` requirement).

Grader's own recommendation: "Lane A may proceed to Lane B" + close F-A through F-F in the same wave per SS11c.

### Grade-driven fixes, same wave (`4fe66630`)

Closed all six. F-A/F-C are entirely inside the new V2 code (no V1 touch); F-E/F-F are inside `_validate_response_v2` (new V2 code); F-B added a prompt re-render + hash-compare inside `ingest_v2`, now recording `prompt_sha256` in the V2 receipt (closes the delivery half of F-1 the ruling itself named as open); F-D replaced the vacuous proof check with a real `git show <base>:<path>` + AST comparison. Each fix red-proven using the grader's own attack methodology (hash-correct+resealed mislabel for F-A, prompt-strip for F-B, cross-schema out-dir clobber for F-C, direct calls with a deleted key / int-zero for F-E/F-F). All 3 pre-existing V1 regressions rerun again, still pass. V1 region confirmed still a pure addition vs `6deba50e` after this second commit too.

**Not re-dispatching a second independent grader for these fixes.** Each directly implements the grader's own prescribed fix point and location; each is red-proven with the grader's exact repro. Judged disproportionate per CLAUDE.md 0-CTRL.5 ("no checker-for-a-checker unless GPT explicitly requires it"). Flagged here plainly so GPT can override if it disagrees with that judgment call.

### Lane B steps 1-2 (`b2f8bc76`)

E8 candidate `b50729b928e51980088f2e4a73c30771eb3665147443753edcc8be44d5fb0041` kept frozen unchanged -- no new Opus reconstruction. New script `scripts/_worker_emit_gpt56_round3_e8_task_v2.py` hard-refuses if the live candidate bytes ever drift from that exact sha256, then re-emits a V2 task with a fresh nonce into a **new** directory (`gpt56-semantic-tasks-round3-v2/E8Wg6tFPYjo/`), not the V1 directory -- confirmed via `git diff --stat` on the V1 directory returning empty (zero touch).

Result: `task_sha256=1b524bd6500238057e2bfa6d835b9dcaf37e8c00d93dd4b9039932cb41786380`, `semantic_contract_id=AR-1378A-SS6-ROLE-ASSIGNMENT-CONTRACT-V1`, `semantic_contract_sha256=79b0d960fe9f40d3c93a3f573a32a994a4afbae696dd831b41a11d1aaae4a9de`, 73 claims, 1 strategy -- same claim/strategy count as the V1 task, confirming the re-emit did not alter the candidate's claim enumeration.

## AGENT-LOGS.md SS10b friction (disclosed, not bypassed)

CLAUDE.md SS10b hard-requires a session-log entry in `AGENT-LOGS.md` before ending a session. This packet's guard manifest (`.claude/worker1-hook-guard-manifest.json`) `edit_scope.allowed_prefixes` is `["src/engine/extraction/", "src/engine/tests/", "scripts/", "docs/replay-results/", ".claude/"]` plus the exact path `docs/designs/SYSTEM-INVENTORY.md` -- repo-root `AGENT-LOGS.md` is not covered, and the guard rejected the edit (`authorized edit scope rejected: AGENT-LOGS.md`). I did not attempt to bypass the guard (no `--no-verify`, no manifest edit -- `.claude/` self-protection would deny that too per the manifest's own stated design). Per 0-CTRL.3 the durable channel is `docs/replay-results/` regardless, which this report satisfies, but the SS10b entry itself is not written this session. Flagging for GPT/operator: either widen this packet's `edit_scope` to include repo-root docs (`AGENT-LOGS.md`, `CLAUDE.md`) if that's intended for worker-1's lane, or confirm this report satisfies SS10b's intent going forward for packets under this manifest.

## Verification

- `python scripts/_gpt_strategy_factory_gpt56_semantic_audit_ar1379a_v2_contract_binding_proof.py` -- exit 0, all 8 ruling-required points + all 6 grade-driven-fix points PASS.
- `python scripts/_gpt_strategy_factory_gpt56_semantic_audit_ar1378a_repair_proof.py` / `_proof.py` / `_grader_response_proof.py` -- exit 0, unmodified, both before and after the grade-driven fixes.
- `python scripts/_worker_emit_gpt56_round3_e8_task_v2.py` -- exit 0, freshness + frozen-candidate-sha256 checks both green.
- `git diff --numstat 6deba50e -- scripts/strategy_factory_gpt56_semantic_audit.py` -- 416/0 (pure addition) after both Lane A commits.
- `git diff --stat` on the V1 E8 round-3 directory -- empty, after Lane B's re-emit.
- Independent grade: `docs/replay-results/worker-advisor-reports/GRADE-AR1379A-V2-CONTRACT-BINDING-2026-08-20.md`, band 7 VERIFIED.

FINDINGS: none against prior sessions' work. AGENT-LOGS.md SS10b gap disclosed above.

STOP : Lane B steps 3-6 (hand the V2 task/prompt identity to the GPT-5.6 Sol seat, ingest its response, mandatory independent Claude challenge) are external to this session -- same dependency shape as AR-1382/AR-1387. This is not a permission-wait; it's a dependency on an external actor this session cannot invoke directly.

NEXT : on GPT-5.6's V2 round-3 audit response landing (task identity above), ingest via `python scripts/strategy_factory_gpt56_semantic_audit.py ingest-v2 --video-id E8Wg6tFPYjo --transcript src/engine/extraction/fixtures/source-evidence/E8Wg6tFPYjo.transcript.txt --candidate docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-3-fresh-opus/E8Wg6tFPYjo/fresh_source_candidate.json --out-dir docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/gpt56-semantic-tasks-round3-v2/E8Wg6tFPYjo --raw-response <path>`, then mandatory independent Claude challenge on the result (AR-1383/AR-1384 practice), then report. GPT should also rule on: (1) the AGENT-LOGS.md edit_scope gap above; (2) whether F-G/F-H (LOW, inherited-from-V1 schema laxities -- non-strict `coverage_statement`, `sha256_text` crash on lone Unicode surrogates) warrant a follow-up packet or are accepted residual V1 laxity, left unfixed this wave as out-of-scope for "one bounded contract-binding repair."
