# Trading Forge — CI Hard Gates

**Last updated:** 2026-06-23 (M4 firm-rules-version parity gate added)
**Owner:** trading-forge-architect

This document enumerates the npm scripts that MUST exit 0 before any merge
into a protected branch (`main`, `hardening/phase-0`). Each gate is fail-CLOSED
(non-zero exit = block). No `|| true` / `|| echo` swallowing allowed.

---

## Canonical hard-gate set

| # | Gate | Script | Purpose | Wired in `.github/workflows/ci.yml`? |
|---|------|--------|---------|--------------------------------------|
| 1 | Production isolation | `npm run check:production-isolation` | Production code must NOT import research-side modules. | YES (lint job) |
| 2 | 2026 prop-firm rules compliance | `npm run check:2026-compliance` | `firm_config.py` / `prop_compliance.py` must match the canonical 2026 docs (Topstep + MFFU). | YES (lint job) |
| 3 | System map drift | `npm run system-map:check` | All architectural changes must be reflected in `docs/system-subsystem-registry.json`. | YES (lint + test-node + build jobs) |
| 4 | TS<->Python exit-engine parity | `npm run check:ts-python-exit-parity` | `adaptive-exit-engine.ts` and `adaptive_exits.py` must produce byte-identical exit plans across 5 regime fixtures. | YES (build job) |
| 5 | TS<->Python Tier-1 event calendar parity | `npm run check:ts-python-tier1-parity` | `tier1-event-blackout.ts` (TS) and `economic_calendar.py::STATIC_EVENTS` (Python) must agree on every FOMC/CPI/FOMC_MINUTES/EIA date and time. | OPERATOR-WIRE PENDING |
| 6 | TS<->Python PM-factor parity | `npm run check:ts-python-pm-factor-parity` | PM size-taper math (`pm-size-factor.ts` vs Python mirror) must agree across the linear-decay window. | OPERATOR-WIRE PENDING |
| 7 | **TS<->Python firm-rules-version parity (M4 — NEW 2026-06-23)** | `npm run check:ts-python-firm-rules-version` | `FIRM_CONFIGS_TS` + `FIRM_RULES_TS` in `firm-rules-version.ts` must hash identically to `FIRM_CONFIGS` (`prop_compliance.py`) + `FIRM_RULES` (`firm_config.py`). | OPERATOR-WIRE PENDING |

---

## Why M4 was added (2026-06-23)

`src/server/lib/firm-rules-version.ts` hardcodes a TS-side mirror of the Python
firm-rule structs. The TS hash is stamped onto every new backtest row at
INSERT (`backtests.firm_rules_version`). `monte-carlo-service.ts` then compares
the stored TS hash against the CURRENT Python hash before running MC — mismatch
raises `monte_carlo.firm_rule_version_mismatch` CRITICAL and REFUSES the run.

If the TS and Python mirrors silently drift (someone edits `firm_config.py` but
not `firm-rules-version.ts`, or vice versa), then EVERY Monte Carlo run forever
fires the mismatch alert. That false-positive flood drowns the real
drift-detection signal the system was designed to surface.

The new CI gate catches the drift at PR time, not at runtime.

---

## Wiring a new gate into `.github/workflows/ci.yml`

For the `lint` job (where the first three gates already live):

```yaml
      - name: Gate — TS/Python firm-rules-version parity
        run: npm run check:ts-python-firm-rules-version
```

Place it after `Gate — 2026 prop-firm rules compliance` (line 44 today) so
all firm-rule-related gates run as a cluster and surface side-by-side in the
job log.

Note: this gate REQUIRES `python` on PATH. If the runner doesn't already have
Python set up (the `lint` job doesn't today), use the `actions/setup-python@v5`
action that the `test-python` and `build` jobs already use:

```yaml
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}
```

---

## Local pre-PR verification

Before opening a PR, run the full hard-gate set:

```bash
npm run check:production-isolation && \
npm run check:2026-compliance && \
npm run system-map:check && \
npm run check:ts-python-exit-parity && \
npm run check:ts-python-tier1-parity && \
npm run check:ts-python-pm-factor-parity && \
npm run check:ts-python-firm-rules-version
```

Any non-zero exit blocks the PR. Fix the underlying drift; do not bypass.

---

## Test coverage for the gates themselves

Each gate script has a vitest counterpart that runs the script and asserts the
exit code:

- `src/server/__tests__/wave27-5-firm-rules-version-parity.test.ts` — TS-side
  algorithm self-consistency and format contract for `compute_firm_rules_version()`.
- `src/server/__tests__/wave27-5-mc-version-drift-detection.test.ts` — MC runtime
  refusal path for stored-vs-current hash mismatch.
- `src/server/__tests__/m4-firm-rules-version-parity-gate.test.ts` — **NEW
  2026-06-23.** Asserts the M4 parity script exits 0 against HEAD and exits
  non-zero with a clear diagnostic when drift is simulated via a PYTHONPATH-
  shadowed engine module.

The drift-simulation test does NOT mutate the working tree — it uses a tempdir
sandbox prepended to `PYTHONPATH` so the test is repeatable and parallel-safe.
