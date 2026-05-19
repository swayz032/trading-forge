# Production Path — Hard Isolation Boundary

This directory (`src/server/production/`) is the **production trading code area**.
It must remain completely isolated from the research surface.

## The Isolation Rule

Files in this directory MUST NOT import from:

| Forbidden module | Why |
|---|---|
| `agent-service.ts` | LLM research loop — nondeterministic, LLM hallucinations can corrupt |
| `critic-optimizer-service.ts` | Optuna parameter search — nondeterministic |
| `quantum_*` modules (any) | Challenger-only, high failure rate, experimental |
| `synthetic_market_simulator.py` | Research simulator — not production code |
| `scout-*-service.ts` | Strategy generation pipeline — research side |
| Any module tagged `challenger_only` | Not production-authorized |

CI enforcement: `npm run check:production-isolation` fails on any violation.

## Permitted Imports (production-safe)

| Module | Purpose |
|---|---|
| `services/paper-execution-service.ts` | Paper/live order execution + kill switch DLL checks |
| `services/prop-firm-health-service.ts` | C2 firm suspension detection (kill switch layer 7) |
| `services/exchange-status-service.ts` | C1 CME outage detection (kill switch layer 6) |
| `services/macro-gate-service.ts` | C11 macro hard gates (kill switch layer 8) |
| `lib/network-failover.ts` | C4 connectivity state (kill switch layer 4) |
| `lib/credential-loader.ts` | C6 Bitwarden vault secrets |
| `services/validation-cadence-service.ts` | C7 drift math input (kill switch layer 5) |
| `services/dashboard-snapshot-service.ts` | C2 MFFU snapshot evidence layer |
| `services/windows-health-check-service.ts` | C8 Windows reboot guard (kill switch layer 9) |
| `db/index.ts` | Database connection |
| `db/schema.ts` | Drizzle table types |
| `routes/sse.ts` | `broadcastSSE` for real-time events |
| `services/alert-service.ts` | `AlertFactory` for critical alerts |
| `lib/logger.ts` | Structured logging (pino) |

## Files in This Directory

| File | Purpose |
|---|---|
| `kill-switch.ts` | Single source of truth for production mode (`HALT`/`PAPER`/`LIVE`) |
| `index.ts` | Module entry point — exports the public API of this directory |

## Phase 4B / 4C Additions (not yet in this directory)

Phase 4B will add:
- `reconciliation-service.ts` — daily 4:15 PM ET recon cron
- `drift-detector.ts` — weekly Sunday auto-halt detector

Phase 4C will add:
- Cron registrations in `scheduler.ts`
- Kill switch hook wiring in `paper-execution-service.ts`

## Why This Isolation Exists

Trading Forge has two code surfaces: **research** (LLM, quantum, scout pipeline)
and **production** (paper engine, kill switches, order execution). A bug in the
research surface (LLM hallucination, quantum module crash, scout pipeline failure)
MUST NOT be able to corrupt a live trade or a production mode decision.

The isolation boundary makes this enforcement mechanical rather than informal.
The CI lint script (`scripts/check-production-isolation.mjs`) makes it automated.
