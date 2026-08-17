# AR-1291 — BOOTSTRAP EXECUTION-PLAN CLOSURE: F-16..F-19 CLOSED, AUTHORING/TESTING ONLY

**All four pre-execution blockers AR-1290A found are closed. F-16 (report path) and F-17
(commit-message path) are marker-scope + prompt-content fixes — the underlying allow/deny
mechanism (`classifyControlPlanePath` against `marker.allowed_paths`) needed no code change. F-18
(privileged-seat vs. Agent-traversal split) is implemented as a Phase-1-only packet prompt. F-19
(exact prompt transport) is one new fixed-CLI Python helper. 76/76 tests pass (65 pre-existing +
11 new AR-1291 controls), including four that exercise the actual Python helper as a real
subprocess against a disposable fixture repository. Zero bootstrap executions, zero privileged
launches, zero Agent/subagent calls, zero frozen G2 spend. Frozen eight: 8 READY / 0 SPENT,
unchanged (never touched by this packet).**

**Model:** Sonnet 5, HIGH effort, per this packet's own routing law (AR-1290A "Actor / model").
**Disclosed limitation:** this top-level session has no tool to introspect its own running model
identity — Sonnet-5-as-default is `RELAYED` (the operator's own prior action, per AR-1290A's own
end state), not something I can grade `MEASURED HERE` from inside the session.

---

## 1. WHAT WAS BROKEN, AND WHAT CHANGED

### F-16 — report path not in the marker's `allowed_paths`

`buildPacketPrompt()` told the seat to write its report to
`docs/replay-results/worker-advisor-reports/`, but that path was not in the AR-1278 example marker
in `CONTRACT.md`, and the guard is default-deny against `allowed_paths`. **Fix:** the path is now in
the marker template (`CONTRACT.md §1`); the mechanism itself needed no change —
`classifyControlPlanePath` already allows any path that is a listed prefix and denies everything
else. `AR1291-E1` proves both directions with the real function, not a description of it.

### F-17 — `.cp-commit-msg.tmp` not in the marker's `allowed_paths`

`cp-finalize.mjs` (unmodified, out of scope) hard-requires
`scripts/control-plane-bootstrap/.cp-commit-msg.tmp` to exist before it will commit, but nothing
authorized the seat to *create* that file. **Fix:** same mechanism, same fix — the path is now in
the marker template, and `buildPacketPrompt()` now has an explicit numbered step telling the seat to
write it before staging. `AR1291-E2` proves the exact path is allowed and a sibling script
(`bootstrap.mjs`) stays denied through the same allowlist.

### F-18 — one seat cannot both stay privilege-minimal and run the Agent traversal calibration

Architecturally resolved by GPT (AR-1290A §3), not by this packet: the closeout is two phases.
**Fix:** `buildPacketPrompt()` now states explicitly that this is "PHASE 1 ONLY," names Phase 2 as a
fresh ordinary Worker-1 seat launched only after GPT grades Phase 1, and states why Agent/Task stay
categorically denied to this seat. `AR1291-E10` asserts the exact language.

### F-19 — no lawful transport for the eight frozen prompts

The canonical emitter (`g2d_freeze_native_calls.py --emit-prompt <ref>`) takes a caller-supplied
argument and writes to stdout — neither shape is a fixed command the guard can allow, and manual
reconstruction is forbidden (the frozen hashes are byte-sensitive). **Fix:** new file
`scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py` — one fixed, no-argument CLI.
It imports `g2d_freeze_native_calls` and calls its real `build()`, `_SYSTEM_PROMPT`,
`_build_user_message`, `_safe_name` **by reference, unmodified** — no template is retyped. For every
row it verifies, before writing anything: `condition_ref` present in both the frozen manifest and a
fresh derivation; `model`/`subagent_type` match the pinned constants; `task_input_sha256` unchanged;
`sha256(prompt bytes)` and `char count` match the frozen `native_prompt_sha256`/
`native_prompt_char_count`; `native_call_sha256` re-derives exactly. A row-verification failure, a
missing/unreadable manifest, or an existing output with different bytes refuses **before any file is
written** — the write pass runs only after every row and every output path has been checked.

