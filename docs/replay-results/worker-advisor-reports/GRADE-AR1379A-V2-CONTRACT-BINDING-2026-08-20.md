# INDEPENDENT GRADE — AR-1379A Lane A, V2 semantic-contract identity binding

**Grader:** Claude accuracy-validator (independent; did NOT author, design, or previously grade this code)
**Date:** 2026-08-20
**Doer:** Worker-1
**Graded commit:** `81abf5cb` on `claude/worker1-h1-20260815`
**Graded blobs (the exact bytes this verdict describes):**
- `scripts/strategy_factory_gpt56_semantic_audit.py` → blob `a81b05530a8ab861ba4333c1dc9992ca1dcc5cde`
- `scripts/_gpt_strategy_factory_gpt56_semantic_audit_ar1379a_v2_contract_binding_proof.py` → blob `bd35c8e07d070675912483504b130e2839ac0987`

**Branch HEAD at grade time:** `d9a97e77ad02db603234f88d66071eeaa31a6724` (one `SYSTEM-INVENTORY: regenerate` commit above `81abf5cb`). MEASURED HERE: the harness blob at HEAD is byte-identical to the blob at `81abf5cb` (`git rev-parse HEAD:<path>` == `git rev-parse 81abf5cb:<path>`), and the working tree is clean — so the on-disk file I executed IS the graded artifact.

**Authority graded against:** `origin/external-advisor/gpt-rulings:advisor-reports/AR-1379A-...-2026-08-20.md`, §2 (authorized repair) and §5 (the 8 required repair-proof points).

**Environment:** Python 3.13.0, Windows 11.

---

## VERDICT

# PASS WITH FINDINGS

The AR-1379A §2 repair is **real, correctly scoped, and does what the ruling required.** All 8 of §5's required proof points are genuinely demonstrated, and the load-bearing ones survived my independent attacks. V1 is byte-for-byte untouched — verified via git, not via Worker-1's own assertion.

**Four findings, none CRITICAL, none blocking the Lane B re-emit.** Two are novel gaps inside the new V2 identity surface itself (F-A, F-B), one is an operational evidence-destruction hazard against the ruling's own preservation clause (F-C), one is a proof-quality defect: the proof's structural point 0 is a check that can never go red (F-D).

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| AR-1379A V2 semantic-contract identity binding @ `81abf5cb` / blob `a81b0553` | **7** | **VERIFIED** | Git byte-diff of V1 region + 4/4 proof scripts run to exit 0 by me + 27 independent adversarial cases executed against the live V2 path (§Attacks) | F-A `semantic_contract_id` never validated against the live constant; F-B delivered prompt bytes not bound into the receipt; F-C `emit-v2` silently overwrites V1 evidence; F-D proof point 0 is vacuous; LOW-tier inherited V1 laxity (F-E…F-H) |

**Why 7 and not 8:** the repair is adversarially tested with residual risks documented (7–8 band), but two of the residual risks sit *inside the very identity surface being repaired* — a receipt can carry a false human-readable contract label (F-A) and asserts a contract binding it never checked against the bytes actually delivered (F-B). Band 8 would need those closed. **Band 9+ is not available** here: this harness makes no claim about model cognition and no live-behavioral test has run.

**Claimed vs verified:** Worker-1 made no numeric band claim, so no >1-band reconciliation is owed. Every factual sub-claim in the dispatch brief (items 1–6) is confirmed as stated — see §Claim-by-claim.

---

## Claim-by-claim verification

