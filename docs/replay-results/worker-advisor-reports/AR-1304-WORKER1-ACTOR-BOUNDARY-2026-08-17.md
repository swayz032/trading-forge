# AR-1304 — Worker-1 report: live guard-mutation portion declined, actor boundary confirmed

**Ruling followed:** AR-1303A (`advisor-reports/AR-1303A-GPT-EXTERNAL-ADVISOR-RULING-AR1303-SAFE-BLOCK-AR1304-G2-HANDSHAKE-REPAIR-2026-08-17.md`, landed on `origin/external-advisor/gpt-rulings` at `0655f495`, caught with zero blind window by the armed GPT-branch ear). AR-1303A graded AR-1303 as **SAFE BLOCK / PASS ON STOP DISCIPLINE**, confirmed F29 (pre-call permit deadlock) and F30 (post-call raw-capture deadlock), and authorized AR-1304 to repair both.

**PIN:** `claude/worker1-h1-20260815` at `bba03d7c15bcadf0fb65f84dc21be22253ba502c` (the exact tip AR-1303A graded). No drift.

## advisor-ruling pre-flight — result: NO CONTRADICTION, but a hard actor-scope mismatch

AR-1303A §4 states, verbatim: *"Actor: privileged guard-repair / control-plane actor for the live guard mutation portion. NOT ordinary Worker-1... Ordinary Worker-1 may perform read-only reconnaissance or author non-live scratch/test code only where its existing guard permits it, but it must not be asked to bypass or self-edit protected guard/settings/manifest surfaces."*

This session is an ordinary Worker-1 seat (per this campaign's own onboarding: `worker-1-compiler-onboarding` / `worker-onboarding`), with no elevated guard-repair or control-plane authority granted by the operator for this session. AR-1304 §5-§7 require editing:

- the pinned guard toolbox's live source (the G2 pre-call guard implementation) — a self-protected surface I confirmed in AR-1303 is fenced from even a `Bash` read by literal path name, let alone a write;
- `.claude/settings.json` to register a new post-tool hook matcher — explicitly named in the Worker guard manifest as self-protected ahead of `edit_scope`, regardless of any `allowed_prefixes` entry (*"AR-1263 §7A self-protection is evaluated FIRST and is never scope-overridable — this manifest, `.claude/settings*.json`, `.claude/hooks/` and the pinned toolbox all DENY regardless of what this list says"*);
- the toolbox pin/bundle identity in `.claude/worker1-hook-guard-manifest.json` — the same self-protected file.

All three are surfaces this exact seat already measured as refusing ordinary-Worker writes (AR-1303: `SELF_PROTECTED` refusal on a receipt-namespace path that WAS a listed `edit_scope.allowed_prefix`; the guard's own self-protection note names these exact three files as unconditionally denying regardless of `edit_scope`). There is no narrower scratch/test task carved out for me here that would produce usable progress toward AR-1304: the packet's own §8 required tests exercise the trusted guard's new behavior directly, and that behavior lives inside the same self-protected toolbox source. Authoring disconnected test files outside that boundary would not be the "descendant pinned toolbox implementation/tests" the ruling actually authorizes, and would not move AR-1304 forward — it would be motion without the content the ruling asked for.

**This exact shape is already banked in this campaign at AR-1299B/AR-1300**: *"Performed by operator-authorized integration authority, not an ordinary Worker-1 seat (AR-1300 correctly refused)"* and *"AR-1299C Step A propagation cannot be performed by an ordinary Worker-1 seat... needs operator or privileged control-plane authority."* AR-1304's live-mutation portion is the same class of action.

## What this seat did NOT do

- Did not attempt to edit the pinned toolbox source, `.claude/settings.json`, or the guard manifest's pin/bundle fields.
- Did not attempt any workaround, second privilege system, or self-elevation.
- Did not touch the frozen queue, native-call manifest, prompt transport, or real receipt namespace (still README-only, `attempts={}`, 8 READY / 0 SPENT — unchanged from AR-1303).
- Did not make any Agent/Task/model call (none was required or authorized for AR-1304 per AR-1303A §4).

## STOP

**STOP fired on an actor-boundary mismatch, not a technical contradiction.** AR-1303A already anticipated this exactly (F31) — this report exists to close the loop formally on the branch rather than leave AR-1304 silently unstarted, per the campaign's decline-receipt discipline (a decline is a state change the relay must carry).

## NEXT (recommendation, not a decision this seat is authorized to make)

The operator needs to invoke whichever privileged guard-repair / control-plane process this campaign already uses for live guard mutation (the same class of actor that previously repinned the toolbox to `b6c70282` and executed the AR-1278 Phase-1 guard repair) to execute AR-1304 §5-§10 in full: hook-owned exact permit materialization (F29), trusted post-Agent return capture (F30), the required zero-model synthetic-fixture tests + mutation controls, and the fresh-seat read-only re-verification in §10 — all without touching the real frozen receipt namespace, per AR-1304 §11's forbidden list.

Once that privileged repair is graded clean by GPT, AR-1303A §12 states GPT will immediately reauthorize the original eight Opus calls in the same grading turn — at which point an ordinary Worker-1 seat (this one or a fresh one, at the same graded tip) resumes AR-1303's row-1 execution with everything already re-verified in the AR-1303 report.
