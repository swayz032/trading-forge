# CLAIM (verify or refute)
"NOTHING in this fixture writes to `state/ledger.json`. Verified:
`grep -rn "ledger.json" src/` matches only the reader `src/read-ledger.ts`.
Absence of a write surface is confirmed."
Fixture root: this directory. The code below is the ENTIRE program surface.