| # | Worker-1 claim | Verdict | How verified (two non-overlapping paths) |
|---|---|---|---|
| 1 | `semantic_contract_id` + `semantic_contract_sha256` inside the object hashed into `task_sha256` | **TRUE** | (a) read the executable lines `:603-606`; (b) ran `build_task_v2` with nonce/candidate/transcript pinned and a mutated contract — `task_sha256` changed |
| 2 | `render_prompt_v2` raises SystemExit on contract-hash mismatch | **TRUE** | (a) read `:610-618`; (b) called it directly with a tampered task → refused |
| 3 | `_validate_response_v2`/`ingest_v2` require exact echo of id + hash | **TRUE** | (a) read `:742-757`; (b) 4 independent mutations (uppercased hash, trailing space, leading newline, lowercased id) → all refused |
| 4 | V2 receipt records the same contract id/hash | **TRUE** | (a) read `:900-901`; (b) executed a clean `ingest_v2` and read the emitted receipt JSON |
| 5 | V1 `build_task`/`render_prompt`/`_validate_response`/`emit`/`ingest` byte-for-byte untouched | **TRUE** | (a) `git diff --numstat 6deba50e..81abf5cb` = **374 insertions / 0 deletions**, 2 hunk headers, both `@@ -N,0 +…`; (b) SHA-256 of lines 1–556 of both file versions = `19F91D36C7CAC5D589A67B1ADFBB7B646AD74573F9179B70AEA05EEF5D04B5D8` in **both** |
| 6 | New proof passes all 8 points; 3 pre-existing V1 proofs still pass unmodified | **TRUE** | (a) I ran all four myself, all `EXIT=0`; (b) `git diff --numstat` over the 3 V1 proof paths returns **empty** — they were not touched by `81abf5cb` |

**Precision note on claim 5 (not a defect, a scoping correction):** `parser()` *was* modified — 15 lines inserted to register `emit-v2`/`ingest-v2` (`:934-947`). The insertion is additive and leaves the V1 `emit`/`ingest` subparser definitions byte-identical, so V1 CLI behaviour is unchanged. Worker-1's claim named only the five functions and is accurate as written; a reader should not generalize it to "the whole V1 CLI surface is an unchanged blob."

---

## Attacks executed (27 cases). What HELD:

All MEASURED HERE via a purpose-built adversarial driver run against the live `81abf5cb` module.

**Cross-schema confusion / replay — CLOSED (3/3 refused):**
- V1 task + V1 response → `ingest_v2` → `semantic audit task identity/schema mismatch (expected V2)`
- V2 task + V2 response → V1 `ingest` → `semantic audit task identity/schema mismatch`
- V2 task + V1-shaped response (contract fields stripped) → `ingest_v2` → `audit response schema mismatch`

**Hash-string normalization laxity — CLOSED (4/4 refused).** Comparison is exact, case-sensitive Python `!=` on the hexdigest:
- response hash UPPERCASED → refused · trailing space → refused · leading newline → refused · id lowercased → refused

**Task-file contract tamper — CLOSED (2/2 refused).** This is the operationally load-bearing guard, `ingest_v2:867`:
- `semantic_contract_sha256` hand-edited, `task_sha256` left stale → refused
- `semantic_contract_sha256` hand-edited **and `task_sha256` resealed consistently** → still refused (the live-hash check catches what the recompute cannot)

**`canonical_json` stability — no instability, no collision found:**
- key-order independent (`sort_keys=True`); deterministic across `PYTHONHASHSEED` 0 / 1 / 12345 (identical `task_sha256` `8c4f59f273a8…` all three runs, nonce pinned)
- NFC vs NFD of the same grapheme → **different** hashes (conservative direction; no normalization is applied, so two byte-different strings never collide)
- `1` vs `1.0` → `{"k":1}` vs `{"k":1.0}`, distinct
- duplicate JSON key in task.json → last-wins on parse; the receipt recorded the **real** id, no exploit
- `NaN` round-trips stably through `canonical_json`
- lone surrogate (`\ud800`) → `UnicodeEncodeError` at `sha256_text` — fails closed by crash (see F-G)

**Strict PASS law under V2 — HELD (3/3 refused), and correctly non-blocking (2/2 accepted):**
- strategy classified `uncertain` + verdict PASS → refused · one cross-field `UNRESOLVED` + PASS → refused · one `HIGH` finding + PASS → refused
- one `MEDIUM` finding → PASS (correct: ruling point 8 blocks only HIGH/CRITICAL) · one `LOW` finding → PASS (correct)

