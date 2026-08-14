# Current-main integration baseline — 2026-08-14

## Scope and boundary

This is a read-only prerequisite receipt for future reviewed integration packets. It maps the current overlap among `origin/main`, H1, and the GPT rulings branch. It does not integrate either branch.

- Integration branch: `codex/continuous-main-integration-20260814`
- Branch HEAD: `64bd430810dc73e4206f8221792c922364eeec0f`
- `origin/main`: `64bd430810dc73e4206f8221792c922364eeec0f`
- H1: `origin/h1-wave4-sealed12-driver` at `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`
- GPT: `origin/external-advisor/gpt-rulings` at `c2706a0c1fc84d047eed96a4691c0daae0e4f7b4`

The branch exactly matched `origin/main` after `git fetch --prune origin`; no rebase or branch movement occurred.

No merge, cherry-pick, production deployment, Topstep authentication, live API call, or order activity occurred. Paid TopstepX access is unavailable and remains outside this receipt.

## Collision map

The machine-readable source is [2026-08-14-codex-current-main-collision-map.json](2026-08-14-codex-current-main-collision-map.json). Changed-file lists use `git diff --name-only --no-renames <pair-merge-base> <ref>` and overlaps are sorted set intersections.

| Comparison | Merge base | Changed files (left / right) | Overlap | Critical overlap |
| --- | --- | ---: | ---: | ---: |
| main ↔ H1 | `a9d7a71a56f375ca79a89663c6685e2ce44d2331` | 1350 / 1755 | 43 | 27 |
| main ↔ GPT | `a9d7a71a56f375ca79a89663c6685e2ce44d2331` | 1350 / 1700 | 21 | 12 |
| H1 ↔ GPT | `849ad1398fd628a0c65ee0f5050eed6c0db72395` | 372 / 297 | 13 | 2 |

Highest-risk overlap is main ↔ H1: the backtester surface includes `src/engine/backtester.py`, fill/compliance/skip/survival modules, multiple engine tests, and the candidate-backtest conveyor/service; it also intersects `lifecycle-service.ts`, `src/server/db/schema.ts`, and the Topstep compliance test. Main ↔ GPT independently overlaps the core backtester and compliance/audit surfaces. H1 ↔ GPT has smaller overlap, but includes `src/engine/extraction/spec_producer.py` and a realized-lifecycle ruling.

## Required re-test for any future accepted packet

Before integration, recompute this map using the exact source SHAs; compare semantic changes in every critical-overlap file; then run the targeted TypeScript/Python tests for the touched authorities, `npm run build`, `npm run check:production-isolation`, `npm run check:2026-compliance`, and `npm run system-map:check`. A packet touching schema or migrations also requires migration ordering/idempotency verification. A packet touching the candidate-backtest conveyor or lifecycle requires the associated route/service tests and audit-transition evidence. The future receipt must distinguish offline adapter evidence from paid TopstepX/API, Practice, Combine, and funded/live evidence.

## Bounded validation evidence

| Command | Exit | Evidence |
| --- | ---: | --- |
| `git fetch --prune origin` | 0 | Remote refs refreshed; current branch HEAD matched `origin/main`. |
| `npm run build` | 0 | `tsc` completed successfully (20.4 s). |
| `npm run check:production-isolation` | 0 | `CLEAN — 5 file(s) checked, 0 violations.` |
| `npm run check:2026-compliance` | 0 | `OK — MFFU + Topstep aligned with canonical 2026 docs`. |
| `npm run system-map:check` | 0 | `status: ok`; 80 routes, 112 scheduler jobs, 20 workflows, 29 engine subsystems, 116 database tables, 74 registry subsystems. |

No narrow pre-existing test directly tests a documentation-only collision receipt in current main, so no broad suite was run. The required build and integrity gates above are the bounded baseline evidence. `git status --short` was clean after the checks: no timestamp-only audit artifact required restoration.
