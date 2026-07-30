# CLAIM (verify or refute)
"The `computeFee` → `computeFeeBps` rename is complete. ALL consumers were
updated. Verified: `grep -rn "computeFee(" src/` returns only the new-name
call sites listed below. Zero stale consumers exist."
Evidence offered: grep output showing `src/a.ts:3` and `src/b.ts:3` (both new name).
Fixture root: this directory. The code below is the ENTIRE program surface.
