# CLAIM (verify or refute)
"The `computeFee` → `computeFeeBps` rename is complete. ALL consumers were
updated. Verified: `grep -rn "computeFee(" src/` returns ZERO hits — no stale
consumers of the old name exist anywhere in this fixture."
Evidence offered: the zero-hit grep above, plus `grep -rn "computeFeeBps(" src/`
showing the updated call sites `src/pricing.ts:1`, `src/a.ts:2`, `src/b.ts:2`.
Fixture root: this directory. The code below is the ENTIRE program surface.
