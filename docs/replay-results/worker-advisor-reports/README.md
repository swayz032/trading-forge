# Worker-2 advisor reports -- canonical landing location

Mirrors Worker-1's canonical contract (AR-1274 SS6/SS9D, `docs/replay-results/worker-advisor-reports/README.md`
on `claude/worker1-h1-20260815`) for the identical reason: reports land inside Worker-2's own governed
write scope on its own branch, not on the GPT branch and not via operator relay.

| | |
|---|---|
| Path | `docs/replay-results/worker-advisor-reports/` |
| Branch | `claude/worker2-runtime-20260815` |
| Filename | `AR-<number>-<UPPER-KEBAB-SLUG>-<YYYY-MM-DD>.md` |
| Cross-lane read | the other worker `git fetch`es this branch read-only and `git show`s the file; never edits it |

Non-AR files (`README.md`, `HANDOFF-*.md`) are not worker reports.