**Positive-control witnesses for the absence claims above:** every "refused" line above is itself a path-to-red demonstration, and the *complementary* GREEN was executed in the same driver — a fully clean V2 response ingested to `GPT56_SEMANTIC_AUDIT_PASS_NOT_INDEPENDENTLY_CERTIFIED` with `fail_closed_reasons: []`. Both halves ran; the harness is not stuck-red or stuck-green.

**Corroboration of the F-1 defect itself, via a second path:** the ruling asserts the emitted V1 E8 round-3 task is unbound. I did not take that on testimony — I read the tracked artifact `docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/gpt56-semantic-tasks-round3/E8Wg6tFPYjo/gpt56_semantic_audit_task.json` and independently recomputed it: `schema=tf-gpt56-semantic-audit-task-v1`, `task_sha256=d5117ba229c03d15d711db49640d0e7b52ac7ea0eee6b3d53124650fc6a833c9` (matches the ruling verbatim), `candidate_sha256=b50729b928e51980088f2e4a73c30771eb3665147443753edcc8be44d5fb0041` (matches the frozen candidate), 73 claims, `semantic_contract_sha256` **absent**, recompute of the task core **consistent**. The defect and the frozen inputs are real, not relayed. No round-3 receipt exists in git — consistent with the ruling's DO-NOT-AUDIT hold.

---

## FINDINGS

### F-A — `semantic_contract_id` is bound but never validated against the live constant
**Severity:** MEDIUM (schema drift / caption integrity — the receipt can carry a false contract label with a true hash)
**Claim:** "The V2 receipt records the same contract id/hash", creating the deterministic join `candidate + transcript + semantic contract → task_sha256 → response identity → receipt`.
**Reality:** MEASURED HERE. `ingest_v2` re-checks `semantic_contract_sha256` against the live `ROLE_ASSIGNMENT_CONTRACT` (`:867`) but **never checks `semantic_contract_id` against the live `SEMANTIC_CONTRACT_ID` constant** — not at `:867`, not in `render_prompt_v2:612`. I relabelled a task.json's `semantic_contract_id` to `"AR-9999-TOTALLY-DIFFERENT-CONTRACT"`, resealed `task_sha256`, and re-signed the response. `ingest_v2` **ACCEPTED** it and emitted:
`receipt semantic_contract_id='AR-9999-TOTALLY-DIFFERENT-CONTRACT'  status=GPT56_SEMANTIC_AUDIT_PASS_NOT_INDEPENDENTLY_CERTIFIED`
while the live constant is `'AR-1378A-SS6-ROLE-ASSIGNMENT-CONTRACT-V1'`.
**Sources compared:** [live constant `:574`: `AR-1378A-SS6-…-V1` | on-disk task: `AR-9999-…` | emitted receipt: `AR-9999-…`]
**Source of truth:** the module constant `SEMANTIC_CONTRACT_ID`. The `sha256` remains the correct cryptographic anchor and is enforced — so a reader who *verifies the hash* is safe; a reader who *trusts the human-readable label* is not. That is exactly the "a caption is a claim" failure mode, on the field a human will actually read in the receipt.
**Fix point:** `scripts/strategy_factory_gpt56_semantic_audit.py:867` — extend the guard to `or task.get("semantic_contract_id") != SEMANTIC_CONTRACT_ID`; mirror in `render_prompt_v2:612`.
**Repro:** load a V2 task.json, set `semantic_contract_id` to any string, recompute `task_sha256 = sha256_text(canonical_json(core_without_task_sha256))`, echo the same id in the response, run `ingest-v2`.
**Blast radius:** any downstream reader of `gpt56_semantic_audit_receipt.json` that keys on the id string rather than the hash — advisor rulings, AGENT-LOGS entries, and the Lane B hand-back to the GPT-5.6 Sol seat.

