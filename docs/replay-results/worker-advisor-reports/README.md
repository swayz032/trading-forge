# Worker advisor reports — canonical landing location

**Authority:** AR-1274 §6 + §9D (establish automatic worker-report landing; no operator relay).

This directory is where **Worker-1 reports land**, on the active Worker branch, inside the
worker's governed write scope.

## Why this directory exists

Worker reports were expected on the GPT branch under `advisor-reports/`. The bound Worker-1
edit scope does not permit that path or that branch, so AR-1272 landed under
`docs/replay-results/` and the operator became the relay.

AR-1274 §6 forbids that outcome:

> Do not solve this by asking Tonio to copy/paste or relay reports.

So the landing location moved **into** the governed scope rather than the write permission
moving out of it. The worker does not need arbitrary write access to the GPT branch merely to
report its work.

## The contract

| | |
|---|---|
| **Path** | `docs/replay-results/worker-advisor-reports/` |
| **Branch** | the active Worker branch (currently `claude/worker1-h1-20260815`) |
| **Filename** | `AR-<number>-<UPPER-KEBAB-SLUG>-<YYYY-MM-DD>.md` |
| **Newest** | highest **numeric** AR, resolved by `scripts/worker-report-latest.mjs` |
| **GPT rulings** | stay on `origin/external-advisor/gpt-rulings` — unchanged |

## Discovery

```bash
node scripts/worker-report-latest.mjs           # newest report path, exit 0
node scripts/worker-report-latest.mjs --json    # machine-readable receipt
node scripts/worker-report-latest.mjs --list    # all reports, newest first
```

It **refuses with exit 1** when the directory is absent or holds no AR-shaped report. An empty
stdout with exit 0 would read as "no reports, and that is fine" — the false-green shape this
campaign keeps convicting.

⚠ **Ranking is numeric, not lexical.** `AR-999` sorts *above* `AR-1275` lexically because
`'9' > '1'`. This campaign is past AR-1200, so every comparison against a 3-digit AR would
silently pick the wrong file while looking correctly sorted.

⚠ **Corrections take the next integer AR number, not a suffix** (AR-1276 §2). The helper matches
`AR-<integer>-…`, so a suffix form such as `AR-1275A` is invisible to it until the helper is
deliberately extended.

### Non-AR documents in this directory

Files that are not `AR-<number>-…` are **ignored by the helper on purpose** — they are not worker
reports and must never be returned as "the newest report". Current convention:

| Prefix | Meaning |
|---|---|
| `AR-<n>-…md` | a worker report; discoverable; ranked numerically |
| `HANDOFF-…md` | a routing brief handing a packet to a different authorized seat |
| `HELLO-<worker_id>-<session_instance_id8>-<date>.md` | peer session handshake opener — worker-onboarding SS2b |
| `ACK-<worker_id>-<session_instance_id8>-<date>.md` | peer session handshake acknowledgement — worker-onboarding SS2b |
| `README.md` | this contract |

HELLO/ACK are deliberately non-AR: they fire every fresh session, not every engineering result, and
numbering them into the AR sequence would interleave routine protocol noise with substantive
reports. `scripts/peer-handshake-guard.mjs` validates their content; this directory only carries
the files.

## What this is not

- Not a publisher and not a branch-crossing tool — it answers *which report is newest*, nothing more.
- Not a second authority on report content. The report body still owes everything onboarding
  requires: grading pin, branch, toolbox pin, tests, artifacts, frozen-state evidence, CI status.
- Not a replacement for the GPT branch as the home of GPT rulings.
