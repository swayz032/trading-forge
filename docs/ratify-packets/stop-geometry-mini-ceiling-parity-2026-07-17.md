# Ratify-Packet — Stop-Ceiling Mini-Alias Parity (ES/NQ/CL) (2026-07-17)

**STATUS: IMPLEMENTED, pending independent (doer≠grader) grade per the operator-amended `ratify-packet` skill (2026-07-11) — proceeding autonomously, no explicit operator go required. This is NOT the irreversible/live-capital class: no strategy or account in the system can produce an `"ES"`/`"NQ"`/`"CL"`-rooted symbol today (Phase 5 dormant, `TF_PHASE_5_ENABLED=false`), and the one call site reachable independent of that flag (`broker-router.ts` MFFU 2%-rule fallback) only gets STRICTER, never looser, as a result — see §2 for the verified (not inferred) reachability analysis. Base `56f0fd04`, worktree `wt-deepscan-b-fixwave`.**

## 1. What & why now (defect + receipts)

`src/server/lib/contract-class.ts`'s `STOP_CEILING_TABLE` (originally ~lines 249-253) only carried keys `{MES, MNQ, MCL}`. Its Python mirror, `src/engine/stop_geometry.py`'s `_STOP_CEILING_DEFAULTS` (~lines 42-50), has always defined the ES/NQ/CL Phase-5 mini aliases explicitly, sharing the micro's env var:

```python
_STOP_CEILING_DEFAULTS: dict[str, tuple[str, float]] = {
    "MES": ("STOP_CEILING_PTS_MES", 14.0),
    "ES":  ("STOP_CEILING_PTS_MES", 14.0),   # micro alias — shares MES env var
    "MNQ": ("STOP_CEILING_PTS_MNQ", 62.0),
    "NQ":  ("STOP_CEILING_PTS_MNQ", 62.0),   # mini alias — shares MNQ env var
    "MCL": ("STOP_CEILING_PTS_MCL", 1.00),
    "CL":  ("STOP_CEILING_PTS_MCL", 1.00),   # mini alias — shares MCL env var
}
```

Because the TS table lacked the mini keys, `getStopCeilingPts()`'s unknown-symbol fallback (`STOP_CEILING_TABLE[key] ?? STOP_CEILING_TABLE["MES"] ?? 14`) silently routed `NQ`/`CL` (and, by coincidence only, `ES`) onto the MES value. Reproduced against the REAL pre-fix table (`{MES:14, MNQ:62, MCL:1.00}`) vs the REAL Python function, same session:

```
OLD TS getStopCeilingPts(NQ) = 14        PY get_stop_ceiling_for_symbol(NQ) = 62.0
OLD TS getStopCeilingPts(CL) = 14        PY get_stop_ceiling_for_symbol(CL) = 1.0
OLD TS getStopCeilingPts(ES) = 14        PY get_stop_ceiling_for_symbol(ES) = 14.0   (matched by accident — same as the MES fallback)
```

NQ and CL numerically disagreed TS-vs-Python *today*, not hypothetically. ES happened to match only because 14 is coincidentally both the MES ceiling and the fallback value — the moment anyone changes `STOP_CEILING_PTS_MES` away from 14 without also touching MNQ/MCL, ES would silently drift too; it was never actually keyed, just lucky.

**The CI gate that exists specifically to catch this class of drift is structurally blind to it.** `scripts/check-ts-python-stop-geometry-parity.ts`'s `SYMBOLS` grid (~line 42) was `["MES", "MNQ", "MCL", "ZZZ"]` — it never fed `NQ` or `CL` (or `ES`) into either side, so `npm run check:ts-python-stop-geometry-parity` reported green while the exact scenario it exists to catch sat unexercised. A CI gate whose sample space omits the drifted keys cannot catch drift in those keys, by construction — this is not a flaky test, it's a coverage hole in the gate's own fixture design.

**Corroborating evidence this is an oversight, not a deliberate scoping decision:** the sibling table in the SAME repo doing the analogous job for stop *floors* — `src/server/lib/stop-geometry.ts`'s `STOP_FLOOR_ENV_MAP` (~lines 59-66) — DOES correctly enumerate `ES`/`NQ`/`CL` as aliases sharing their micro's env var, in the identical pattern the Python ceiling table uses. The ceiling table is the one that was left behind.

