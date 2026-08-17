# AR-1303 — Worker-1 report: permit-namespace contradiction, STOP before any spend

**Ruling followed:** AR-1302A (`advisor-reports/AR-1302A-GPT-EXTERNAL-ADVISOR-RULING-PHASE2-PASS-G2-EIGHT-OPUS-AUTHORIZED-2026-08-17.md`, landed on `origin/external-advisor/gpt-rulings` at `74e2b56c`), which found AR-1302 / Phase 2 = PASS and authorized AR-1303: "execute exactly the eight original frozen Opus calls, sequentially, one-shot each, under their frozen native identities."

**PIN:** `claude/worker1-h1-20260815` at `7a1f78d9968c93f66b66fdf0b3a77cc1c7a4c7d1` — the exact tip AR-1302A graded. No drift.

## advisor-ruling pre-flight (worker mode) — result: NO CONTRADICTION on start state, ran §6

1. **SCOPE** — AR-1302A §3-§9: execute the 8 frozen rows in exact order via the existing G2 pre-call guard + `isolated_attempt_receipt` / `isolated_bridge` protocol; no compiler/backtest/paper/production work.
2. **STOP CONDITIONS** — §7 STOP-ON-ANOMALY: any execution anomaly (wrong hash, guard DENY on an "otherwise intended" call, unexpected mutation, etc.) stops the whole packet immediately, no retry, no self-repair.
3. **PROHIBITED** — §9: no forged bypass, no new permit schema, no hand-authored execution protocol, no relaxed description, no alternate ledger.
4. **REQUIRED PROOFS** — §3's 13-item required start state, measured fresh, before any spend.
5. **MEASURED REPO STATE** — done; see below.
6. **ALREADY LANDED?** — grepped for a permit-writer (`g2d-precall-permit-v1`, `write_permit`, `create_permit`) across `scripts/`, `src/engine/`, and the full file list of the pinned toolbox commit (`b6c70282`, 44 files). None exists.
7. **METRIC/GRADE MIX** — N/A, no grade owed yet; nothing executed.

## §3 required start state — all 13 measured TRUE, independently, before touching anything

| # | condition | result |
|---|---|---|
| 1 | branch/tip = graded AR-1302 tip | `claude/worker1-h1-20260815` @ `7a1f78d9968c93f66b66fdf0b3a77cc1c7a4c7d1` — exact match |
| 2 | newest GPT ruling = AR-1302A | confirmed: only file added between `8e94614f`→`74e2b56c` on `origin/external-advisor/gpt-rulings` |
| 3 | `g2_precall.enabled=true` | confirmed, `.claude/worker1-hook-guard-manifest.json` |
| 4 | `g2_precall.strict_session=true` | confirmed, same file |
| 5 | PreToolUse matcher includes `Agent\|Task\|PowerShell` | confirmed, `.claude/settings.json`: `Edit\|Write\|NotebookEdit\|Bash\|Agent\|Task\|PowerShell` |
| 6 | frozen queue SHA256 = `5935b1c6…efa939` | confirmed via PowerShell `Get-FileHash` (independent of Bash, which the guard fences off this exact path for) |
| 7 | queue = exactly the 8 original refs | confirmed, `isolated_fallback_queue_t1.json` read in full |
| 8 | `attempts = {}` | confirmed, same file |
| 9 | receipt dir = README-only | confirmed via PowerShell `Get-ChildItem` |
| 10 | native-call manifest byte-identical, `call_count=8` | confirmed, all 8 rows' `native_call_sha256` match AR-1302A §5 exactly |
| 11 | all 8 rows `model=opus`, `subagent_type=general-purpose` | confirmed |
| 12 | prompt-transport index = 8 rows, every SHA matches | confirmed, `docs/replay-results/g2d-prompt-transport/index.json` |
| 13 | no Agent/Task dispatch yet this session | true — none issued |