**Guard:** one new `BASH_ALLOWED_SHAPES` entry, an exact-literal regex for
`python scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py` — no arguments, no
`python -c`, no redirection (`AR1291-E3`).

**Bundle:** the new helper is now in `BUNDLE_FILES` (`AR1291-E12`).

**Files touched**, exactly the authorized surface (AR-1290A §"Authorized scope"), nothing else:

```
NEW    scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py
MOD    scripts/control-plane-bootstrap/plan.mjs
MOD    scripts/control-plane-bootstrap/control-plane-guard.mjs
MOD    scripts/control-plane-bootstrap/bundle.mjs
MOD    scripts/control_plane_bootstrap.test.mjs
MOD    docs/replay-results/control-plane-bootstrap/CONTRACT.md
```

`git diff --stat` on the modified files: 5 files changed, 307 insertions(+), 10 deletions(-), plus
the new 217-line file. `[MEASURED HERE]` — reviewed the full diff of every touched file before
staging; `bootstrap.mjs`, `authorization.mjs`, `cp-finalize.mjs`, `cp-commit.mjs`, `claim-store.mjs`
and `control-plane-seat-hook.mjs` are untouched, matching the ruling's "not to be edited unless a
deterministic test proves necessity" — no test required touching any of them.

---

## 2. E1–E13 — EACH PROOF, WITH ITS COMMAND

Command for the full suite: `node --test scripts/control_plane_bootstrap.test.mjs`

```
tests 76
pass  76
fail  0
```

