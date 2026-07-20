# External API-Liveness Watchdog — DESIGN SPEC

**Status:** DESIGN ONLY — paper, for advisor review. Grade-B rider (OR-015 §5, placement adopted OR-016 §4).
**Lane:** ops-experience / factory resilience. **Governance:** NON-INSTRUMENT — an external prober, an alert path, and a log. Touches no engine, gate, sizing or measurement surface. Never restarts anything.

---

## 1. The hole this closes, stated from the incident

On 2026-07-18 21:38 the canonical `node_modules` lost 18 of 34 declared dependencies. `src/server/load-env.ts:5` imports `dotenv`, so the API could not reach its first line of work. NSSM crash-looped it, parked the service in a throttle state, and **the outage ran ~26 hours without a single alert.**

**Why nothing fired — every watcher lived inside the thing that was down:**

| watcher | why it was silent |
|---|---|
| dead-man's heartbeat | runs **in-process**, inside the API. A dead API cannot notice it is dead. |
| Discord alerting | `discord.js` was one of the 18 missing packages — the messenger died of the same cause. |
| rails/soak nightly jobs | crashed at `require` before any reporting path (fixed separately, `dec84fd4`). |
| the Office green board | reads `/api/production/status` — served *by the API*. |

**The class:** *a monitor that shares a failure domain with its subject is not a monitor.* Every existing detector was downstream of the same tree.

**The precedent to copy:** `ollama-watchdog.ps1` — an external, scheduled, mutex-guarded, rate-limited supervisor that was source-audited during the OR-014 forensics and **exonerated as well-built**. This applies that proven shape to the API itself.

## 2. Non-goals (deliberate, and the important half of the spec)

- **It NEVER restarts anything.** The API already has a dead-man's-heartbeat auto-restart path with its own guard rails (≤3 attempts/24h, audit-before-call). A second, external restarter would race it and could produce exactly the crash-loop-at-4 AM that OR-013 §3 forbids. **This watchdog OBSERVES and REPORTS. That is the whole job.**
- It does not probe business correctness — only liveness. `503 auth_not_configured` is a **healthy** answer (the API is up and correctly refusing an unauthenticated call); only *unreachable* is unhealthy.
- It does not replace the in-process heartbeat. Two detectors in **different failure domains** is the point.

## 3. Shape

Windows scheduled task, PowerShell, external to the API — `scripts/watchdog/api-liveness-watchdog.ps1` + `register-api-watchdog-task.ps1`.

```
every N minutes:
  probe GET http://127.0.0.1:4000/api/health   (timeout 8s, no auth)
  classify -> UP | AUTH_GATED_UP | DOWN | AMBIGUOUS
  update a small state file (consecutive-failure counter)
  if consecutiveFailures crosses a threshold AND not already alerted -> ALERT
  if recovered after alerting -> send ONE recovery line
```

**Classification (fail-safe, not fail-quiet):**

| observation | verdict | alert? |
|---|---|---|
| HTTP 200 | `UP` | no |
| HTTP 503 `auth_not_configured` | `AUTH_GATED_UP` — **healthy** | no |
| any HTTP response at all | `UP` (it is serving) | no |
| connection refused / no listener | `DOWN` | yes, at threshold |
| timeout | `AMBIGUOUS` → counts toward the threshold but is labelled | yes, at threshold |
| probe itself errors (DNS, script fault) | `AMBIGUOUS` + self-report | yes — **a broken watchdog must say so** |

**Thresholds (pre-registered, versioned `watchdog_thresholds_v1`):** probe every **5 min**; alert at **3 consecutive failures** (~15 min); re-alert at most every **60 min** while down; one recovery line on return. 15 minutes is deliberately far below the 26-hour miss and far above a restart blip.

## 4. Alert path — deliberately NOT the one that died

Ordered fallback, because the incident killed the primary:

1. **`:4100` Discord alert sidecar** (external to the API, the `/__oc/*` path).
2. **Direct Discord webhook** via `Invoke-RestMethod` — needs no repo dependency at all.
3. **Log-only** to `C:\Users\tonio\bin\tf-logs\api-watchdog.log`, always, on every tick regardless of outcome.

**Rule: the watchdog must not require anything from the repo's `node_modules`.** The whole point is surviving a broken tree. PowerShell + built-in HTTP only — no `node`, no `npm`, no repo imports.

## 5. Safety rails (copied from the audited OllamaWatchdog)

- **Mutex-guarded** — overlapping ticks cannot stack.
- **Rate-limited** alerting with a state file; no alert storms.
- **Kill-file switch** — `C:\Users\tonio\bin\tf-logs\api-watchdog.OFF` disables it without unregistering the task.
- **`-DryRun`** — classify + log, never alert.
- **Bounded runtime** — probe timeout 8s, whole tick < 30s.
- **Never elevates, never restarts, never writes to the repo.**

## 6. RED-proofs (a detector without a proven-red path is a false green)

1. Point the probe at a dead port ⇒ `DOWN` after 3 ticks ⇒ alert fires.
2. Point it at a live endpoint returning 503 `auth_not_configured` ⇒ **no alert** (the false-positive that would train the operator to ignore it).
3. Kill-file present ⇒ no alert, and the log says why.
4. `-DryRun` ⇒ classification logged, zero alerts sent.
5. Simulate the sidecar being down ⇒ falls through to webhook; both down ⇒ log-only, and the *next* successful alert reports that alerts were missed.
6. Recovery ⇒ exactly ONE recovery line, not one per tick.
7. **Replay the actual incident**: with `dotenv` absent the API cannot boot ⇒ the watchdog must alert within ~15 min. This is the acceptance test — *would it have caught 07-18?*

## 7. Interaction with the triple net

With this in place the 07-18 class becomes catchable three independent ways in one night:

| detector | catches | domain |
|---|---|---|
| dep-integrity canary (rail 3 / cert) | the erosion itself | nightly cert |
| **external watchdog (this)** | **the API being down** | **outside the API** |
| skip-streak alert (`d433b543`) | the rails going quiet | rails ledger |

**None of the three shares a failure domain with the others.** That is what "the safety net stops being decorative" means — not any single fix.

## 8. Open questions for the advisor

1. **Probe interval 5 min** — cheap enough to be free, or should it be 10 to keep the tick count down on a loaded tower? My lean: 5; the probe is a single HTTP call and does not touch the guard.
2. **Should it watch the Discord bot service too**, or API only? My lean: API only for v1 — the bot's health is not load-bearing and adding surfaces dilutes the signal.
3. **Placement confirmed as a Grade-B rider** — but if the operator wants coverage before Grade B lands, this is small and self-contained enough to ship earlier as its own graded unit. Your call.
