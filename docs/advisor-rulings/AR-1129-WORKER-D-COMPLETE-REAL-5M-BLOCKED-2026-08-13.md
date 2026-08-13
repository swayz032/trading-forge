# AR-1129 (worker) — **ORDER D COMPLETE** at `f82a77c9`. **ALL FOUR RECORD-INDEPENDENT ORDERS DONE (A1b · C1 · B · D).** ONLY R1 REMAINS, BLOCKED ON AR-1126. **AND A THIRD CORRECTION: REAL 5m IS NOT LOADABLE ON THIS BOX.**

**Seat:** Claude Code worker · **Date:** 2026-08-13
**Governing ruling:** AR-1125 §6.D · R1 decision open in **AR-1126**
**Engineering head on origin:** `f82a77c9` (impl `d4c89765` + inventory regen)

---

## 1. THE CORRECTION FIRST — IT INVALIDATES SOMETHING I TOLD YOU TWICE

**AR-1122 §4 told you §3.7 was deliverable and that "real direct 5m with no resampling" was available.** You relied on it, and AR-1125 §6.D repeated it back as *"the existing direct ES 5m data path already measured available for MES via the loader mapping."*

**`[MEASURED]` it is not available.**

```
load_ohlcv('MES','5m',...)  ->  DataLoadConfigError:
  S3 read for 's3://…/ES/consolidated/5min.parquet' aborted before DuckDB:
  missing AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
```

The loader prefers the local cache **only while it is fresh** — `_is_cache_fresh` uses a **24-hour TTL**. `data_cache/ES/ratio_adj/5min.parquet` is **554.8 hours old**, so it is treated as stale, the loader falls through to S3, and the S3 pre-flight guard refuses.

**My error was the same one a third time: I read the parquet files on disk and concluded about the resolver.** The files are there; the loader does not serve them.

    ★★★★★ `MEASURE THE RESOLVER, NOT THE ASSET.`

**Consequence for §9.2:** the final acceptance step — *"opening range behaviour actually depends on 5m source data while execution stays 1m"* — **cannot be witnessed on real data on this box today**, independently of the sVkm record question. It needs AWS credentials or a cache refresh. **That is an environment/operator matter, not something I can engineer around**, and I am not going to satisfy it with a resampler or a fixture and call it real.

---

## 2. ORDER D — WHAT LANDED

`_supply_opening_range_source_frame()` loads the opening-range role's **own** timeframe as its **own** series and attaches it to the same instance whose execution bars are 1m.

- Returns `None` when declared == execution — the consumer's equality branch handles that and **checks** the equality rather than assuming it. Supplying a duplicate series would create a second copy of the same bars to disagree with the first.
- **No aggregation path exists**, and it is enforced as executable text: a parametrized test reads the function **source** for `resample` / `group_by_dynamic` / `agg(`, so an aggregation added later fails **even if no test exercises it**.
- **Fail-closed**: unloadable, empty, or mislabeled ⇒ REFUSE. Never a fallback to the execution frame — `[AR-1113 §3.2]` for this source that substitution can produce the **right** number, which is precisely why it may not happen silently.

### A defect my first draft shipped, and the suite convicted it

`RoleFrame.__post_init__` checks shape, arity and zone-awareness. **It does NOT check that the series IS the timeframe it claims** — that is `verify_spacing()`, a **separate call**. I constructed the frame and never made it, so **a 1m series labelled `5m` was accepted**. Your AR-1119 §3.7 asked for exactly that guard. It is now called, and ablating it turns the two mislabel tests red.

**RED PROOFS:** drop `verify_spacing()` → mislabel and no-resampling tests **FAIL**; drop the attach → the divergent-roles witness **FAILS**. Each convicted its own test only. **10/10** restored. **Regression: 192 passed, 0 failures.**

### What this suite does NOT prove, asserted rather than described

The success path uses an **injected** series, labelled SYNTHETIC everywhere it appears. **A real 5m frame traversing this supplier is UNPROVEN and not claimed.** The refusal path is real: `test_REAL_loader_refuses_on_this_box_today` calls the live loader and asserts the refusal — **if that test ever starts FAILING, real data became reachable** and the witness this suite declines to claim becomes available. That is the intended signal, rather than a comment that rots.

---

## 3. STATUS — THE AUTHORIZED, UNBLOCKED WORK IS FINISHED

| Item | State |
|---|---|
| A1b stale-prose cleanup | ✅ COMPLETE (`f9eba98e`) |
| C1 role binding | ✅ COMPLETE (`a37f6329`) |
| B TypeScript transport | ✅ COMPLETE (`c3713ea0`) |
| **D direct 5m supplier** | ✅ **COMPLETE** (`f82a77c9`) |
| R1 certification | 🛑 **BLOCKED** — decision open in AR-1126 |
| Real-data 5m witness | 🛑 **BLOCKED** — no AWS creds / stale cache (§1) |
| §9.2 | 🔴 **OPEN, NOT CLAIMED** |

**Every hop of your §8 chain that does not require the certified record or real data is now built and red-proofed.** Two blockers remain, and **neither is engineering**: a decision (R1's lane) and an environment (market-data access).

---

## 4. DISCLOSURES

- **Three of my own claims have now been corrected by measurement this session:** the AR-1122 reachability flip, the AR-1124 R1 staging lane, and the AR-1122 §4 real-5m availability. **All three are the same shape — I measured an artifact and concluded about the mechanism that consumes it.** You should price my `[MEASURED]` on assets lower than my `[MEASURED]` on executed code.
- **The `source_risk` finding from AR-1128 is still unpriced** and I have not traced its consumer.
- No grader · no backtest · no trade · nothing dispatched to any reader · nothing certified.
- Full engine suite still not a usable instrument; everything outside the named suites is **UNMEASURED**.
- The broader extraction surface from AR-1126 remains **UNENUMERATED**.

**I have no authorized, unblocked work left.** Both open items need your ruling (or the operator's, for the SEAL-GO token and market-data access).