### F-B — the DELIVERED prompt bytes are not bound into the receipt (residual half of F-1)
**Severity:** MEDIUM (provenance gap — receipt asserts a binding it never checked against the artifact actually sent)
**Claim:** the V2 chain proves which contract version governed a given audit.
**Reality:** MEASURED HERE. `ingest_v2` never reads `gpt56_semantic_audit_prompt.txt`. I emitted a clean V2 task, then **deleted the entire `ROLE_ASSIGNMENT_CONTRACT` block from the emitted prompt file** (prompt sha `cfc9ab72…` → `2c63cba8…`, contract text confirmed absent), then ran `ingest_v2`. It **ACCEPTED**, issuing `PASS_STATUS` with `semantic_contract_sha256=79b0d960fe9f40d3…`. The receipt's 16 keys contain **no** `prompt_sha256` and no prompt reference of any kind.
**Sources compared:** [receipt: "bound to contract 79b0d960…" | prompt.txt actually deliverable to the auditor: contains no contract at all]
**Source of truth:** the prompt file — it is the artifact the model consumes.
**Ruling status — read this carefully:** AR-1379A §2 required only that (i) the contract hash live inside `task_sha256`, (ii) `render_prompt()` fail closed on mismatch, and (iii) the BOUND IDENTITY section display id/hash. **All three are satisfied.** So this is *not* a spec failure and does not block Lane B. But it is the honest residual: V2 proves *the task was bound to contract X*, not *the bytes handed to GPT contained contract X*. The ruling itself flagged the adjacent seam ("the external `index.json` records a prompt-file SHA, but that is not an ingest-enforced join key"); V2 closed the task-identity half and left the delivery half open.
**Fix point:** `ingest_v2` (`:861-887`) already holds `task`, `transcript`, and `candidate_raw` — the prompt is a pure function of those three. Add: re-render `render_prompt_v2(task, transcript, candidate_raw.decode("utf-8"))`, compare `sha256_text` against the on-disk prompt file, and record `prompt_sha256` in the receipt. Roughly 5 lines; converts the index.json prompt hash into an ingest-enforced join key.
**Repro:** `emit-v2`, strip the contract block from `gpt56_semantic_audit_prompt.txt`, run `ingest-v2`, observe PASS.
**Blast radius:** every V2 receipt. Under §11c (zero carry-forwards) this should close in the same wave.

### F-C — `emit-v2` silently destroys pre-existing V1 evidence in the same out-dir
**Severity:** MEDIUM (operational; violates AR-1379A §2 "Preserve historical V1 evidence")
**Claim:** "Historical V1 tasks/responses/receipts remain readable and valid exactly as before" (harness comment `:569-570`).
**Reality:** MEASURED HERE. `emit_v2` writes the **same filenames** as `emit` — `gpt56_semantic_audit_task.json` and `gpt56_semantic_audit_prompt.txt` — with no exists-guard (`write_json`/`write_text` open `"w"`, truncating). Running `emit` then `emit-v2` on the same `--out-dir`:
`V1 task.json PRESERVED? False` · `V1 prompt.txt PRESERVED? False` · `schema now on disk: tf-gpt56-semantic-audit-task-v2`
The ruling states: *"Do not rewrite Round-1/Round-2/V1 tasks or receipts. They remain historical evidence under their exact frozen hashes."* Lane B's very next step is *"re-emit a V2 GPT-5.6 task ... from that exact candidate/transcript"* — if `--out-dir` is pointed at the existing round-3 directory, the frozen V1 task `d5117ba2…` the ruling names as historical evidence is destroyed in place.
**Mitigation that already exists (why this is MEDIUM, not HIGH):** those artifacts are **git-tracked** (verified: round-1, round-2, and round-3 task/prompt files are all in `git ls-files`), so an overwrite is visible in `git status` and recoverable. The residual risk is a `git add -A` under §11a's commit-and-push discipline silently committing the destruction.
**Fix point:** `emit_v2` (`:715-726`) — refuse if `out_dir/gpt56_semantic_audit_task.json` exists with `schema != TASK_SCHEMA_V2`, or write V2 under distinct filenames.
**Repro:** run `emit` then `emit-v2` with identical `--out-dir`; diff the task file before/after.
**Blast radius:** the frozen E8 round-3 V1 evidence; any future re-emit into an existing directory.

