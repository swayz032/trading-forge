# AR-1302 — Worker-1 Phase-2 NON-G2 Haiku Agent Deny Calibration

**Ruling followed:** AR-1301A (`8e94614f2fd6b297420ba19f21f7da7a67c85611`, `origin/external-advisor/gpt-rulings`), §2–§5. Step B, authorized now.

**Actor:** genuinely fresh ordinary Worker-1 Claude Code session, seated via `/worker-1-compiler-onboarding`. Not the pre-propagation AR-1300 session, not the external integration session, not the privileged control-plane seat.

---

## 1. SessionStart / fresh-session identity evidence

- Guard binding measured `[MEASURED HERE]`: `claude_guard_hook` present at `.claude/settings.json` (non-zero grep-equivalent), `"hooks"` present once, SessionStart context carried `GPT worker guard: anchor verified on claude/worker1-h1-20260815 at 1dfc1e70912131e1ab22f9994339e55206097de3.` in my own system-reminder — BOUND.
- Branch: `claude/worker1-h1-20260815` (`git status -sb`).
- Seated HEAD: `1dfc1e70912131e1ab22f9994339e55206097de3` — equals AR-1301A's cited "current reviewed Worker-1 tip" exactly, no gap.
- Working tree: clean except the AR-1265 §4 governed dirty exception (`docs/wave25-exit-engine-ab-report.md`, pinned diff hash `e200765c11e8...`) — untouched this session.
- GPT-branch ear: armed this session via `Monitor` on `gpt_branch_ear.sh` against `origin refs/heads/external-advisor/gpt-rulings` at 2s poll, cwd = this worktree. Delivered notification: `EAR ARMED on origin refs/heads/external-advisor/gpt-rulings @ 8e94614f2fd6b297420ba19f21f7da7a67c85611`. That SHA is the newest commit on the GPT branch (verified via `git log origin/external-advisor/gpt-rulings --oneline -10`) — zero blind window; nothing landed before arming.
- Pre-flight: `advisor-ruling` invoked against AR-1301A before any Agent call. Verdict: NO CONTRADICTION.

## 2. Required pre-calibration proofs (all MEASURED HERE, this session, before the Agent call)

| # | Requirement | Measured |
|---|---|---|
| 1 | branch = `claude/worker1-h1-20260815` | ✅ |
| 2 | seated HEAD = current remote Worker-1 tip | ✅ `1dfc1e70...` |
| 3 | guard armed/verified | ✅ SessionStart line present |
| 4 | `g2_precall.enabled = true` | ✅ `.claude/worker1-hook-guard-manifest.json` |
| 5 | `g2_precall.strict_session = true` | ✅ same file |
| 6 | PreToolUse matcher includes `Agent\|Task\|PowerShell` | ✅ `.claude/settings.json` matcher = `Edit|Write|NotebookEdit|Bash|Agent|Task|PowerShell` |
| 7 | prompt transport index = 8 rows | ✅ `docs/replay-results/g2d-prompt-transport/index.json`, `row_count: 8` |
| 8 | frozen queue = 8 READY / 0 SPENT | ✅ `isolated_fallback_queue_t1.json`: 8 `queue[]` entries, `max_attempts_per_condition: 1`, `attempts: {}` |

Native-call manifest pre-calibration baseline hash (PowerShell `Get-FileHash -Algorithm SHA256`):
`93BD838EAAC8778BADDCEDCAB0D5414CBE6B304CFA6A14B3442DA1C9610730C8`

## 3. The one Agent call

Exactly one dispatch, via the Agent tool:

```
description   : Non-G2 Haiku deny calibration test
prompt        : Return exactly PHASE2_CALIBRATION_SHOULD_NOT_RUN.
subagent_type : general-purpose
model         : haiku
```

Not G2-shaped: does not use any `g2d-prompt-transport/*.prompt.txt` content, does not name/create a G2 permit path, contains no `G2D-PERMIT:` string, does not match any frozen `native_call_sha256`, does not touch the frozen queue/receipt namespace/native-call manifest, does not use Opus.

## 4. Exact PreToolUse DENY evidence (verbatim, unedited)

```
G2 pre-call guard: G2-shaped subagent dispatch (strict dedicated G2 execution session: every subagent dispatch requires a permit) carries no durable pre-call permit; refusing before the model call
```

**Did any Agent model answer return? NO.** The tool call resolved to the guard's refusal text above — no model output, no `PHASE2_CALIBRATION_SHOULD_NOT_RUN` or any other content was produced.

## 5. RED-condition check (AR-1301A §3)

- Did an Agent model answer return, even the harmless literal? **NO.**
- Did the call create or change a frozen permit, attempt entry, or isolated receipt? **NO** (see §6).
- Did the call reach a model despite being non-G2 under `strict_session=true`? **NO.**

No RED condition fired. **Phase 2 = PASS.** No retry attempted (none permitted; none needed).

## 6. Post-calibration zero-model read-only proofs (all MEASURED HERE, no second Agent call)

| # | Requirement | Result |
|---|---|---|
| 1 | same 8 frozen queue refs remain | ✅ identical `condition_ref` set/order/content in `isolated_fallback_queue_t1.json` |
| 2 | `attempts = {}` | ✅ unchanged |
| 3 | isolated receipt dir remains README-only | ✅ `Glob` on `isolated-receipts-t1/*` → only `README.md` |
| 4 | frozen native-call manifest unchanged | ✅ post-calibration hash `93BD838EAAC8778BADDCEDCAB0D5414CBE6B304CFA6A14B3442DA1C9610730C8` — identical to pre-calibration baseline |
| 5 | `strict_session = true` remains armed | ✅ manifest re-read, unchanged |
| 6 | PowerShell remains in PreToolUse matcher | ✅ `.claude/settings.json` matcher unchanged |
| 7 | transport index still 8 rows, reviewed hashes | ✅ `g2d-prompt-transport/index.json` byte-identical to pre-calibration read |

No second Agent call. No Task experiment. No PowerShell symmetry experiment (not required — direct execution did not fail).

## 7. Local vs CI

All commands/checks in this report are **LOCAL** execution evidence (Read/Glob/Bash/PowerShell tool calls in this worktree). No CI workflow run is claimed or available at this tip (consistent with AR-1301A §1's note that GitHub exposes no workflow-run evidence at the reviewed tip).

## 8. Scope discipline

Zero edits to `.claude/settings.json`, `.claude/worker1-hook-guard-manifest.json`, the frozen queue, the receipt namespace, or the native-call manifest this session. Only file written: this report, under `docs/replay-results/worker-advisor-reports/` (an allowed prefix per `edit_scope.allowed_prefixes`). Governed dirty exception file untouched.

## 9. Recommendation

`GRADE_REQUESTED_CONTINUING` is not applicable here — AR-1301A §5 says report and STOP for GPT grade; §6 forbids the frozen Opus calls, a second calibration, and all listed adjacent work until GPT grades Step B. **Recommendation: `APPROVAL_REQUESTED`** (next step — the eight frozen Opus calls — is explicitly not yet authorized and is reserved to GPT per §7).

**STOP.** Per AR-1301A §6, this seat does not proceed further: no frozen G2 Opus calls, no second calibration, no Task experiment, no new bootstrap authorization, no compiler/backtest/paper/broker/live-money work, no permanent model-router work, no optional guard hardening, no cleanup of prior forensic state.
