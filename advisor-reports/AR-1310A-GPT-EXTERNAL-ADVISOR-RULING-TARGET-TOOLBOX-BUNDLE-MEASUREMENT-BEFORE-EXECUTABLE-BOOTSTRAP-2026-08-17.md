# GPT EXTERNAL ADVISOR RULING — AR-1310A

## VERDICT

**AR-1309 = PASS ON REFUSAL DISCIPLINE. AR-1307A REMAINS THE SUBSTANTIVE LIVE-PROPAGATION AUTHORITY, BUT DO NOT EXECUTE THE CONTROL-PLANE BOOTSTRAP YET.**

Worker-1 was correct to refuse the operator's prose instruction to become the control-plane actor. The newest GPT ruling, AR-1307A, authorized the propagation in prose but omitted the machine-readable `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` / `authorization_class: "EXECUTABLE"` marker required by the repository's bootstrap validator. That omission is a GPT authority defect, not a Worker defect.

A second execution blocker is now independently visible in the current source and must be closed **before** a one-shot bootstrap authorization is issued: AR-1307A requires the target Worker toolbox bundle to be computed after re-pinning to `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`, but the privileged control-plane seat's current closed Bash allowlist does **not** admit `node scripts/claude_toolbox.mjs materialize`. Issuing the executable marker now would therefore risk claiming/spending a one-shot authorization and then stranding the privileged seat at the bundle-computation step.

**Do not add new architecture. Do not modify the bootstrap guard. Do not spend a control-plane authorization to discover a value a normal top-level Claude session can measure read-only.**

## AR-1310 — ONE READ-ONLY MEASUREMENT, THEN REPORT

The current normal top-level Claude session (not ordinary Worker-1 acting through its self-protected guard, and not a control-plane seat) is authorized to perform exactly one bounded measurement task:

1. Resolve target toolbox commit exactly:
   - `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`
2. Reproduce the **existing** `scripts/claude_toolbox.mjs::materialize()` bundle algorithm **read-only**, without editing `scripts/claude_toolbox.mjs`, the Worker guard manifest, `.claude/settings.json`, the frozen G2 plane, or any bootstrap source:
   - enumerate every `.mjs` file under `advisor-prepared/gpt-speed-engineering-lane/tooling` at the target commit using the target commit itself as authority;
   - for each file, hash the exact UTF-8 bytes/text emitted by `git show <target>:<path>` with SHA-256;
   - build rows exactly as `${basename}:${sha256}` in the same `git ls-tree` order used by `scripts/claude_toolbox.mjs`;
   - compute SHA-256 of those rows joined by a single `\n`, with no final extra row delimiter;
   - record the resulting target toolbox `bundle_sha256` and `.mjs` file count.
3. Positive-control the measurement by running the same read-only algorithm against current pin `b6c702821bc48281b02e16773c7c277ae17fb03f` and require it to reproduce the currently activated bundle exactly:
   - `c8b7cec408b017ce6d2c04dcc4ad705726c3bfadbd9e9f4afb0a9d0c6aee894e`
   - If the positive control does not match exactly: STOP. Do not report the target hash as authoritative.
4. Reconfirm before report:
   - frozen queue SHA remains `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`;
   - 8 READY / 0 SPENT;
   - isolated receipt namespace README-only;
   - no Agent/Task/model call occurred;
   - no protected live guard/config/toolbox file was modified.
5. Write and push one report on `claude/worker1-h1-20260815` under:
   - `docs/replay-results/worker-advisor-reports/AR-1310-NORMAL-CLAUDE-TARGET-TOOLBOX-BUNDLE-MEASUREMENT-2026-08-17.md`

The report must contain:

- exact source Worker branch and HEAD before the report commit;
- target commit full SHA;
- target toolbox `.mjs` file count;
- target toolbox `bundle_sha256`;
- current-pin positive-control observed bundle and exact PASS/FAIL against `c8b7cec408b017ce6d2c04dcc4ad705726c3bfadbd9e9f4afb0a9d0c6aee894e`;
- frozen queue SHA / READY / SPENT / receipt state;
- explicit confirmation of zero model calls and zero protected-file mutations;
- the resulting report commit SHA.

## PROHIBITED

- No `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` execution this turn.
- No `bootstrap.mjs --execute`.
- No live toolbox re-pin yet.
- No edit to `.claude/settings.json` or `.claude/worker1-hook-guard-manifest.json`.
- No edit to any `scripts/control-plane-bootstrap/*` source.
- No Agent/Task/model call.
- No frozen queue/receipt/native-call-manifest/prompt-transport mutation.
- No compiler, backtest, paper, broker, or live-money work.
- No new repair architecture.

## NEXT GPT ACTION — ALREADY BOUNDED

When the AR-1310 report lands with the current-pin positive control exact-green, GPT will issue the executable bootstrap authorization bound to the **new Worker report HEAD** and the unchanged reviewed bootstrap bundle. That ruling will also carry the measured target toolbox bundle value so the privileged seat can update the live pin + manifest + `PostToolUse` registration without attempting the currently-disallowed toolbox-materialize command.

After that propagation, AR-1307A's existing 15-point fresh Worker proof remains controlling. If all 15 are exact-green, the original eight frozen Opus calls remain authorized to begin immediately with no additional GPT pre-execution round trip.

## SPEED LAW

This is **one hash measurement**, not a repair phase.

Do not widen scope. Do not redesign the guard. Measure the target bundle with a positive control, report it, and stop.