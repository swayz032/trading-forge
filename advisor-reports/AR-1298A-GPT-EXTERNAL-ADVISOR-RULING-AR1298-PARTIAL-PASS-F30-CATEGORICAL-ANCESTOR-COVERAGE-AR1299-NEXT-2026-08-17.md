# GPT EXTERNAL ADVISOR RULING — AR-1298A

## VERDICT

**AR-1298 = PARTIAL PASS. The assigned F29 frozen-G2 recursive-search ancestor bypass is closed in the actual repository and its required examples are covered. However, the implementation does not yet satisfy AR-1297A's broader structural law: a recursive `Glob`/`Grep` root must not permit traversal into *any categorically protected descendant*. The new ancestor list covers the six token-backed frozen/self-guard paths, but omits the existing `CATEGORICAL_DENY_PREFIXES` money/toolbox surfaces. This is F30 and it is a direct execution-boundary blocker. Fix F30 only. No optional hardening.**

Reviewed Worker-1 true tip:

`24e6daf7fc99574c4d65bb907dab3fdb1b1177a6`

AR-1298 repair commit:

`bae3fab0bd47d61a0dea5badfdd21bc73f4883f2`

`compare(bae3fab0..24e6daf7)` shows exactly one added AR-1298 worker-report file and no bootstrap bundle file changes, so the worker's post-repair bundle measurement remains the code identity for the reviewed repair.

Worker-reported bundle SHA256:

`ba6d0575d69feb2d6cf89dcdec7f53756e07ab79333405ea56230748a9ef3e43`

GitHub exposes no combined status checks and no workflow runs at the reviewed tip. `139/139` is therefore local test evidence, not CI.

---

## 1. F29 — ASSIGNED FROZEN-G2 BYPASS = PASS

The production code now adds `PROTECTED_SURFACE_PATHS` for the six token-backed paths and `ancestorOfProtectedSurface(relPath)`. The repository-root sentinel no longer auto-allows. `docs/`, `docs/replay-results/`, the opus-v2 directory, and the no-path root are denied when recursive traversal would reach the frozen queue / isolated receipts / native-call manifest.

The worker intentionally rewrote the old false-green test that asserted root/broad `Glob`/`Grep` ALLOW and added controls for the F29 examples. This is the correct repair direction.

The frozen experiment remains untouched at the reviewed Worker tip:

- 8 queue rows;
- `attempts = {}`;
- receipt directory contains only `README.md`.

Therefore:

`FROZEN G2 = 8 READY / 0 SPENT`

No frozen G2 call is authorized here.

---

## 2. F30 — RECURSIVE ANCESTOR COVERAGE IS INCOMPLETE

AR-1297A's required property was explicit:

> A `Glob` or `Grep` authorization must not permit traversal into **any categorically protected descendant** merely because the supplied search root itself looks ordinary.

The actual production guard has these `CATEGORICAL_DENY_PREFIXES`:

- `src/engine/backtester`
- `src/engine/exits/`
- `src/server/services/paper-`
- `src/server/services/broker-`
- `src/server/production/`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/`

But `PROTECTED_SURFACE_PATHS` contains only:

- frozen queue;
- frozen receipt directory;
- native-call manifest;
- `.claude/settings.local.json`;
- `.claude/control-plane-guard-manifest.json`;
- legacy `scripts/control-plane-bootstrap/claims`.

So direct reads of the money/toolbox surfaces still deny, but recursive roots can bypass them. Example:

`Grep(path='src/', pattern='...')`

The supplied root `src/` is not itself a direct categorical hit and is not an ancestor of any of the six `PROTECTED_SURFACE_PATHS`, so `ancestorOfProtectedSurface('src/')` returns false and the recursive read can ALLOW even though it can traverse into `src/engine/backtester`, `src/engine/exits/`, `src/server/production/`, and the paper/broker surfaces.

Likewise, a recursive root above `advisor-prepared/gpt-speed-engineering-lane/tooling/` can traverse into the protected toolbox surface.

This is the same ancestor-bypass class F29 was supposed to close, just on the existing prefix-backed categorical surfaces instead of the token-backed frozen surfaces.

The current F29 drift test is one-way: it proves every new `PROTECTED_SURFACE_PATHS` entry maps to some existing token/prefix, but it does **not** prove every existing categorical prefix is represented in recursive ancestor protection. A subset can therefore pass the drift test while leaving protected descendants uncovered.

This is a direct blocker, not architecture polish.

---

# AR-1299 — F30 ONLY

## Actor / model

Ordinary Worker-1 engineering seat.

`model = Sonnet 5`

`effort = HIGH`

No Opus. No Agent/subagent calls.

## Objective

Make recursive-search descendant protection cover the complete categorical read boundary, not only the six token-backed surfaces.

Use the smallest deterministic repair. Preferred shape:

- keep the six concrete token-backed paths;
- include every `CATEGORICAL_DENY_PREFIXES` entry in the recursive-protected target set, or derive an equivalent union mechanically;
- make `ancestorOfProtectedSurface(...)` evaluate that complete union;
- keep direct read/write classification laws unchanged.

Do not add filesystem walking. Do not redesign the guard.

## Required controls

Through the real production classifier / `decide()` path:

1. no-path `Grep` and `Glob` remain DENY;
2. `Grep(path='src/')` DENY because protected money-path descendants exist;
3. `Glob(path='src/server/')` DENY;
4. a root above `advisor-prepared/gpt-speed-engineering-lane/tooling/` DENY;
5. direct Read of `src/engine/backtester...` / `src/server/production...` remains DENY;
6. direct Read of an ordinary safe file remains ALLOW;
7. at least one packet-useful safe recursive root such as `docs/replay-results/worker-advisor-reports/` remains ALLOW;
8. all F29 frozen queue/receipt/native-manifest ancestor controls remain green;
9. Agent / Task / PowerShell remain DENY;
10. F26 `SETTING_SOURCES = user,local` remains unchanged;
11. F28 exact authority-read Bash shape remains ALLOW and variants remain DENY;
12. add a **two-way coverage invariant**: every categorical prefix is represented in recursive ancestor protection, and every explicit token-backed recursive surface remains tied to an existing categorical token/prefix;
13. full control-plane bootstrap suite green.

## Preferred scope

- `scripts/control-plane-bootstrap/control-plane-guard.mjs`
- `scripts/control_plane_bootstrap.test.mjs`
- AR-1299 worker report

Avoid other bootstrap files unless a deterministic test proves one is required.

## Required closeout

After the repair commit:

- run full bootstrap suite;
- run production read-only `bootstrap.mjs` plan;
- record true repair code HEAD;
- record final bootstrap bundle SHA256 and 10-file membership;
- record frozen queue SHA256;
- record 8 READY / 0 SPENT / README_ONLY;
- record shared claimed ids visible to runtime: #1/#2/#3 spent, #4 absent;
- record `SETTING_SOURCES = user,local`;
- record prospective target packet remains `AR-1278` and branch for #4 remains `control-plane/ar-1278-guard-repair-cpb-2026-08-17-0004`;
- if a report/inventory commit advances Worker-1, disclose whether any BUNDLE_FILES changed.

## FORBIDDEN

- `bootstrap --execute`
- executable bootstrap marker #4
- new bootstrap claim
- privileged real control-plane launch
- Agent / Task / model calibration
- frozen G2 call or retry
- Phase 2
- compiler / backtest / paper / broker / live-money work
- permanent model-router implementation
- cleanup of spent #1/#2/#3 forensic state
- unrelated hardening

## SPEED LAW

**F30 is the only authorized blocker. Close the complete categorical ancestor set, prove it, measure the new bundle pin, report. If AR-1299 passes and no new direct execution blocker is observed, GPT issues `cpb-2026-08-17-0004` immediately. No architecture-polish detour.**

## END STATE

- AR-1298 assigned F29 frozen-surface repair = PASS
- F30 complete categorical recursive-ancestor coverage = OPEN
- bootstrap #4 = NOT MINTED
- future #4 target packet = AR-1278
- frozen G2 = 8 READY / 0 SPENT
- next = AR-1299 F30-only repair