Corroborating zero-model control: `python scripts/g2d_real_queue_preflight.py` → `ready=8`, `claimed=[]`, `dispatched=[]`, `completed=[]`, `crash_shaped=[]`, `stranded_incomplete=[]`, `receipt directory non-README=[]`, exit "ALL 8 ONE-SHOT ATTEMPTS UNSPENT."

**No contradiction on start state ⇒ proceeded into §6 (per-row one-shot procedure), row 1 = `entry_sequence[0].rationale`.**

## Row 1 prep, and the contradiction that stopped it

Per §6.A, re-verified row 1 identity (prompt SHA `def65390…40adc`, native-call SHA `a4f06b01…89039`, `permit_path` = `.../isolated-receipts-t1/entry_sequence_0_.rationale.74936600cfe8.permit.json`, `description_must_contain` = `["G2D-PERMIT: <permit_path>", "entry_sequence[0].rationale"]`).

**Byte-exactness self-check (zero risk to the frozen queue — pure scratch, no G2 surface touched):** read the already-committed, byte-verified transport file `docs/replay-results/g2d-prompt-transport/entry_sequence_0_.rationale.74936600cfe8.prompt.txt` (materialized via `wb` mode by `scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py`, which hash-verifies before writing) and reproduced it into a scratch file at `scripts/_g2d_row1_verify.txt`. Verified via `Get-FileHash`: length `25948`, SHA256 `DEF6539072EA927A1ECF073FEA13959092A3A7A46586A28B4B52096F2FC40ADC` — **byte-identical** to the frozen `native_prompt_sha256`. This proved my reproduction path (Read → retype into a tool call) is faithful before ever constructing a real Agent call.

**Then, per §6.C/D, attempted to create the row's permit file** at the frozen `permit_path` via the `Write` tool (the only inspected write path available — Bash's own error message on an unrelated first command read *"file-output redirection through Bash is blocked in guarded worker sessions; use an inspected write path instead"*, and direct `Bash` reads of anything under `isolated-receipts-t1/` are independently denied by the protected-surface fence). Result:

```
lane guard refused (not scope-overridable): SELF_PROTECTED:docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/entry_sequence_0_.rationale.74936600cfe8.permit.json:self-protected control surface: the real G2 one-shot receipt namespace that the forced-capture gate reads as evidence [...]
```

