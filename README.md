# Trading Forge — operating doctrine

**This directory IS the canonical copy. It is not a backup of something else, and
nothing is a backup of it.** That is deliberate: a second copy of doctrine drifts
silently from the first, and a drifted rulebook is worse than an unversioned one
because it looks authoritative.

Versioned here:

| path | what it is |
|---|---|
| `skills/` | the campaign's operating procedure — onboarding, ruling gates, packet discipline, debugging playbooks |
| `agents/` | subagent definitions, including **`accuracy-validator`**, the project's independent grader |
| `hooks/` | enforcement (e.g. the ruling mechanism / stale-premise guards `advisor-ruling` relies on) |
| `commands/` | slash commands |

Everything else under `.claude/` is **deny-by-default ignored** — see `.gitignore`.
Session transcripts and seat memory (`projects/`) are excluded as private and
large; `settings*.json` are excluded because they may carry tokens; `worktrees/`
are checkouts of a *different* repository and must never be nested here.

## Why this exists

Until 2026-07-29 this directory was **disk-only with no backup** — a single
mechanical failure would have taken the entire campaign's operating doctrine with
it. It was flagged in `ADVISOR-STATE.md` for weeks and never actioned, because
"back it up" reads like a chore rather than a risk.

The same day surfaced the sharper reason: **`ratify-packet` demanded an
"independent grader" seven times and never named one**, so a whole advisor session
invented answers ("the advisor seat", "a fresh session") instead of dispatching
the `accuracy-validator` agent that already existed. Doctrine that is unversioned
is also doctrine nobody audits — you cannot diff what has no history.

## Working rules

- **Edit in place.** There is no other copy to update.
- **Never `git init` a second copy of this elsewhere.** If you want it on another
  machine, clone this branch; do not duplicate the directory.
- **Before adding a new path to `.gitignore`'s allow-list, re-run a secret scan.**
  The four tracked directories were scanned clean on 2026-07-29 (env-var *names*
  and `$VAR` placeholders only — no literal credentials).
- **`.claude/` has no parent git repository** (the `Projects/trading-forge/`
  container is not a checkout), so this repo stands alone by design.
