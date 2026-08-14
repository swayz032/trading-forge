# P0-6 local deployment-authority audit — 2026-08-14

## Verdict

**RED / not freeze-observable.** The tower is serving, its core dependencies are healthy, and the self-healing boot wrapper is active. P0-6 cannot be certified because the external API watchdog task is not registered and the running process reports `commit=unknown`. No service, task, credential, trading mode, or order path was changed during this audit.

## Running authority

- Windows service `TradingForgeAPI`: `Running`, `Auto`, `LocalSystem`, NSSM PID `24300`, started `2026-08-14 03:00:03 ET`.
- NSSM application: `C:\Program Files\nodejs\node.exe`.
- NSSM directory: `C:\Users\tonio\Projects\trading-forge\runtime-production`.
- NSSM arguments: `C:\Users\tonio\Projects\trading-forge\runtime-production\scripts\tower-boot.mjs`.
- Process chain: `nssm(24300) -> node(19252) -> node(27068) -> node(26912)`; the final process owns port `4000`.
- Runtime checkout branch/head: `hardening/slumhouse-shared-office-parity-20260723` at `e5db798a3f914f7b3515287e8de05232de66a7ee`.
- Runtime checkout is **19 commits ahead** of its upstream and dirty: two tracked modifications plus untracked `.playwright-cli/` and `output/`.
- `GET http://127.0.0.1:4000/api/health`: HTTP `200`, top-level `status=ok`, database/Node/Python/Ollama/n8n all `ok`, Massive `disconnected` with reason `idle_no_paper_sessions`.
- The same response reports `commit=unknown` and `code_dirty=false`. Those two fields contradict the checkout evidence above, so the health endpoint cannot prove deployed bytes.
- NSSM `AppEnvironmentExtra` exposes only the key names `NODE_ENV` and `PORT`; no secret values were read or recorded.
- The runtime `.env` contains the required startup key names, including `ADMIN_RESTART_HMAC_SECRET`, `API_KEY`, and `SLUMDAWG_WEBHOOK_SECRET`; values were neither read nor emitted.

## External recovery and watchdog evidence

- `scripts/watchdog/api-liveness-watchdog.ps1` exists and its 10 behavioral/safety tests pass.
- No scheduled task matching the API liveness watchdog exists on the host (`matching_tasks=0`). This is the missing recovery join that GitHub-only planning could not inspect.
- Added `scripts/watchdog/register-api-liveness-watchdog-task.ps1`. It copies the zero-repository-dependency observer to `C:\Users\tonio\bin\watchdogs`, registers `TF-ApiLivenessWatchdog` every five minutes as `SYSTEM`/`Highest`, and does not restart services.
- Its non-mutating descriptor test passes. The registration script was **not executed**, preserving the plan rule that worker/runtime activation is not performed prematurely.

## Nightly evidence defects

- `TF-Rails-Full-Lane` last result `1`. Its `2026-08-14` JSONL records Python exit `1` after `505787 ms`, plus replay exit `1` after `1 ms`.
- The one-millisecond replay failure was a Windows launcher defect: `spawnSync("npx", ...)` could not execute the Windows command shim. The Codex branch now uses the Node-hosted npm CLI on Windows; its focused test passes `8/8`.
- `TF-Rails-Cert-Rig` last result `1`. Seven invariant checks passed; only `system-map:check` failed. Its build SHA was `3ac84c632f577006e6a0e2dfc1d5e8d47067aea4`.
- `TradingForge-W7c-FullGraduation` result `267014` belongs to the one-time `2026-07-29` W7c task, not the current API process. It remains evidence to classify, not a current liveness signal.

## Codex fixes prepared before Claude starts

1. Running-code identity now invokes Git with a command-local `safe.directory=*` override so the LocalSystem tower can read the checkout without changing global Git config.
2. Identity lookup now fails closed as `commit=unknown, code_dirty=true`, never the former false-green `code_dirty=false`.
3. The Rails replay command now uses `node.exe <npm-cli.js> exec -- vitest ...` on Windows.
4. The API watchdog has an idempotent, testable registration script, but remains unregistered until the deployment packet is explicitly activated.

## Claude start condition

Claude receives this as an execution packet, not a request for Codex help. Before claiming P0-6 green, Claude Lead must integrate the prepared fixes, run the registration script elevated, restart through the normal deploy path, and capture all of these in one receipt: exact pushed SHA, clean deployed checkout, `/api/health` with that SHA and truthful dirty flag, registered watchdog plus one successful tick, PAPER state rehydration, n8n health, and the repaired nightly Rails results. Paid Topstep access and any real order remain outside P0-6.
