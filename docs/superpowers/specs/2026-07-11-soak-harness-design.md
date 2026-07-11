# Tower Soak Harness — Design Spec

- **Date:** 2026-07-11
- **Status:** DRAFT — awaiting operator review, then `writing-plans`
- **Owner:** operator (swayz032) + Claude
- **Phase fit:** Production Hardening (§2). Net-new *observability/reliability* instrument — NOT a new trading subsystem, NOT a feature-add. Reframed as hardening: it converts the unverified "tower survives 30+ days unattended" claim into measured evidence.

---

## 1. Purpose — the problem it solves

Backtests prove strategy *math*. Unit/evil tests prove *logic*. **Nothing currently proves the *process* survives wall-clock time on the tower.** Every documented tower incident is time/accumulation-driven — ollama cold-load spiral, orphan-VRAM-wedge, disk fill, credential expiry, silent NSSM crash-respawns, queue backlog — and none of them show up in a backtest or a unit test. They only appear on a clock.

The soak harness watches the tower run for a fixed nightly window, measures resource curves over time, and emits a deterministic verdict. Nightly runs chain together (NSSM keeps one process alive *between* nights) into the rolling equivalent of the 30-day vacation-mode acceptance test — assembled while the operator sleeps, without reserving a 30-day quiet window.

