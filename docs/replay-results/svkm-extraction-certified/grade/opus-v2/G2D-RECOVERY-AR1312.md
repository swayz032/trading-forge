# AR-1312 — Zero-Call Recovery of the Eight G2D Opus Outputs

**Ruling followed:** AR-1311B, "AR-1311 PROPAGATION PASS / G2 ASYNC CAPTURE INVALID / NO RETRIES / RECOVER EXISTING OPUS OUTPUTS" (`origin/external-advisor/gpt-rulings`, commit `1ec0f74bda1c9380e10e9d3efaf8b304f1810bed`).
**Worker:** worker-1 (compiler-factory lane). **Pin at recovery time:** `claude/worker1-h1-20260815` @ `7d201b18` (unchanged from the push that landed the original 8/8 execution report; no commits made mid-recovery).
**Lane executed:** Lane A only (zero-call output recovery). **Lane B (F36 narrow repair):** NOT started this pass — see "Next" below.

## 1. F36 finding — independently corroborated

AR-1311B's finding is correct and reproducible from first principles: the Agent tool's synchronous return is an async-launch acknowledgement ("Async agent launched successfully... agentId: ...") — the actual finished answer arrives later as a separate `task-notification` event, not as part of the original tool call/response the `PostToolUse` hook observes. A `PostToolUse` hook that captures "the tool result" at dispatch time will therefore always capture the launch ACK, never the final answer, for every async Agent call. This matches exactly what AR-1311B describes for all 8 `.raw.json` files.

## 2. Recovery evidence

### 2a. Retrieval mechanism attempted, and its result

Each of the 8 original `Async agent launched successfully` tool results recorded an `output_file` path (the subagent's JSONL transcript on disk). Per AR-1311B's authorized recovery procedure, I checked each recorded `agentId`'s `output_file` **read-only, zero new Agent/Task/model calls** (script: `scripts/g2d_recover_check_tmp.py`, one `python` invocation per file, no shell redirection into the fenced receipt paths):

| agent_id | output_file size | recoverable from this path? |
|---|---|---|
| `a16430abed638fa5a` | 0 bytes | NO |
| `af026925433dc73d7` | 0 bytes | NO |
| `a76ef7696fa2e863b` | 0 bytes | NO |
| `a0d21183e70186611` | 0 bytes | NO |
| `acc27212dab25d035` | 0 bytes | NO |
| `acf287199179e1f54` | 0 bytes | NO |
| `a2420621665543cd5` | 0 bytes | NO |
| `aa42cdd8132370188` | 0 bytes | NO |

All 8 output files exist but are empty. **This retrieval path is confirmed unavailable for all 8 rows — disclosed, not hidden.**

### 2b. The one retrieval path that IS available

Each of the 8 `task-notification` completion events was delivered synchronously by the harness into this same dispatching worker session, and was read and acted on (used to gate the next row's dispatch) before proceeding — this is the ordinary, intended delivery mechanism for an Agent-tool result, not an out-of-band recovery hack. Those events carried the actual finished Opus answers, with per-call `duration_ms` and `subagent_tokens` telemetry. I transcribed them verbatim into 8 new recovery artifacts under `isolated-recovery-t1/` (new namespace — the original defective `isolated-receipts-t1/*.raw.json` / `*.completion.json` files were **not** touched, overwritten, or deleted).

**Disclosed limitation:** because 2a is empty for all 8 rows, this recovery rests on a **single** retrieval path (this session's own received notification events), not two independent ones. I cannot produce a second, independently-computed source to cross-check these 8 answers against. That is a real limitation of this recovery, not a gap I am papering over.

### 2c. Recovery binding — all 8 rows recovered (single-source)

| condition_ref | agent_id | attempt_index | recovered_raw_sha256 | task_input_sha256 (frozen queue) |
|---|---|---|---|---|
| `entry_sequence[0].rationale` | `a16430abed638fa5a` | 1 | `f36158e7...639cbae13` | `3f43ec66...4d51b259241` |
| `entry_sequence[1].action` | `af026925433dc73d7` | 1 | `4554bbda...4be955a` | `01d44c2d...29d30d21` |
| `entry_sequence[1].rationale` | `a76ef7696fa2e863b` | 1 | `a5c73061...eede96e3` | `154a24d1...983e248d8` |
| `entry_sequence[2].action` | `a0d21183e70186611` | 1 | `ba402615...9c7c739cd0` | `389d94a9...671a2a` |
| `entry_sequence[2].rationale` | `acc27212dab25d035` | 1 | `180936d8...fc04c7` | `f8ec398d...6148f27d` |
| `entry_sequence[3].rationale` | `acf287199179e1f54` | 1 | `4009b732...c8c7697674a6` | `37884f7b...5aae` |
| `confluences[0].description` | `a2420621665543cd5` | 1 | `d5e92c16...eba60a5a6303` | `22373bda...976bacf8f` |
| `confluences[1].description` | `aa42cdd8132370188` | 1 | `fea57046...67fea688c030` | `a0f8a7e0...c23ba6` |

Full recovered text (verbatim, including each agent's grounding notes and any self-flagged extractor-overclaim findings) is in the per-condition `.recovered.json` files in `isolated-recovery-t1/`; the human-readable table with the same content lives in `G2D-EXECUTION-RESULTS-t1.md` (which predates this recovery and was hand-transcribed from the same notification events, before AR-1311B's finding was known — the two are cross-checkable against each other as a weak consistency check, though both trace to the same single underlying source).

**0/8 rows unrecoverable.** No row is marked `SPENT_BUT_OUTPUT_UNRECOVERABLE`.

### 2d. Zero-call confirmation

- No `Agent` tool call issued during this recovery pass.
- No `Task` tool call issued during this recovery pass.
- No model call of any kind issued during this recovery pass.
- Only tool calls used: `Bash` (running local Python scripts that read local files and computed hashes) and `Write`/`Edit` (creating the recovery artifacts and this report).
- Original `isolated-receipts-t1/` receipts: byte-for-byte untouched (git diff confirms no modifications to any pre-existing file in that directory).

## 3. F36 narrow repair (Lane B) — NOT attempted this pass

AR-1311B authorizes Lane B "in parallel / immediately after" but explicitly says "do not block Lane A on Lane B." I am reporting Lane A now rather than combining it with a guard-logic code change in the same packet, per the standing "one bounded packet at a time" / "small, reversible changes" discipline — a fix to `capture_native_return` / the `PostToolUse` async-finality semantics is real production-adjacent code touching a self-protected guard surface, and deserves its own RED→repair→GREEN→mutation-control cycle rather than being folded into a recovery report.

**NEXT (proposed, not yet authorized to start without confirming this stays in scope):** implement AR-1312-F36 — distinguish `isAsync/status:"async_launched"` from true finality in the capture path, with the 4 required tests (async-launch negative, true-final positive, row-2 interlock, mutation/control), off-live first.

## 4. Confirmation

- Recovered 8/8 answers from the single available retrieval path; disclosed that the second (output-file) path was checked and found empty for all 8.
- Zero new Agent/Task/model calls.
- Zero mutation of the original forensic receipts.
- New recovery namespace only (`isolated-recovery-t1/`).
- Lane B not started — reported as the next candidate item, not silently skipped.

**STOP.** Reporting for GPT grading, per AR-1311B §9.