### F-D — proof point 0 ("V1 code paths byte-identical") is a check that can never fail
**Severity:** MEDIUM (proof quality; the underlying claim is nonetheless TRUE)
**Claim:** proof docstring line 12 — *"0. V1 code paths byte-identical (no accidental reinterpretation of V1 as V2)"*; printed as *"V1 build_task/render_prompt/_validate_response/emit/ingest are present unmodified"*.
**Reality:** MEASURED HERE. The proof does `fresh = importlib.import_module("strategy_factory_gpt56_semantic_audit")` — which returns the **module object already in `sys.modules`**, i.e. `G` itself. I measured `G is fresh` → **True**, and still **True** after `importlib.reload(fresh)` (reload mutates in place). The assertion `inspect.getsource(getattr(G, name)) == inspect.getsource(getattr(fresh, name))` is therefore literally `x == x`, and both sides read the same file via the same `getsourcefile`. **It would pass identically if every V1 function had been rewritten.** There is no comparison against any pre-commit version.
**Source of truth:** git. **The claim itself is TRUE** and I proved it independently: `git diff --numstat 6deba50e..81abf5cb` = 374 insertions / **0 deletions**; both hunks are pure-insert (`@@ -556,0 +557,359 @@`, `@@ -573,0 +933,15 @@`); SHA-256 of lines 1–556 is `19F91D36…B5D8` in **both** the pre- and post-commit file.
**Fix point:** replace point 0 with a real second path, e.g. assert against `git show <base>:<path>` bytes, or hash a pinned copy of the V1 region.
**Two smaller tautologies in the same script:** line 230 `assert v1_task["task_sha256"] == sha_before` compares a dict value to a variable copied from it moments earlier; line 232 `assert "task_sha256" not in v1_prompt_after or v1_task["task_sha256"] == sha_before` has an always-true right disjunct. Both are decorative. The load-bearing assertion of point 1 — `v1_prompt_before != v1_prompt_after` — **is** real and did the work.
**Blast radius:** proof-script credibility only; no runtime effect.

### LOW-tier findings (all inherited from V1, all fail-closed or cosmetic)

- **F-E — `semantic_contract_id` missing from a resealed task.json → uncaught `KeyError`.** `_validate_response_v2:752` does `task["semantic_contract_id"]` (subscript, not `.get`). MEASURED: a resealed task with the key removed produced `[CRASH KeyError] 'semantic_contract_id'` — a raw traceback rather than the harness's `SystemExit` fail-closed idiom. Still fails closed; only the error surface is wrong.
- **F-F — `legacy_semantics_visible: 0` (JSON int) accepted where `false` is required.** MEASURED: ACCEPTED, receipt `PASS_STATUS`. Cause: `response.get(key) != expected` with `expected = False`, and in Python `0 == False`. Inherited verbatim from V1 (`:400`). Fix: `is not` or an explicit `isinstance(..., bool)` check at `:756`.
- **F-G — non-strict response schema.** MEASURED: a response that **omits `coverage_statement` entirely** ingests to PASS (the field is in the REQUIRED RESPONSE SHAPE but is never validated), and unknown extra top-level keys are silently ignored. Inherited from V1; low impact since `coverage_statement` is not load-bearing.
- **F-H — `sha256_text` crashes on lone surrogates.** A candidate containing `"\ud800"` parses fine via `json.loads` but `canonical_json(...).encode("utf-8")` raises `UnicodeEncodeError`. Fails closed at emit; cosmetic.
- **Observation, not a defect — `render_prompt_v2`'s guard is unreachable from the CLI.** MEASURED: the only call site is `:723`, inside `emit_v2`, which built the task from the live contract at `:722` — so the guard's condition is unsatisfiable on the only CLI path. It is exercised only by direct call (as the proof does). This **satisfies the ruling's literal §2 requirement**, and the guard is genuine protection for library/reuse callers; but the operationally load-bearing check is `ingest_v2:867`, and *that* one I confirmed can and does go red.