**Yardstick:** survive a 14-day vacation (operator's felt bar) / 30+ day unattended (autonomy mandate).

---

## 2. Scope

### In scope
- A standalone nightly watcher (3:00–9:00, operator local wall-clock) that samples tower resources, detects contention, and self-skips when the tower is busy.
- An operator pause/skip switch (DB-backed), CLI-flippable tonight, Office-card-driven at next deploy.
- A deterministic verdict engine with **pre-registered, versioned thresholds** (`soak_thresholds_v1`).
- A permanent nightly ledger + a plain-English morning report.
- Two Slumhouse Office cards: a **Soak Switch** control card, and a **Soak Report** card floating in the Reporting Room magic-ball stage alongside the GPT-5 night-agent reports.

### Out of scope (YAGNI)
- The harness NEVER fixes anything. Observe + record + alert only (mode-1 OBSERVE forever). Evolution = its evidence *aims* a human-directed fix wave.
- No new trading logic, no promotion-gate wiring (a future wiring of the verdict into a go-live gate is a separate, ratify-packet-gated change — see §12).
- No LLM/AI in the measurement loop. Pure arithmetic (linear fit, threshold compare). Deterministic in → deterministic out.
- No cloud dependency. All local.

---

## 3. Core principle — doer ≠ grader, at the process level

The measurer must not be the measured. The watcher is a **standalone process**, external to `TradingForgeAPI`. Consequences:
- It survives a backend crash **and records it** (a 4am crash under quiet load is the single most valuable finding a soak can produce; an in-backend monitor dies with the patient and the night goes blank).
- It sees ollama + python workers + discord bot + relay from the OS, not just the backend's self-report.
- It needs no backend restart to land tonight.

It cross-checks against the backend's OWN self-report (`resource-tracker.ts` → `subsystem_metrics`) as an independent second data path: agreement → trust the curve; divergence → that is itself a finding.

---

## 4. Architecture — Approach C (external watcher + free cross-check)

```
Windows Task Scheduler ── 3:00 AM ──▶ soak-watcher (standalone Node process)
                                         │
              ┌──────────────────────────┼───────────────────────────┐
              │ every 30s, 3:00→9:00                                  │
              ▼                          ▼                            ▼
      OS sensors                  Backend probe               Cross-check
      Get-Process (RSS,           GET /api/health             SELECT from
      handles, PID, start)        (alive?, latency,           subsystem_metrics
      nvidia-smi (VRAM, GPU%)     backtestConcurrency.active) (backend self-RSS)
      disk free                          │
              └──────────────┬───────────┴────────────┐
                             ▼                         ▼
                   append JSONL (incremental,   contention guard: any
                   crash-survivable)            backtest active / GPU busy /
                             │                  switch=skip → ABORT → INVALID
                             ▼
                    9:00 AM: verdict engine (linear fit + frozen thresholds)
                             │
              ┌──────────────┼───────────────────────────┐
              ▼              ▼                             ▼
     JSONL raw (90d prune)   audit_log row (v1)           Discord pill 9am
                             soak_runs row + SSE (v2)      + Office cards (v2)
```

### Component map
| Component | v1 (tonight, restart-free) | v2 (next deploy) |
|---|---|---|
| `scripts/soak-watcher.cjs` | standalone Node, direct `postgres` client (mirrors `real-tf-burn-today.cjs` pattern) — sampling loop + verdict | unchanged |
| Contention guard | reads `GET /api/health` + `nvidia-smi` | unchanged |
| Switch | `system_parameters` rows `soak_mode` / `soak_skip_until`, flipped via `scripts/soak-skip.cjs` CLI (direct DB, no route) | Office card → slumhouse admin route → same rows |
| Ledger | JSONL on disk + `audit_log` insert (table already exists) | + `soak_runs` table (migration) |
| Report | Discord message 9am | Reporting Room card + Switch card + SSE |
| Scheduler | `schtasks` one-time 3am daily trigger | unchanged |

**Why v1 is restart-free:** the watcher is a new process; it only *reads* `/api/health` over HTTP and *inserts* into the already-existing `audit_log`. No backend code changes, no migration, no NSSM restart → the running extraction/backtest campaign is untouched. The migration (`soak_runs`) + route + frontend cards require a deploy and therefore land at the next natural backend restart, after the campaign finishes.

---

## 5. The watcher — sampling loop

One process starts at 3:00, loops every 30s until 9:00 (~720 samples), then computes + writes + exits. Incremental JSONL append means a watcher crash leaves partial data + no final row → auto-classified INVALID.

**Per-sample photo:**
| Field | Source | Detects |
|---|---|---|
| per-process RSS + handle count (API, ollama, python, discord, relay) | `Get-Process` (OS — cannot be self-lied) | memory leak; handle/FD leak |
| VRAM used / GPU util % | `nvidia-smi --query-gpu=...` (same call `resource-tracker.ts` already uses) | orphan-VRAM-wedge (8 GB is the scarce resource) |
| disk free / DB size | OS + one SQL query | days-to-full |
| backend alive + latency | `GET /api/health` | degradation; crash |
| PID + start time | `Get-Process` | silent crash-respawn |
| backend self-RSS | `subsystem_metrics` latest | cross-check |

---

## 6. Contention guard + switch semantics

**Two independent layers — machine detects load, operator declares intent:**

1. **Auto-guard (machine).** At 3:00 startup AND every 5 min mid-run, check:
   - `GET /api/health` → `backtestConcurrency.active > 0` → busy
   - `nvidia-smi` GPU util sustained above `SOAK_GPU_BUSY_PCT` (default 25%) over ~1 min → busy
   - Any heavy non-idle python/backtest worker present → busy
   Busy at startup → **SKIP** (log one line, exit). Busy mid-run → **ABORT** → INVALID.

2. **Operator switch (intent).** `system_parameters.soak_mode` ∈ {`armed`, `off`} and `soak_skip_until` (timestamp). Watcher reads at startup + every 5 min:
   - `off` → don't run at all.
   - `soak_skip_until` in the future → skip tonight, auto-rearm after.
   - Tap mid-run → graceful ABORT → INVALID.

**Honesty guarantee:** SKIP and INVALID never touch the green streak. The streak can only be padded by nights that were genuinely quiet AND genuinely clean. This is what makes the streak usable as go-live evidence.

**Baby-mode boundary (stated because it's load-bearing):** the auto-guard detects *visible activity at the check instant*. A session idle at 3:00 that fires its next unit at 3:10 looks quiet — the switch covers exactly that gap. Mid-run re-checks are the net under both layers.

---

## 7. Verdict engine — pre-registered thresholds (`soak_thresholds_v1`)

**Calibration phase (nights 1–~14): UNGRADED.** Collect only; establish the tower's real noise band (Node's GC sawtooth alone wanders hundreds of MB). Pills stay grey ("CALIBRATING n/14"). Grading begins only after the ruler is calibrated. The streak cannot start until then.

**Per-metric grade (after calibration):**
| Metric | 🟢 GREEN | 🔴 RED | Method |
|---|---|---|---|
| Memory (per process) | projects **< 1 GB** / 30d | projects **> 4 GB** / 30d | linear fit over 720 samples → ×720h; grade only if slope's confidence band excludes the calibrated noise floor (else = flat = GREEN) |
| VRAM | floor returns to baseline | floor ratchets ↑ with no load | low-water mark trend |
| Disk | **> 30 days** headroom | **< 14 days** headroom | growth rate → days-to-full |
| Restarts | 0 | ≥1 crash-respawn under quiet load | PID/start-time change |
| Heartbeat | answered every min | any gap > 2 min | `/api/health` poll history |

**Night verdict = worst metric.** All 🟢 → 🟢. Any 🔴 → 🔴. Any invalidating condition → 🟠 INVALID.

**Operator-set risk dial (defaults accepted):** memory **4 GB/30d** RED, disk **14 days** RED. Everything else mechanical.

**Anti-goalpost:** thresholds are versioned (`soak_thresholds_v1`) and frozen before the first graded night. Any post-calibration change is a dated, logged, versioned event — never a silent nudge.

---

## 8. Evolution loops (how the data is used)

| Loop | Trigger | Action |
|---|---|---|
| Overnight | RED night | diff last-GREEN build SHA vs last-night SHA → the commits between are the suspect list → aimed fix wave in a worktree. **Next night re-certifies from zero** (doer≠grader). |
| Weekly | ~14 nights of data | re-baseline thresholds to the measured noise floor — versioned, logged. |
| Continuous | AMBER drift | non-RED creep (handles +2%/night, 2 silent respawns/week) → ranked hardening backlog before it's an incident. |
| Strategic | go-live decision | "N consecutive GREEN nights across M builds" → a line in the ratify packet. v2: `pre-vacation-preflight` gains a "last 7 nights GREEN?" check. |

---

## 9. Persistence

- **JSONL raw** — one file per night in the gitignored data dir, incremental append, ~90-day prune. Forensics only.
- **`audit_log` row (v1)** — `action: "soak.night_completed"` with the condensed verdict payload (build SHA, per-metric slopes/verdicts, sample count, outcome). Tiny, permanent, already-existing table.
- **`soak_runs` table (v2)** — first-class row per night (migration; `migration-author` skill governs). Feeds the Office cards. Append-only, immutable.
- **Ledger line** (derived): `2026-07-12 | RAN | build a3f9c21 | API rss:+1.2MB/h±0.8 | vram floor 412MB ✓ | disk 94d | restarts 0 | 🟢`.

---

## 10. Office cards (v2)

### 10a. Soak Switch (control card, Office main surface)
- Primary action **Skip Tonight** (amber "rearms 9:00 AM"); always self-rearms — cannot accidentally kill the instrument for weeks.
- **OFF** exists but two-tap confirm + persistent amber "dormant" badge (a dormant instrument must *look* dormant).
- 7-dot engagement strip: 🟢 ran / ⚪ skipped / 🟠 didn't count / 🔴 problem.
- Mid-run tap = graceful abort → INVALID.
- Wiring: glassy card → slumhouse admin route (admin-session cookie) → `system_parameters` rows. Same rails as the phone-tappable kill switch.

### 10b. Soak Report (Reporting Room magic-ball stage)
- First-class "matter" on the existing stage (`office.html` `RR_STATE`), same 3D thin-premium treatment as the GPT-5 trade reports, same rotation. Picker chip shows the night pill (`🟢 Tower Soak · Jul 12`) where trade reports show a letter grade.
- 4 plain-English verdict lines (memory / VRAM / disk / restarts) + 14-night sparkline + "read the full story".
- **Only RAN / INVALID / RED nights post a card.** Skipped nights live on the switch strip — the stage stays premium.
- Tower-level (shows regardless of account tab).
- Publish pattern mirrors `nightly-critique-service`: SSE event + `system_parameters` latest-summary.

---

## 11. Error handling — fail-closed matrix

| Condition | Behavior |
|---|---|
| Backend unreachable at 3:00 | log "backend unreachable" (itself a finding), Discord CRITICAL, stand down. No crash. |
| `nvidia-smi` absent/fails | VRAM metric = `unavailable` for the night (not a false RED); night still grades other metrics; note in report. |
| Watcher process crashes mid-run | partial JSONL + no final row → next-morning classification INVALID; audit "soak.watcher_incomplete". |
| DB write fails at 9am | retain JSONL, retry insert; if still failing, Discord CRITICAL — never silently drop the night. |
| Ambiguous / partial config on switch | fail-closed to `armed` default? NO — fail to **skip** (safer: never run under uncertainty), log. |
| Contention detected mid-run | ABORT synthetic load (never the system), mark INVALID. |

---

## 12. Isolation, ratify-packet, autonomy — skill determinations

- **§11b worktree isolation (HARD, fail-CLOSED):** a live campaign + many worktrees are on disk. ALL build work happens in a dedicated worktree pinned to an explicit base SHA (`worktree-session` skill). This spec is drafted in scratchpad; it is copied into `docs/superpowers/specs/` and committed **inside that worktree**, never into the shared tree the campaign uses (no `git add -A` on a shared tree). Land FF-only at the end.
- **`ratify-packet` determination:** building the harness does NOT touch INSTRUMENT code (backtester / gates / classifiers / extraction-fidelity / sizing) — it is net-new ops/observability tooling in the family of `resource-tracker` / watchdogs. Ratify-packet does NOT gate this build. **BUT** the day the verdict is wired into any promotion or go-live *gate*, that wiring IS a ratify-packet event (staged-not-started). Flagged for the future, not now.
- **`migration-author` skill:** governs the v2 `soak_runs` migration (idempotent, journal `when`, boot-migration BOM safety).
- **`autonomous-readiness`:** the harness itself must be autonomy-clean — Task Scheduler survives reboot (`schtasks` persists), watcher self-recovers, alerts are plain-English + family-grade. No new operator-babysitting introduced.
- **`grading-integrity`:** thresholds pre-registered + versioned before first graded night; doer≠grader enforced structurally (external process; next-night re-cert).

---

## 13. Testing strategy

- **Unit (vitest):** verdict engine is a pure function — feed synthetic sample arrays (flat / rising-slow / rising-fast / sawtooth-noise / VRAM-ratchet / crash-PID-change) and assert the exact pill. This is where "no bugs in the math" is proven.
- **Contention guard:** dependency-injected health/GPU readers (mirror `pre-vacation-preflight.ts` DI pattern) → assert SKIP/ABORT/RUN decisions without a real tower.
- **Switch semantics:** assert armed/off/skip-until/mid-run-abort transitions.
- **Dry-run mode:** `--dry-run` runs a compressed 3-min window (samples every 2s) so the operator can watch a full cycle produce a report on demand, without waiting for 3am.
- **Calibration guard test:** assert nights < 14 return CALIBRATING, never a graded pill.

---

## 14. Wiring verification checklist (to confirm against live code during implementation — "double-check the wiring")

1. `GET /api/health` JSON actually contains `backtestConcurrency.active` (documented §14b — confirm exact path + that it reflects the campaign's runs).
2. `system_parameters` schema (column names / value type) for the switch rows; confirm the kill-switch/learning-loop reader pattern.
3. `audit_log` insert shape from a standalone `postgres` client (mirror `real-tf-burn-today.cjs`).
4. `subsystem_metrics` latest-row query for the cross-check.
5. Reporting Room render hook: exact `RR_STATE.reports` shape + how a non-trade "matter" is injected into the stage rotation.
6. SSE event registration point + naming convention (mirror `nightly:review-complete`).
7. slumhouse admin route + admin-session-cookie pattern for the switch card (v2).
8. `nvidia-smi` availability + exact query string parity with `resource-tracker.ts`.
9. Confirm tower hardware constants (32 GB RAM, RTX 5060 8 GB VRAM) for the projection headroom math.

---

## 15. Confirmed decisions
- Approach **C** (external watcher + backend self-report cross-check). ✅
- **Tonight-capable v1** (restart-free), Office cards + `soak_runs` + route at next deploy. ✅
- Risk dial defaults accepted: memory **4 GB/30d** RED, disk **14 days** RED. ✅
- Two cards: Switch (control, Office main) + Report (Reporting Room stage). ✅
- Observe-only forever; never self-fixes. ✅

## 16. Open items (resolve in plan)
- Operator local timezone for the 3:00/9:00 `schtasks` trigger (assumed operator wall-clock; confirm).
- Exact JSONL data-dir path (gitignored) + prune cadence.
- v1 switch CLI ergonomics (`scripts/soak-skip.cjs --tonight` / `--off` / `--arm`).
