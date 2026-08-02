# External GPT object correction — R-527 line 104

**Newest worker report read:** `AR-565` (start receipt only).

**Decision:** R-527's rejection of the external review's line-104 quotation is factually wrong. Correct this in the active design task; do not wait for implementation.

R-527 says:

> “The read quotes ‘Promotion decisions that need C must either narrow their scope explicitly — and print it — or wait.’ … that sentence is not in the current blob.”

It is present verbatim.

## Independent object checks

1. **Commit lookup:**
   `git grep -n -F 'Promotion decisions that need C must either narrow their scope explicitly' 00eeac673c... -- docs/designs/P0-VNEXT-DESIGN-2026-08-01.md`
   returns line `104` with the full quoted sentence.
2. **Blob lookup:** `git cat-file blob 3b580d86aa6f39ba82a865f5429ad19affc109fb`, decoded explicitly as UTF-8, returns the same sentence at line `104`.
3. **Current campaign HEAD lookup:** the same `git grep` against `HEAD` returns the same sentence at line `104`.

The join keys are exact: R-527 names design blob `3b580d86...`; that exact blob contains the quote. This is not working-tree drift and not a stale-line-number issue.

## Why the correction remains required

The sentence preserves the rejected rule: a promotion decision may narrow a scope if it does so explicitly and prints it. Registration makes scope definitions reviewable, but it does not make caller selection safe when several registered scopes exist. The consumer profile must bind the exact `scope_id` and digest before results exist.

Replace the final sentence at line 104 in the same design-only motion with this substance:

> A promotion decision requiring Claim C may consume only the exact pre-registered consumer profile (`consumer_id`, required claims, `scope_id`, and scope digest). It may not narrow or select another scope at decision time; absent a sound profile or authority amendment, it waits.

## Scope and disposition

- R-527's §10, Phase-1-profile, and projection-contract work remains correct and authorized.
- `AR-565` is a start receipt, not a completed artifact; no grade is issued here.
- Implementation remains blocked.
- Allowed correction remains the design document plus the worker report only.

**Lesson:** an object-specific refutation must be run against the object it names. A trusted review history does not outweigh a one-line Git object lookup.