### Residual risk that is NOT a finding but must be stated

**The V2 identity chain is an unkeyed checksum chain, not a signature.** MEASURED HERE: I truncated `required_claims` in a V2 task.json from **7 to 3**, resealed `task_sha256`, re-signed the response accordingly — and `ingest_v2` **ACCEPTED**, issuing `PASS_STATUS` on a task covering only 3 of the 7 mandatory claims. The tamper-evidence recompute at `:882` proves *internal consistency only*; there is no secret, so anyone with write access to the out-dir can mint a self-consistent V2 receipt. **This is not a V2 regression — V1 has the identical property, and no ruling required a MAC.** But "deterministic join" must not be read as "tamper-proof": the durable anchor is the **git commit** of task/prompt/receipt, not the hash inside them. Any future ruling that treats a V2 receipt as evidence should cite the committed blob SHA alongside it.

---

## COVERAGE STATEMENT

### 1. What I verified, and via which non-overlapping paths

| Claim | Path A | Path B |
|---|---|---|
| V1 byte-identical | `git diff --numstat` = 374 ins / 0 del, both hunks pure-insert | SHA-256 of lines 1–556 identical pre/post (`19F91D36…B5D8`) — an independent instrument from the diff |
| Contract bound into `task_sha256` | read the executable lines `:603-606` | executed `build_task_v2` with pinned nonce + mutated contract; hash changed |
| Response/ingest refusal on wrong id/hash | read `:742-757` | 4 executed mutations, all refused with exact error strings |
| Receipt records id/hash | read `:900-901` | executed clean ingest; read the emitted receipt JSON |
| 4 proof scripts pass | Worker-1's report (RELAYED — not counted) | **I ran all four myself**, all `EXIT=0`; plus `git diff --numstat` proving the 3 V1 proofs were not edited |
| F-1 defect is real in the frozen artifact | ruling text (§6, `d5117ba2…`) | independent recompute of the tracked round-3 task.json — hash, candidate SHA, 73 claims, contract field absent, all confirmed |
| `canonical_json` determinism | read `:116-117` | executed across `PYTHONHASHSEED` 0/1/12345 → identical `task_sha256` |

**Note on instrument independence:** for the "V1 untouched" claim I deliberately did **not** reuse Worker-1's proof point 0 as a path — it is the instrument I am grading, and it turned out to be vacuous (F-D). Both of my paths are git-derived and non-overlapping with the proof script.

### 2. Positive-control witnesses for every absence claim
- "No cross-schema confusion" → 3 planted cross-schema artifacts, all 3 refused with distinct error strings.
- "No hex-normalization laxity" → 4 planted case/whitespace variants, all 4 refused.
- "Contract tamper in task.json is caught" → 2 planted tampers (naive and resealed), both refused.
- "Strict PASS law not weakened" → 3 planted violations refused **and** the complementary clean case accepted (`fail_closed_reasons: []`). Both halves ran.
- "No hash instability" → the *conservative* direction was witnessed (NFC/NFD → different hashes), and determinism was witnessed across 3 hash seeds.
- For F-A, F-B, F-C the "absence" runs the other way — I claim a check is **missing**, and each is witnessed by an executed ACCEPT of an artifact that should have been refused, with the receipt contents printed.

