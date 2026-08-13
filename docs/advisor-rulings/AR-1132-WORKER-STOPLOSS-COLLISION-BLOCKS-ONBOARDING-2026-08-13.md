# AR-1132 (worker) — 🛑 **STOP: MY LANDED B-RISK-1 FIX ACTIVATED A DEAD FEATURE, AND THE AUDITOR REJECTS IT. NO `SOURCE_FAITHFUL` STRATEGY CAN ONBOARD.** B-DB-ROUNDTRIP-1 IS BLOCKED BEHIND IT.

**Seat:** Claude Code worker · **Date:** 2026-08-13
**Engineering head on origin:** `83c6fa41` (contains the fix that exposed this)
**§9.2 remains OPEN and is NOT claimed.**

---

## 1. WHAT I FOUND, BUILDING B-DB-ROUNDTRIP-1

The round-trip test would not insert. The onboarding result is not an error — it is an **auditor rejection**:

```
status: "rejected_auditor"
reason: "DEFECTS(1): B3_FIXED_POINT_STOP | WARNINGS(2): B6_BASE_CONTRACTS_NON_CANONICAL,
                                                       E2_SESSION_FILTER_NOT_RTH"
```

**The chain, measured end to end:**

```
spec.source_risk  (now transported by my B-RISK-1 fix)
  -> spec-onboarding-service.ts:988   stop_loss: resolveSpecStopLoss(spec)
  -> finalConfig.strategy.stop_loss = { type: "source_structural", ownership: "source", ... }
  -> auditGraduatedConfig({ config: finalConfig })
  -> graduated-strategy-auditor.ts:157   if (sl?.type !== "atr") -> DEFECT B3_FIXED_POINT_STOP
       message: "must be 'atr' — NO fixed-point stops per CLAUDE.md §13"
  -> rejected_auditor, x3 symbols, NOTHING PERSISTED
```

---

## 2. WHY NOBODY HIT THIS BEFORE — AND IT IS THE SAME BUG YOU ALREADY RULED ON

**CONTROL, run against the commit before my fix:** `grep -c "source_risk: spec.source_risk"` = **0**.

`source_risk` was **never transported**, so `resolveSpecStopLoss(spec)` **always** returned the framework ATR object, so **the auditor never once saw a non-ATR stop.**

⇒ **The AR-1056 §2.4 / AR-1059 §4 taught-stop feature has been DEAD SINCE IT LANDED.** The code comment at `spec-onboarding-service.ts:982-987` states its intent exactly — *"was an unconditional `{type:'atr',multiplier:1.5}`, which destroyed a taught stop at this exact boundary"* — and the transport gap silently restored the very behaviour it was written to remove.

    ★★★★★ `A FEATURE KEPT DEAD BY A SEPARATE BUG NEVER MEETS THE GUARD THAT WOULD HAVE
       REJECTED IT — SO THE CONFLICT SITS UNDISCOVERED UNTIL SOMEONE FIXES THE BUG.`

**My fix is correct and I am not retracting it** — you traced the same drop independently, and the alternative is trading a stop the teacher never taught. But it converts a *silent wrong stop* into a *hard onboarding refusal*, and you should know that within minutes rather than after §9.2.

---

## 3. THE COLLISION — TWO STANDING RULES, MUTUALLY EXCLUSIVE

| rule | requires |
|---|---|
| **CLAUDE.md §13** / auditor `B3` | `stop_loss.type` **MUST** be `"atr"` — no fixed-point stops |
| **AR-1056 §2.4 / AR-1059 §4** | a `SOURCE_FAITHFUL` spec **MUST** carry the teacher's structural stop |

**Both cannot hold.** With the transport fixed, every `SOURCE_FAITHFUL` strategy is rejected at onboarding; with it dropped, every taught stop is silently replaced by ATR 1.5.

**This is squarely on the §9.2 golden path** — your own chain ends in *teacher stop → fixed R target*.

🛑 **I did NOT touch the auditor.** `B3` is a framework SAFETY rule tied to CLAUDE.md §13, and loosening a safety guard so my own unit can pass is the exact shape this desk convicts. **Yours to rule.**

**Options as I see them:**
- **S-a — teach `B3` about source-owned stops:** accept `type === "source_structural"` **only when** `ownership === "source"` and the anchor resolves through `ANCHOR_TO_RESOLVER`. Narrow, keeps "no arbitrary fixed-point stops" intact, and the `source_exact: true` / `ownership: "source"` stamps already exist to key on. **My recommendation.**
- **S-b — keep `B3` absolute and reject SOURCE_FAITHFUL at onboarding.** Then AR-1056/AR-1059 are effectively repealed and the golden `teacher stop → fixed R` proof cannot exist. I do not think you want this, but it is the honest alternative.
- **S-c — something narrower you see that I do not.**

---

## 4. STATUS

| Item | State |
|---|---|
| B-FAILCLOSED-1 · B-RISK-1 | ✅ COMPLETE, pushed `83c6fa41` |
| Lane C enumeration | ✅ COMPLETE (AR-1131) — awaiting your C-a/C-b |
| **B-DB-ROUNDTRIP-1** | 🛑 **BLOCKED by this collision** |
| D-REAL-1 | 🛑 BLOCKED by `verify_spacing()` (AR-1130, mine) |
| §9.2 | 🔴 OPEN, NOT CLAIMED |

**The round-trip test is written and NOT committed.** Two of its five cases pass (malformed-present persists no row; legacy-both-absent onboards cleanly); the three carrier-survival cases cannot pass until the collision is ruled on. **I am not landing a red suite, and I am not weakening it to make it green.**

**DISCLOSURES:** the auditor rejection was found by BUILDING the round-trip proof, not by reading — the parser-boundary tests all pass and would never have surfaced it, which is exactly why you rejected my "all record-independent work complete" claim · one temporary `console.log` probe was added to read the rejection reason and has been removed · I did not modify the auditor, CLAUDE.md, or any safety rule · no grader · no backtest · no trade.

**Four decisions now sit with you:** this stop-loss collision · `verify_spacing` · Lane C `C-a`/`C-b` · the R1 SEAL-GO position. **I have no unblocked authorized work left that does not depend on one of them.**
