# AR-1146 — GPT STATIC AUDIT: NO-CLAUDE COLD-START AUTHORITY

**Date:** 2026-08-13  
**Scope:** unattended restart / recovery readiness. No live-trading activation instructions.  
**Worker collision rule:** Claude remains mid-order on AR-1138; do not redirect or overwrite that compiler/grading work.

## 1. Strong current foundation on the compiler engineering branch

The current pushed compiler branch `h1-wave4-sealed12-driver` already contains real no-Claude startup machinery.

### `scripts/tower-boot.mjs`

The launcher is deliberately dependency-light and can:

```text
boot under plain node
-> verify critical Node dependencies
-> run npm install when required dependencies are missing
-> verify dependencies again
-> launch the TypeScript tower through tsx
-> exit with the child so NSSM can supervise/retry
```

It also stamps `TF_LAUNCHED_VIA_BOOT_WRAPPER=1` so the running backend can prove whether NSSM actually invoked the self-healing wrapper.

### `src/server/lib/startup-config-check.ts`

The current branch no longer relies only on a human running `install-tower-launcher.ps1`.

When production Windows is running without the wrapper, the startup check contains an auto-apply path that can, when its safety prerequisites are satisfied:

```text
detect wrapper not active
-> verify NSSM + launcher exist
-> verify service-control privilege
-> enforce DB-backed once-per-24h attempt limit
-> `nssm set` the launcher path
-> `nssm get` read-back verify exact value
-> audit result
-> call the existing authenticated self-restart path
```

This is a meaningful no-Claude improvement: the one-time launcher configuration is no longer necessarily a manual recovery dependency.

### `src/server/index.ts`

Current startup order is also useful:

```text
boot.started audit
-> pending migrations (fail boot on migration failure)
-> startup secret/config check
-> repeated boot-config reminder monitor
-> normal application initialization
```

The boot migration runner is intentionally fail-closed before the application begins serving.

## 2. Important limitation — startup secret checks are warn-only

`checkStartupSecrets()` deliberately does not fail boot when recovery secrets are missing.

That means this state is possible:

```text
API boots and appears generally available
BUT ADMIN_RESTART_HMAC_SECRET is missing
-> authenticated self-restart/recovery path is unavailable
```

This is not automatically a software defect; it is a deployment-readiness distinction.

For no-Claude certification, a successful boot is insufficient. The live environment must prove the recovery prerequisites it depends on are configured.

## 3. External liveness watchdog exists on a different branch, not the current compiler branch

The later ops branch `hardening/phase-0` currently points at `0c57c86b8ce6456ede77a0a54502de8de5c6e3dc` and contains:

`/scripts/watchdog/api-liveness-watchdog.ps1`

That watchdog is intentionally outside the API's dependency tree, uses PowerShell only, checks the API and Discord-bot service state, alerts after repeated failures, and never restarts anything.

However:

- the watchdog artifact is **not present** on the current `h1-wave4-sealed12-driver` branch;
- the original watchdog build commit explicitly described it as built/tested but **NOT registered** at that point;
- this static audit has not found fresh host evidence proving the scheduled watchdog is currently registered and executing.

Therefore the external watchdog is **reusable evidence**, but it cannot yet be counted as an active unattended protection.

## 4. Branch / deployment authority is currently not pinned by GitHub branch naming

Current GitHub discovery finds:

- `h1-wave4-sealed12-driver` — active compiler engineering branch;
- `hardening/phase-0` — later ops/hardening history;
- no discoverable branch named `runtime-production`.

This matters because static code can differ materially between those lines. Example: the later external API watchdog exists on `hardening/phase-0` but not on the active compiler branch.

### P0 no-Claude governance requirement

Before unattended-readiness is declared, pin the exact deployed authority:

```text
host/service
-> repository
-> branch or immutable commit SHA
-> configuration/environment version
-> startup launcher configuration
```

Without that, saying “the repo has the fix” can be true while the running tower does not actually have it.

## 5. Cold-start witness required before no-Claude claim

Use the actual deployment intended to survive without Claude and prove one controlled restart chain:

```text
service/machine restart
-> NSSM launches the intended wrapper (marker proves it)
-> missing dependency scenario heals or fails loudly
-> migrations complete or fail boot
-> required recovery secrets/config are positively checked
-> API health returns
-> scheduler starts
-> active PAPER state reconciles under AR-1144 rules
-> n8n execution scraper resumes
-> 3AM evidence path remains observable under AR-1145 rules
-> independent external watchdog registration/execution is proven if it is part of the design
```

The witness should record the exact deployed commit SHA. A historical commit message or repo file is not deployment evidence.

## 6. Health verdict

### GREEN

- deployed SHA pinned;
- boot wrapper active and proven by runtime marker/read-back;
- required recovery configuration present;
- restart completes without Claude/manual repair;
- PAPER state comes back safely;
- scheduler/n8n observability returns;
- independent watchdog, if claimed, has fresh registration/execution evidence.

### YELLOW

- core service starts, but one recovery layer is degraded or unverified;
- no unsafe PAPER evidence is counted until the degraded layer is reconciled.

### RED

- restart requires Claude/manual code repair;
- deployed commit cannot be identified;
- service starts on an unintended branch/artifact;
- PAPER state resumes ambiguously;
- recovery secret/launcher dependency silently prevents the claimed self-heal path;
- watchdog is claimed active with no fresh registration evidence.

## 7. Fastest next action

Do not rebuild startup.

The smallest valuable work is evidence-oriented:

1. identify the exact tower/deployment commit currently intended for PAPER;
2. compare it against the no-Claude startup/recovery pieces already present across the repo branches;
3. list only the missing deployments/joins;
4. run one controlled cold-start witness before official PAPER.

If the actual deployed line already includes the phase-0 watchdog and it is registered, certify it with fresh evidence instead of rebuilding it.

## 8. Verdict

- Self-healing boot wrapper: **FOUND**.
- Automatic NSSM wrapper repair path: **FOUND on current compiler branch**.
- Fail-closed boot migrations: **FOUND**.
- Recovery-secret presence in the live environment: **NOT PROVEN FROM GITHUB**.
- External independent API watchdog code: **FOUND on `hardening/phase-0`**.
- External watchdog active registration: **NOT PROVEN**.
- Exact currently deployed runtime commit/branch: **NOT PINNED BY THIS STATIC AUDIT**.
- End-to-end no-Claude cold-start: **NOT YET CERTIFIED**.

**Advisor directive:** preserve AR-1138. Carry deployment-SHA pinning + cold-start witness as bounded P0 readiness work so Claude's fresh quota is not spent re-deriving existing restart architecture.