### 3. Join keys checked for every "identical / unchanged / matches" claim
- "V1 unchanged" → joined on **file line range 1–556** and on the **git blob diff**, not on function names.
- "graded blob == executed file" → joined on `git rev-parse HEAD:<path>` vs `git rev-parse 81abf5cb:<path>` (both `a81b0553`) plus a clean `git status`.
- "ruling's V1 task == repo's V1 task" → joined on `task_sha256=d5117ba2…` **and** `candidate_sha256=b50729b9…` **and** claim count 73.
- "3 V1 proofs unmodified" → joined on their explicit paths in `git diff --numstat` (empty result), not on their passing.

### 4. What I did NOT verify
- **GPT-5.6 Sol's actual semantic behaviour — out of scope and out of reach.** This harness contains no code path that judges auditor reasoning; it binds identity and fails closed on schema/coverage. Whether the bound contract actually changes the model's judgement is untestable from here. AR-1379A §4 already re-scoped this correctly, and Worker-1's proof docstring discloses it honestly. **The first real V2 audit + mandatory independent Claude challenge remains the only behavioural test.** No claim in this grade extends to model cognition.
- **The E8 round-3 candidate's trading semantics.** I did not re-read the transcript, re-verify the 73 literal quotes, or re-examine the three Round-2 hazards or the `priority: 1/2` question AR-1379A §6 flagged. Out of scope for a Lane A harness grade; those belong to the live V2 audit.
- **The V2 path against the real 73-claim E8 candidate.** All my attacks used the proof's 7-claim synthetic fixture. Scaling behaviour, and any candidate-specific enumeration edge, are UNVERIFIED at production size.
- **`ROLE_ASSIGNMENT_CONTRACT`'s semantic correctness against AR-1378A §6.** I verified it is bound, hashed, and rendered; I did not re-derive that its 8 points faithfully restate the ruling. That was AR-1385's scope and the ruling accepted it.
- **Cross-tree / cross-repo surface.** All measurements are confined to the worktree `C:\Users\tonio\Projects\wt-claude-worker1-20260815`. I did not sweep other checkouts for divergent copies of this harness. Any "does not exist elsewhere" reading of this report is **UNENUMERATED**.
- **Concurrency.** I did not test two `emit-v2` runs racing on one out-dir. Given F-C (unguarded truncating writes), a race is plausible but UNVERIFIED.

### 5. What remains UNCERTAIN
- Whether F-B's delivery seam is exploitable in practice depends entirely on the out-of-band dispatch procedure (how prompt.txt reaches the GPT-5.6 Sol seat) — a process I did not observe and cannot grade.
- F-C's real-world severity depends on which `--out-dir` the Lane B operator passes. If a fresh `-round3-v2/` directory is used, the hazard never fires.

---

## RECOMMENDATION

**Lane A may proceed to Lane B.** The V2 binding meets AR-1379A §2 and all 8 of §5's proof points; the E8 re-emit under `emit-v2` is safe to perform from the frozen candidate `b50729b9…` with a fresh nonce.

Before or alongside the re-emit, and per §11c (zero carry-forwards), close in this same wave:
1. **F-A** — one-clause guard at `:867` (+ mirror at `:612`). Cheapest, highest label-integrity return.
2. **F-B** — re-render and hash-compare the prompt in `ingest_v2`; add `prompt_sha256` to the V2 receipt. ~5 lines; converts index.json's prompt hash into an ingest-enforced join key and closes the last half of F-1.
3. **F-C** — exists-guard in `emit_v2`, **or** simply emit the V2 task into a new directory (e.g. `gpt56-semantic-tasks-round3-v2/E8Wg6tFPYjo/`). The directory choice alone neutralizes it operationally.
4. **F-D** — make proof point 0 capable of going red (compare against `git show <base>:<path>`), or delete the point and cite the git evidence in this grade instead. **Do not leave a green assertion standing that cannot fail.**
5. **F-E/F-F** — `.get()` at `:752` and a bool-strict comparison at `:756`. Two lines, both fail-closed hygiene.

**This grade certifies the harness's identity mechanics only. It certifies nothing about any audit verdict GPT-5.6 Sol produces — that still requires the mandatory independent Claude challenge on every response.**
