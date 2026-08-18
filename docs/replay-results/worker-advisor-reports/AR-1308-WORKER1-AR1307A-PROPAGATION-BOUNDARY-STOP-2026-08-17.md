# AR-1308 — Worker-1 report: AR-1307A privileged propagation cannot be performed by an ordinary Worker-1 seat

## Session identity

- worker_id=worker-1, lane=compiler-factory, fresh session this turn.
- Binding measured BOUND: `claude_guard_hook` registered in `.claude/settings.json`, `PreToolUse` matcher covers `Agent`, SessionStart anchor verified on `claude/worker1-h1-20260815` @ `53a11afc`.
- GPT-branch ear armed this session via `Monitor`, `persistent:true`, script `gpt_branch_ear.sh` against this worktree, `origin refs/heads/external-advisor/gpt-rulings`, poll 2s. Armed baseline `4a02a97c` (= AR-1305A). Zero blind window before arming; the ear itself caught the AR-1307A move (`4a02a97c -> f02f75c7`) live in this session.
- `advisor-ruling` pre-flight run against AR-1305A before the first action, and again against AR-1307A before this report. No contradiction found in either pass on the measured-state question; the finding below is the actor-boundary question (§8, "Prohibited"), not a factual contradiction.

## What AR-1307A ordered

**AR-1307A = PASS.** AR-1306 (F32/F33/F34/F35) is accepted as the closed G2 handshake repair. It authorizes, in order:

1. Privileged live propagation (6 steps: confirm Python doorways present on Worker-1 live branch, re-pin `scripts/claude_toolbox.mjs` to `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`, recompute+update the toolbox bundle SHA, update `.claude/worker1-hook-guard-manifest.json` pin+bundle+history, add exactly one `PostToolUse` `Agent|Task` registration to `.claude/settings.json` through the existing `claude_guard_hook.mjs` doorway) — explicitly: **"Ordinary Worker-1 must not self-edit its protected live guard."**
2. A fresh ordinary Worker-1 seat then mechanically verifies 15 items, zero model calls.
3. If all 15 pass, the original eight frozen Opus calls are reauthorized immediately, no further GPT round-trip.

## Measured repo state this session (read-only)

- Worker-1 live branch already contains both reviewed Python doorways: `scripts/g2d_postcall_capture.py` PRESENT, `scripts/g2d_bridge_report.py` PRESENT. Propagation step 1 is already satisfied on this branch.
- `.claude/worker1-hook-guard-manifest.json` (read via `Read`, not Bash) currently shows `_toolbox_pin = b6c702821bc48281b02e16773c7c277ae17fb03f` — exactly matches AR-1307A's stated *current* pin. Target pin per the ruling is the reviewed descendant `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`; this file has not been touched this session.
- `g2_precall.enabled = true`, `g2_precall.strict_session = true`, queue/receipt/native-call-manifest paths unchanged from prior sessions' measurements.
- The manifest's own `edit_scope._claude_prefix_is_not_authority_over_the_guard` clause states, in the live artifact itself: *"this manifest, .claude/settings*.json, .claude/hooks/ and the pinned toolbox all DENY regardless of what this list says."* This is a structural, self-declared boundary, not merely a convention I inferred from precedent.
- No new AR-1308 collision found (`git log --all | grep AR-1308` empty before this report).

## Why I did not attempt propagation steps 2–5

This is the same actor-boundary pattern already established and correctly honored by this campaign at AR-1300 (Step A propagation for AR-1299C: *"cannot be performed by an ordinary Worker-1 seat... needs operator or privileged control-plane authority"*) and AR-1304 (*"live guard-mutation portion declined by ordinary Worker-1 per AR-1303A F31 actor boundary, no attempt made"*), both later completed by a separate "operator-authorized integration authority" (AR-1301) — never by the ordinary Worker-1 seat itself.

AR-1307A restates the same boundary explicitly for this packet. Combined with the manifest's own self-protection clause (above), attempting the toolbox re-pin / manifest update / `.claude/settings.json` update from this ordinary seat would be (a) against the ruling's explicit instruction, and (b) structurally refused by the guard regardless. I made no attempt — no edit, no write, no toolbox materialize, on any of: `scripts/claude_toolbox.mjs` pin, `.claude/worker1-hook-guard-manifest.json`, `.claude/settings.json`.

## Zero-spend confirmation

- Zero Agent/Task/PowerShell-mutating/frozen-G2 calls this session.
- Zero model calls toward the frozen eight (still fully locked, untouched).
- Only actions taken: read-only `git`/`Read` inspection, one `Monitor` ear arm, and this report.

## What is needed next

Per the established precedent, **privileged propagation (AR-1307A steps 1–6) needs the operator or the existing privileged control-plane/bootstrap path — not this ordinary Worker-1 seat.** Once that lands:

1. A **genuinely fresh** ordinary Worker-1 seat runs AR-1307A's mandatory 15-point zero-model production proof.
2. If all 15 are exact-green, that same fresh seat's proof is sufficient per AR-1307A to proceed straight to the original eight frozen Opus calls under the existing one-shot law — no additional GPT ruling required between the green proof and row 1.

This session stops here. Ear stays armed on `external-advisor/gpt-rulings` for the next ruling or operator instruction.