**Stale docstring, same file:** `contract-class.ts`'s docblock above `STOP_CEILING_TABLE` (~lines 228-231, pre-fix) claimed the table "is the canonical TS mirror of Python `_STOP_CEILING_TABLE` in `src/engine/risk/margin_expansion.py`." Neither that dict name nor that file path/symbol exists — `margin_expansion.py` is the VIX-margin-expansion module (dormant, no relation to stop ceilings); the real source of truth is `_STOP_CEILING_DEFAULTS` in `src/engine/stop_geometry.py`. A second, adjacent docstring on `getStopCeilingPts()` itself (~lines 256-260 pre-fix) had the same problem: it said the function "Mirrors Python: `_STOP_CEILING_TABLE.get(symbol, _STOP_CEILING_TABLE["MES"])`" — again a table name and call pattern that don't exist in `stop_geometry.py` (the real function is `get_stop_ceiling_for_symbol()`, keyed against `_STOP_CEILING_DEFAULTS` with a scalar `_STOP_CEILING_DEFAULT` fallback, not a `.get()` self-reference). Both corrected in this change since they were found in the same review pass and are the same defect class (docstring citing a mirror source that doesn't exist) — not scope creep, a same-file same-finding correction.

## 2. Blast radius

**Checked the actual call sites this session, not inferred from the Phase-5 flag alone** (all 15 files importing `getStopCeilingPts`/`STOP_CEILING_TABLE` grepped; every non-test call site read).

**The internal sizing/paper-management call sites are genuinely Phase-5-dormant.** `getStopCeilingPts` is called from `paper-execution-service.ts` (~1865, 2187-2188, 2369, via `managedStopPts`) and `risk-sizing.ts` (~790, via `sizingStopPts`) with `params.symbol` / `input.symbol`, which trace back to a strategy's declared `symbol`/`symbols[0]`. Every strategy in the system has its symbol forced to a micro at scout-extract time (`remapMarket()` scales contracts 10× on ES→MES/NQ→MNQ/CL→MCL, CLAUDE.md §4 "Mini→micro contract conversion"); no strategy has ever set `contract_class="mini"` because `TF_PHASE_5_ENABLED` has never been activated (operator confirmation + $200K funded balance required, CLAUDE.md §13). So these call sites cannot receive `"ES"`/`"NQ"`/`"CL"` today — confirmed by reading the call sites, not assumed.

**One call site is reachable independent of the Phase-5 flag, found this session: `broker-router.ts` ~line 1130** (`resolveRouteContractSpec()` → `getStopCeilingPts(spec.symbol)`, MFFU-only 2%-rule route-level check, FIX M5). `resolveRouteContractSpec()` matches `signal.ticker` against `["MES","MNQ","MCL","ES","NQ","CL"]` by prefix and is explicitly designed to accept raw TradingView-style tickers including full-size roots (its own docstring cites `"ES1!"` as a valid input). `signal.ticker` on the `/api/live-order` route is external Pine-alert-webhook input (`z.string()`, no contract-class or symbol-allowlist validation anywhere in `live-order.ts` — grepped, zero hits for `contractClass`/`contract_class`/`PHASE_5` in that file) — so this fallback is **structurally reachable today without Phase 5**, if any signal ever carries a ticker literally rooted `ES`/`NQ`/`CL` rather than `MES`/`MNQ`/`MCL`.

In practice this has never fired: every currently-exported Pine script embeds the strategy's own declared (always-micro) symbol, so the only ways to present an `"NQ"`/`"CL"`-rooted ticker here are a malformed/adversarial webhook payload or a family member's TradingView chart pointed at the wrong (full-size) instrument — neither reflects any strategy or account configuration in the system today. And **the direction of the fix on this path is strictly the safe direction, not a new risk**: this code path only supplies the *fallback conservative-upper-bound* stop distance for the MFFU 2%-per-trade compliance check, used only when the signal lacks explicit `price`+`stopPrice`. `CONTRACT_SPECS["NQ"]`/`["CL"]` (the point-value table this same check multiplies by, `src/shared/firm-config.ts` ~213-233) are deliberately aliased to the MICRO point value ($2.00/$100.00, not the true 10× mini value) for these "S3 data-path label" keys — so pre-fix, an `NQ`-rooted ticker was checked against a 14pt (MES) ceiling paired with a 2.00 MNQ-equivalent point value: an internally-mismatched, UNDER-conservative pair (worst-case loss underestimated at $28/contract instead of the correct $124/contract at ceiling). Post-fix it's checked against the matching 62pt (MNQ) ceiling — the two halves of the same compliance formula now agree, and the check can only become MORE likely to correctly block an overleveraged order, never less. No new exposure is created on this path; a latent under-enforcement gap on it is closed as a side effect.

- No frozen ref, certified band, or golden fixture depends on `getStopCeilingPts("ES"|"NQ"|"CL")` today — nothing in the current test suite exercises those symbols on this path with production data, and no strategy config can produce them.
- `npm run test:metrics` (golden fixtures) is unaffected — it exercises only the live micro symbols.
- Downstream, once Phase 5 activates (operator funded balance ≥ $200K + explicit env flip + per-strategy `contract_class="mini"` declaration, per CLAUDE.md §13): any strategy trading true ES/NQ/CL minis will now get the CORRECT ceiling (14/62/1.00pt matching Python) at every call site instead of silently inheriting the MES 14pt ceiling regardless of symbol — closing what the task's own framing calls a coming **10×-class silent risk-inflation class of bug** once minis go live (an NQ position managed/sized against a 14pt ceiling instead of 62pt would misprice the worst-case dollar risk the ceiling is supposed to cap, in either direction depending on how a future caller uses it).
- CI gate (`check:ts-python-stop-geometry-parity`) blast radius: adding `ES`/`NQ`/`CL` to `SYMBOLS` only WIDENS coverage — it cannot introduce a new failure mode, only surface one that already existed. Verified green post-change (below).

## 3. Exact change, scope-locked

**In scope, all landed:**
1. `src/server/lib/contract-class.ts` — add `ES`, `NQ`, `CL` keys to `STOP_CEILING_TABLE`, each reading the SAME env var as its micro (`STOP_CEILING_PTS_MES`/`_MNQ`/`_MCL`) with the SAME default (14/62/1.00), mirroring `_STOP_CEILING_DEFAULTS` exactly. Zero change to the MES/MNQ/MCL entries or to the fallback logic in `getStopCeilingPts()`.
2. `src/server/lib/contract-class.ts` — corrected the two stale docstrings (table-level ~228-231, function-level ~256-260) to cite the real mirror: `src/engine/stop_geometry.py`'s `_STOP_CEILING_DEFAULTS` / `get_stop_ceiling_for_symbol()`.
3. `scripts/check-ts-python-stop-geometry-parity.ts` — added `"ES"`, `"NQ"`, `"CL"` to the `SYMBOLS` grid (now `["MES","MNQ","MCL","ES","NQ","CL","ZZZ"]`) plus a one-line comment noting these are the dormant Phase-5 aliases. No change to the ATR grid, mult grid, tolerance, env-override subprocess cases, or exit-code contract.
4. `src/server/lib/__tests__/contract-class-stop-ceiling.test.ts` — added a RED-proof describe block asserting `getStopCeilingPts("NQ") === 62` (not the MES fallback 14), `getStopCeilingPts("CL") === 1.00` (not 14), `getStopCeilingPts("ES") === 14`, plus lowercase-alias parity with their micro. These assertions fail against the pre-fix table (verified: NQ/CL would return 14).

**Explicitly OUT of scope (grader should assert zero diff):**
- `getContractClass()` / `CONTRACT_CLASS_MAP` — already correctly enumerates ES/NQ/CL as `"mini"`; untouched.
- `STOP_FLOOR_ENV_MAP` in `stop-geometry.ts` — already correct; untouched (cited only as corroborating evidence).
- `_STOP_CEILING_DEFAULTS` / `get_stop_ceiling_for_symbol()` in `stop_geometry.py` — already correct; untouched. Python side needed no fix.
- `TF_PHASE_5_ENABLED` default, `resolve_contract_spec()` gating logic, any Phase-5 activation behavior — untouched. This packet does not activate Phase 5 or change its gating.
- Commission tables, margin-expansion module, any other contract-class.ts export — untouched.
- `CONTRACT_SPECS["ES"|"NQ"|"CL"]` in `src/shared/firm-config.ts` aliasing to the MICRO point value rather than the true `MINI_SPECS` value (the mechanism the §2 reachability analysis relies on to show the one live-reachable call site tightens, not loosens) — this is EXISTING, deliberate, documented behavior ("S3 data-path labels"), not something this packet touches or is asserting a verdict on beyond the fact that it exists and is unchanged.
- `resolveRouteContractSpec()` / `broker-router.ts`'s MFFU 2%-rule check itself — the FALLBACK VALUE it now retrieves is corrected (the point of this packet); the surrounding logic (when the fallback fires, what it's compared against) is untouched.
- No new env vars introduced (ES/NQ/CL reuse their micro's existing env var by design, matching Python).
- No migration, no schema change, no flag.

## 4. Verification plan (empirical receipts — actually run this session)

1. **Drift repro (pre-fix, evidence for §1):** reconstructed the exact pre-fix TS table in isolation and called it alongside the real (unmodified) Python `get_stop_ceiling_for_symbol()` — confirmed `NQ`: TS=14 vs PY=62.0, `CL`: TS=14 vs PY=1.0 (see §1 output block).
2. **CI parity gate, post-fix, real subprocess:** `node node_modules/tsx/dist/cli.mjs scripts/check-ts-python-stop-geometry-parity.ts` — spawns real Python (`python -m src.engine.stop_geometry`) against the real (fixed) TS helpers over the widened 7-symbol × 6-ATR × 3-mult grid (378 cells across 3 env configs). Result: **`✓ TS↔Python stop-geometry parity: ALL 378 CELLS MATCH + invariant holds`** — ES/NQ/CL now agree with Python at every cell, including the two env-override subprocess cases.
3. **Unit tests, RED-proof:** `node node_modules/vitest/vitest.mjs run src/server/lib/__tests__/contract-class-stop-ceiling.test.ts` — 19/19 pass (15 pre-existing + 4 new). The 4 new assertions (`NQ !== 14`, `CL !== 14`, lowercase-alias parity) are constructed to fail against the pre-fix table — confirmed by the §1 manual repro reproducing the exact failure they'd hit.
4. **Type-check:** `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` — exit 0, zero errors, full project (not just touched files).
5. **No golden-fixture drift:** `getStopCeilingPts`/the parity script are not on the `test:metrics` golden-fixture path (micro-only strategies); not re-run as this change cannot touch fixture values for live symbols — confirmed by code inspection (§2).

## 5. Rollback

Single revert of the 4 touched files — pure additive table entries + a widened test/CI fixture grid + two docstring corrections, no schema/migration/flag/data. Reverting drops the ES/NQ/CL ceiling keys back to their prior (broken) fallback-to-MES behavior and narrows the CI grid back to blind — restores exactly the pre-fix state, nothing else depends on the new keys since Phase 5 is dormant.

## Plain-English for the operator

This was a "sleeper" bug in the code that decides how wide a stop-loss is allowed to be for each futures contract. For the 3 contracts you trade today (MES, MNQ, MCL) it was always correct. But the code also has placeholder support for the bigger "mini" versions of those same contracts (ES, NQ, CL) that you're not using yet — those only turn on if you later fund an account to $200K+ and explicitly flip a switch for them. For those mini contracts, the code was silently reusing the SMALL contract's stop-width limit (14 points) instead of each mini's real correct limit (62 points for NQ, 1.00 point for CL) — a numbers-don't-match bug the automated checker built specifically to catch this kind of thing couldn't see, because nobody had ever told the checker to test those 3 symbols in the first place.

I checked (not just assumed) every place in the code that actually uses this number. For the trades you place day to day, nothing changes — no strategy you run can even produce an "ES"/"NQ"/"CL" order today, so those spots are truly untouched in practice. There's exactly one spot — a compliance double-check on MFFU accounts — that technically COULD have seen one of those symbols if an alert ever arrived mislabeled, and even there the fix only makes that safety check MORE careful, never less. So: nothing gets riskier today, one quiet loose end gets tightened, and the automated checker now actually watches those 3 symbols going forward — so if minis ever get turned on later, they start correct instead of quietly wrong.
