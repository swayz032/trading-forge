# AR-1128 (worker) — **ORDER B COMPLETE** at `c3713ea0`. TypeScript transports the role carrier and authors nothing. **PLUS AN ADJACENT FINDING: `source_risk` IS DROPPED AT THE SAME BOUNDARY.**

**Seat:** Claude Code worker · **Date:** 2026-08-13
**Governing ruling:** AR-1125 §7.3 (B) · R1 still stopped pending **AR-1126**
**Engineering head on origin:** `c3713ea0` (impl `93fe04c1` + inventory regen)

---

## 1. WHAT LANDED

`SpecArtifactBody` gains `source_timeframe_roles?`, and `parseSpecArtifact` carries it through a new `parseSourceTimeframeRoles()` — **a structural firebreak only**.

**Why this was needed at all, re-measured:** `parseSpecArtifact` rebuilds `spec` from a **fixed key literal**. A field absent from that literal is **silently dropped before persistence**. Adding the carrier to the Python output alone would have produced a correct artifact whose carrier **died at the TS boundary with nothing raising** — your §2.4 in AR-1119, confirmed here by reading the constructor.

    `A TRANSPORT LAYER THAT REBUILDS ITS PAYLOAD FROM A FIXED KEY SET IS A FILTER
     WEARING A PARSER'S NAME.`

**The firebreak checks SHAPE and REFUSES rather than repairs:** exact schema string `SOURCE_TIMEFRAME_ROLES/1` · `bindings` must be an array · every binding field a non-empty string · role inside the closed set mirrored from `source_timeframe_roles.py`. **A malformed envelope yields `undefined`, never a patched one** — a carrier TypeScript "fixed" would arrive downstream **indistinguishable from a taught one**.

**TypeScript authors nothing.** No timeframe choice, no grade upgrade, no filling a missing role, no `recoverSpecTimeframe()`, no confidence-0.4 backfill, no `strategy.timeframe` / `trigger_tf`. A test asserts that an artifact carrying **both** the legacy scalar `timeframe='1m'` **and** the confidence-0.4 recovery metadata still yields **no roles** — neither may rescue a missing carrier (your §3.5 negative controls, as a live test rather than a promise).

---

## 2. RED PROOF

Your AR-1119 §3.4 asks for exactly this: **delete the transport line from `parseSpecArtifact` → the 2 transport tests FAIL while the 10 firebreak/legacy tests stay GREEN.** They discriminate rather than failing the file. Restored **12/12**.

**Regression:** 35 vitest tests pass across `spec-onboarding-service`, `source-risk-contract` and this suite. `tsc --noEmit` clean.

---

## 3. 🛑 ADJACENT FINDING — `source_risk` DOES NOT SURVIVE THE SAME BOUNDARY

While reading the parser I checked the nearest precedent and found it broken.

`source_risk?: SourceRiskContract` is **declared** on `SpecArtifactBody` (AR-1059 §4) — and it is **NOT in the parser's key literal**. `parseSpecArtifact` therefore drops it, exactly as it would have dropped the role carrier.

**Control:** the adjacent optional field `framework_overlay` **is** transported, at the neighbouring line, by the same probe. So this is a real asymmetry, not a failed search.

⚠️ **WHAT I AM NOT CLAIMING:** I have **not** traced whether `source-risk-contract.ts`'s consumer (`spec?.source_risk`) is fed from the parsed artifact or from a raw DB `compiled_spec` read. **If it reads the raw persisted config, the contract may be perfectly alive** and only the parsed-artifact path lacks it. **I am reporting that at this boundary it does not survive — not that the contract is dead.** Yours to price; I did not fix it, because it is outside B's scope and I am not opening a lane you did not authorize.

---

## 4. STATUS

| Item | State |
|---|---|
| A1b stale-prose cleanup | ✅ COMPLETE (`f9eba98e`) |
| C1 role binding | ✅ COMPLETE, red-proofed (`a37f6329`) |
| **B TypeScript transport** | ✅ **COMPLETE, red-proofed** (`c3713ea0`) |
| D direct 5m supplier | ⬜ NOT STARTED |
| R1 certification | 🛑 **STOPPED** — decision open in **AR-1126** |
| §9.2 | 🔴 OPEN, NOT CLAIMED |

**DISCLOSURES:** one hop only — the DB save/reload half of your §6.B chain is **NOT** proven here; I tested the parser boundary, not a round-trip through the database, and I say so rather than let "transport" imply persistence · role values in tests are **SYNTHETIC** and labelled · no grader · no market data · no backtest · no trade · nothing dispatched, nothing certified · the broader extraction surface from AR-1126 remains **UNENUMERATED**.

**AR-1126's decision remains the blocker for R1.** D is record-independent and is next unless you redirect.
