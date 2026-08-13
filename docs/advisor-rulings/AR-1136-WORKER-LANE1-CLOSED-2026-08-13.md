# AR-1136 (worker) — **§4 CROSS-LANGUAGE RELOAD PROVEN. LANE 1 IS FULLY CLOSED** at `c72fefde`. Only Lane C (C-a) remains. §9.2 still OPEN.

**Governing ruling:** AR-1133 §4 · **Engineering head:** `c72fefde`

## 1. WHAT TYPESCRIPT PERSISTS, PYTHON NOW PROVABLY CONSUMES

The TS half was already proven (INSERT → reload, both carriers deep-equal). This starts from the **same persisted shape** and proves the Python engine reads it:

```
reloaded config.compiled_spec
  -> from_compiled_spec -> SpecConditionStrategy
  -> _bind_source_timeframe_roles()   consumes the persisted carrier: 5m OR window, 1m breakout
  -> _resolve_source_fixed_r()        returns the persisted teacher R
```

**THE DISCRIMINATOR, and it is why this file exists.** Your §4 says *"no default may manufacture 2.0"*. A test asserting only `== 2.0` would pass against a hardcoded default — so the persisted `r_multiple` is **varied (1.5 / 3.0 / 4.25)** and the resolver must follow it. **It does.** Removing the target **REFUSES** rather than falling back.

Also proven: a missing role carrier **refuses rather than recovers** and leaves **no partial binding**; and the two carriers are **independent** — losing the R target does not silently cost the role contract, because they are separate source facts that each refuse on their own.

**8 passed; 68 passed + 1 skipped across the role/frame closure.**

🛑 The payload is **SYNTHETIC**, mirroring the TS round-trip fixture in shape. **Not sVkm, not a §9.2 witness** — §9.2 needs the real certified record, which does not exist yet.

## 2. LANE 1 IS CLOSED — EVERY HOP THAT DOES NOT NEED THE REAL RECORD

| hop | proof |
|---|---|
| thin reachable compile entry point | Spine A, red-proofed |
| identity contract (`--spec-id`) | 4 process-level red proofs |
| Python producer → hashed carrier | pending the real record (Lane C) |
| TS transport + fail-closed on malformed | B / B-FAILCLOSED-1, red-proofed |
| `source_risk` transport | B-RISK-1 — defect reproduced live |
| B3 auditor accepts canonical source stops | S-A+, 5-counterfeit ablation |
| DB save → reload, both carriers | B-DB-ROUNDTRIP-1, 5/5 |
| **reload → Python instance consumes both** | **§4, this unit** |
| factory → instance role arrow | Spine C, identity not equality |
| gate → instance single authority | C1, canonical-agreement refusal |
| real direct 5m frame + 1m execution | D-REAL-1 on **real market data** |

**What remains for §9.2 is exactly one thing: the real certified sVkm record**, and the lane for it is the C-a route you approved.

## 3. STATUS

| Item | State |
|---|---|
| Lane 1 (stop / persistence / cross-language) | ✅ **CLOSED** |
| Lane 2 (real market data) | ✅ **CLOSED** — D-REAL-1 real witness |
| **Lane C — C-a certification run** | ⬜ **AUTHORIZED, NOT STARTED — the only remaining work** |
| §9.2 | 🔴 OPEN, NOT CLAIMED |

**DISCLOSURES:** one ruff import-order failure blocked the first commit of this unit and was fixed before landing · the branch-deletion incident from AR-1135 stands as reported and the branch is verified intact · every proof in Lane 1 outside D-REAL-1 is fixture-level by design and labelled as such · no grader · no backtest · no trade · nothing certified.

**Proceeding to Lane C (C-a) unless you redirect** — the pinned bytes are `sVkmZklJDHI` / 25071 / `df72444f…ce99cc`, and your §6 hard rules (no hand-authored JSON, no synthetic Tier-3 verdicts, no `dry_run` certificate, EXTRACTION_CERTIFIED stamping, new population not the frozen Tier-A directory) are the contract I will hold to. If the real certificate cannot pass its actual grading contract, I stop and report rather than relabel it.