| Proof | What it shows | Test |
|---|---|---|
| E1 | report path ALLOW when named; unrelated replay-result path DENY | `AR1291-E1` |
| E2 | `.cp-commit-msg.tmp` ALLOW; sibling script `bootstrap.mjs` still DENY | `AR1291-E2` |
| E3 | fixed transport command ALLOW; `+arg`, `python -c`, other script, redirect all DENY | `AR1291-E3` |
| E4 | helper materializes exactly N outputs + index (N = the fixture's frozen queue size) | `AR1291-E4/E5` |
| E5 | each artifact's sha256 and char count match the frozen manifest row | `AR1291-E4/E5` (same test) |
| E6 | mutating one frozen `native_prompt_sha256` byte is detected; **zero** files written, not even the unaffected row | `AR1291-E6` |
| E7 | missing `native_call_manifest_t1.json` refuses before any output | `AR1291-E7` |
| E8 | the frozen queue + manifest are byte-identical (sha256) before and after a successful run | `AR1291-E8` |
| E9 | generated prompt names the report dir, the commit-message path, `git add <path>`, and `cp-finalize.mjs` | `AR1291-E9` |
| E10 | generated prompt states "PHASE 2 IS NOT YOURS" and names Agent/Task as categorically denied | `AR1291-E10` |
| E11 | `Agent`/`Task`/`PowerShell` still DENY through `classifyControlPlaneTool` | `AR1291-E11` |
| E12 | `BUNDLE_FILES` includes the new helper; a one-byte mutation in it moves the bundle digest | `AR1291-E12` |
| E13 | the 65 pre-existing controls are unchanged and re-ran green in the same invocation above | (whole-suite count) |

### E4–E8 methodology — why a disposable fixture, and what it actually proves

AR-1290A §E: *"Use disposable fixtures for any write-producing transport tests. Do not create real
transport artifacts in the Trading Forge tree during AR-1291 authoring."* So E4–E8 do **not** run
the helper against the real 8-condition frozen queue and write into
`docs/replay-results/g2d-prompt-transport/` — they copy the real, unmodified
`g2d_freeze_native_calls.py` and `materialize-g2-prompt-transport.py` into a fresh temp directory
alongside a small synthetic 2-condition queue/benchmark/transcript and minimal stub leaves for the
two symbols `g2d_freeze_native_calls.py` imports by name (`_SYSTEM_PROMPT`, `_build_user_message`,
`_safe_name`) — the same role this suite's `fakeIo` plays for `git` elsewhere. The manifest inside
the fixture is generated by actually running the real (copied) emitter's `--write`, never
hand-typed. This proves the **mechanism** (verify-then-write, refuse-before-write, byte/char/hash
agreement, namespace isolation) with N=2 rather than N=8; it does not itself prove the real 8-row
manifest verifies. That is proven separately, read-only:

```
$ python -c "
import importlib.util
spec = importlib.util.spec_from_file_location('materialize', 'scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rows, err = m._verified_rows()
print(err, len(rows) if rows else None)
"
None 8
```
`[MEASURED HERE]` — all 8 real frozen rows independently re-verify against a fresh derivation, and
confirmed via `git status --short` afterward that nothing was written to the real tree (no
`docs/replay-results/g2d-prompt-transport/` created). `_verified_rows()` performs no I/O beyond
reads; only `main()` writes, and `main()` was never called against the real tree in this packet.

### A bug the fixture caught, and the state before/after

The helper's first version computed `ROOT` with two `dirname()` calls, copying the convention from
`g2d_freeze_native_calls.py` — correct for that file (one directory below repo root:
`scripts/g2d_freeze_native_calls.py`) but wrong for this one (two directories below root:
`scripts/control-plane-bootstrap/materialize-g2-prompt-transport.py`). The read-only check above
did not catch it, because `_verified_rows()` resolves every path through `native._abs()` (the
*imported* module's own, correctly-computed `ROOT`), never through this file's own. Only `main()`'s
write path uses this file's own `ROOT`/`_abs()`. The first real subprocess run against the fixture
exited 0 and printed `"WROTE 2 prompt artifacts + index to ..."` — a **false green**: it wrote to
`<fixture>/scripts/docs/replay-results/g2d-prompt-transport/`, one level short of where `OUT_DIR`
was supposed to resolve, and the test's own path check (`fs.existsSync` on the *correct* location)
caught it as `AssertionError: index.json must be written`. Fixed to three `dirname()` calls, with a
comment stating the reason so a later file added at a different depth does not repeat it. Disclosed
per `0-CTRL.4`: this was the version that ran once, wrongly, before the fix — not a claim that the
first attempt worked.

---

## 3. TERMINAL FROZEN PROOF (unchanged by this packet, re-measured)

```
$ node --test scripts/control_plane_bootstrap.test.mjs   (includes C10/GREEN frozen-state assertions)
tests 76, pass 76, fail 0
```

The frozen G2 queue, receipts and manifest are read-only inputs to `_verified_rows()` and are never
in `BASH_ALLOWED_SHAPES`' write surface nor in any `allowed_paths` entry this packet touched.
`AR1291-E8` additionally proves byte-identical sha256 before/after a real subprocess run against the
fixture's copies of those namespaces.

```
frozen ready       = 8   (unchanged; this packet never reads or writes the real frozen tree)
frozen spent       = 0
attempts           = {}
frozen receipts    = README ONLY
```

---

## 4. WHAT THIS PACKET DID NOT DO (forbidden list, AR-1290A §F)

`bootstrap --execute` — never invoked. `cpb-2026-08-17-0002` — never minted or referenced.
Privileged seat launch — never. `Agent`/`Task` calls — zero (mechanically: this session made none;
also `AR1291-E11` reasserts they remain denied to the future privileged seat). Live traversal
calibration — not run. Frozen G2 / frozen retries — untouched. Compiler/backtest/paper/broker/
live-money work — none. `cpb-2026-08-17-0001`'s branch/worktree/claim — not touched. Permanent
model-router repository implementation — not started (queued, per AR-1290A §8).

## END STATE

```
F-16 report-path deadlock       = CLOSED (marker-scope + prompt fix)
F-17 commit-message deadlock    = CLOSED (marker-scope + prompt fix)
F-18 phase split                = CLOSED (Phase-1-only prompt)
F-19 prompt transport           = CLOSED (materialize-g2-prompt-transport.py)
tests                           = 76/76 (65 pre-existing + 11 new)
frozen G2                       = 8 READY / 0 SPENT, unchanged
next executable marker          = NOT MINTED — GPT's to issue after grading this packet
```