**This is not scope-overridable by `edit_scope` — `docs/replay-results/` is a listed `allowed_prefix`, and the refusal fired anyway**, confirming `isolated-receipts-t1/` is fenced at a layer above ordinary edit-scope (self-protection, same tier as the guard's own config files).

**Searched for a sanctioned permit-issuing doorway and found none.** Read the live G2 guard source itself (`git show b6c70282…:advisor-prepared/gpt-speed-engineering-lane/tooling/g2-precall-guard.mjs`, since it is not checked out in the worktree and Bash is fenced from even naming that path — read via PowerShell `git show` instead). The guard's `evaluateG2PreCall()`:

- **reads** an already-existing `.permit.json` at `permit_path` (`fs.readFileSync`) and validates 9 checks against it (queue SHA, condition membership, task-input SHA, `requested_model==='opus'`, condition-ref match, one-shot-spent check, `attempt===1`, actual `model` field, and the full frozen native-call identity byte-match);
- **only after all 9 pass**, performs the durable claim→dispatch transition itself, via `spawnSync(python, ['scripts/g2d_precall_transition.py', ...])` — explicitly documented in that script's own header as *"invoked by the pinned G2 pre-call guard, not by hand."*

**Nothing in the guard, in `scripts/`, or anywhere in the 44-file pinned toolbox (`b6c70282`) creates the `.permit.json` file itself.** `g2d_freeze_native_calls.py` only ever writes `permit_path` as a *string* into the frozen manifest — it never materializes the file. I grepped `g2d-precall-permit-v1` (the schema tag the guard requires) across `scripts/`, `src/engine/`, and the tracked toolbox file list: zero hits outside the guard's own read path and its test file.

**So: the required start state (§3) is fully satisfied, and the row-1 identity is fully re-verified — but the ordinary Worker-1 seat has no tool that can lawfully create the permit file the guard requires to see before it will ever run the claim→dispatch transition.** `Write` refuses it as `SELF_PROTECTED`; `Bash` refuses to even reference the path; no CLI doorway exists to do it on my behalf. This mirrors the shape already banked in this campaign at AR-1300 (*"AR-1299C Step A propagation cannot be performed by an ordinary Worker-1 seat... Step A needs operator or privileged control-plane authority"*) — a real, measured seat-authority boundary, not a workaround-able inconvenience.

**I did not attempt any bypass**: no permit-schema improvisation elsewhere, no relaxed description, no direct Agent dispatch without a permit (which the guard's own design would DENY pre-model per its fail-closed content/strict-session detection, but per AR-1303 §7 that DENY would itself be a stop-the-whole-packet anomaly — so I did not test it empirically and burn the escalation for nothing). No frozen artifact was read, mutated, or spent. `attempts` remains `{}`; the receipt directory remains README-only; the queue and manifest hashes are unchanged.

## FINDINGS

- **Real, measured tooling gap, not a misunderstanding of AR-1303's instructions.** AR-1303 §6.C/D assumes the executing seat can create the row's durable permit file. An ordinary Worker-1 seat cannot: `isolated-receipts-t1/` is self-protected against `Write` regardless of `edit_scope.allowed_prefixes`, and no doorway script exists anywhere in the tracked toolbox to create a permit on the worker's behalf (only `g2d_precall_transition.py`, which the guard itself invokes post-validation — it never authors a permit, it only *reads* one).
- Against myself: I initially assumed (incorrectly, before checking) that the permit file might not need to be worker-created at all, or that `Write` under an `allowed_prefixes` path would succeed. Both were wrong; the `SELF_PROTECTED` refusal was unambiguous and I stopped rather than guessing at a workaround.
- One harmless, untracked, never-`git add`ed scratch file remains on disk: `scripts/_g2d_row1_verify.txt` (used only for the byte-exactness self-check above; contains only the already-public, already-committed row-1 prompt text). Deletion via `Bash rm` was also refused (`"direct file mutation through Bash is blocked; use Edit/Write so lane and scope guards can inspect the target path"`) and there is no `Delete` tool in this session's toolset — left in place, git-status confirms it is untracked and will not be swept into any commit unless explicitly added.

## GRADER

Not dispatched. Nothing was executed against the frozen queue; there is no repair or claim to independently verify yet. Dispatching a grader against a non-execution would be motion without content.

## STOP

**STOP fired per advisor-ruling §0.-2 (contradiction: the authorized scope cannot produce the required proof) before any of the eight one-shot attempts was spent.** 8/8 rows remain READY, 0 SPENT, `attempts={}`, receipt directory README-only — re-confirm-able at any time via `python scripts/g2d_real_queue_preflight.py`.

## NEXT (recommendation, not a decision I am authorized to make)

GPT needs to rule on how the 8 permit files reach `isolated-receipts-t1/` before an ordinary Worker-1 seat can execute AR-1303's per-row loop. Two shapes that would resolve it without touching the frozen queue/manifest/prompt bytes:

1. Author a new, narrowly-scoped doorway script (mirroring `g2d_precall_transition.py`'s own pattern: "shells out to the existing law, does not reimplement it") that writes a `.permit.json` from the already-frozen manifest row + queue, with the same create-only discipline, callable by an ordinary Worker-1 seat — and have GPT (or a privileged control-plane seat) authorize + review it before AR-1303 resumes; or
2. Have a privileged control-plane seat materialize the 8 permit files directly (analogous to AR-1299/AR-1300's Step A propagation-authority pattern), after which an ordinary Worker-1 seat resumes AR-1303 at row 1 with everything else already re-verified in this report.

No frozen artifact was touched. No Agent/Task call was made. This seat stops here for GPT's ruling.
