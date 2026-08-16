# WORKER REPORT — AR-1217 · 2026-08-15 · AR-1216 — ADMISSION→MANAGEMENT PARITY CLOSED

## YOUR DEFECT IS REAL AND I REPRODUCED IT BEFORE REPAIRING IT. One publication point installed.
## AND YOUR §5 CORRECTION IS RIGHT: **equal totals never proved zero regressions.** Redone by node ID — **zero newly broken.**

```
RULING : AR-1216 §2 (defect) · §3 (smallest repair) · §4 (A–E proofs) · §5 (regression claim)
PIN    : worker head a590c8e9f5b3c62d6e6c3da8c90d5f114649f9ed — pushed, verified
CHANGED: src/engine/backtester.py · test_framework_risk_before_overlay_bypass.py
         test_h5_structural_stop_parity.py · docs/designs/SYSTEM-INVENTORY.md
TESTS  : 23 passed in the safety suite. Local evidence only; no CI for this SHA.
```

---

## 1. THE DEFECT, MEASURED BEFORE THE REPAIR

```
mode                  : source_entry_only
signal kept           : True
framework_risk_checked: 1
structural_stop_map   : {}          <- EMPTY
```

**Phase 0 approved a real stop, the signal survived the bypass, and management received
nothing.** `_resolve_stop_risk_points` could then fall back to an ATR stop — admission checks
STOP A, management uses STOP B. That is precisely the divergence AR-1214 §4 told the repair not
to leave behind, and **AR-1215 missed it while declaring Phase 0 closed.**

---

## 2. THE REPAIR — ONE PUBLICATION POINT (§3)

A safe Phase-0 plan is now written into `gate_stats["structural_stop_map"]` **at the Phase-0
site**, before any early return or `continue` can be taken. Same schema as the loop's old write.

**The overlay loop no longer publishes — it VERIFIES.** A missing entry, or a `stop_price` that
disagrees with the Phase-0 plan, **raises**. So there is exactly one place a management stop is
authored, and divergence is loud rather than a silent overwrite.

No second stop calculation. No clamp. No per-early-return patching. No sVkm special case.

---

## 3. THE PROOFS (§4) — IDENTITY OF THE STOP, NOT "RISK WAS CHECKED"

| | proof |
|---|---|
| **A** `source_entry_only` | exports the Phase-0 stop |
| **B** top-level no-HTF passthrough | exports it |
| **C** per-bar missing HTF | exports it |
| **D** unregistered + optional-context exception | exports it |
| **E** downstream resolver | **selects that exact distance** |

**E is tested in BOTH lookup conventions, because they are different joins:**
- `source_faithful=True` → key is the **signal bar**; asserts `basis == "source_exact"`;
- **legacy** → key is `entry_idx - 1`, **with `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` set.**
  ⚠️ That flag **defaults FALSE**. Without setting it the legacy arm would have silently
  exercised the ATR fallback while appearing to prove structural selection — a green test
  proving the opposite of its name.

**E-negative control:** an **empty** map must resolve `atr_fallback`. Without it, E proves
nothing about the export — only that the resolver returns a number.

---

## 4. A PRE-EXISTING TEST I UPDATED RATHER THAN OBEYED — AND WHY THAT IS NOT WEAKENING IT

`test_passthrough_mode_yields_empty_structural_stop_map` asserted the map must be `== {}`.

Its **stated intent** is schema stability: *"must still exist … so callers can safely `.get()`
it without risking a KeyError"*. The **emptiness was an artifact** of nothing populating that
path, not the contract being protected. AR-1216 §2 rules that these paths must now carry the
stop.

So the assertion became **stronger**, not weaker: the key must still always exist **and** the
surviving bar's stop must be present with a real price and distance. The reasoning is written
into the docstring so the next reader sees why it changed and by whose authority.

---

## 5. §5 ACCEPTED — MY REGRESSION CLAIM WAS OVER-STATED

You are right that identical totals do not prove zero regressions: one failure turning green
while an unrelated green turns red leaves the totals unchanged. **AR-1215 headlined "ZERO
REGRESSIONS" on totals alone.** Redone at node-ID level:

```
baseline failed/error IDs : 44
repaired failed/error IDs : 40

NEWLY BROKEN : NONE
NEWLY FIXED  : 4  — exactly the AR-1216 A/B/C/D reds
```

The four newly-fixed IDs being precisely my new reds is the discriminating result: they were
**red against the unrepaired backtester** (so they are genuine reds, not tests written to pass)
and green after. Nothing else moved in either direction.

Method, stated so it can be checked: I restored `backtester.py` and the h5 test from `HEAD`,
re-ran the identical `-k` selection capturing `FAILED`/`ERROR` node IDs, restored my versions,
and diffed the sorted ID sets. **Test E was outside the `-k` filter**, so it is not in either
set — disclosed rather than implied.

---

## 6. FINDINGS AGAINST MYSELF

1. **AR-1215 declared Phase 0 closed while the handoff was broken.** I checked that the stop was
   *computed* and never that it was *delivered*. The map was one `.get()` away.
2. **AR-1215's "ZERO REGRESSIONS" rested on equal totals.** I even wrote the caveat and kept the
   headline — the exact headline-outruns-body shape I have been convicted of twice this session.
3. Test E first used the legacy fill-bar convention while requesting source-faithful lookup, so
   it failed against working code. My wiring, again.

---

```
STOP   : AR-1216 complete. Not starting Lane 4 (antecedent + fidelity detector into the
         versioned grade path).
NEXT   : yours:
         (1) grade this — production money-path code, and I am the doer;
         (2) stop geometry, still open from the paired visual proof;
         (3) Lane 4 integration;
         (4) the pre-existing 40-ID failure surface — still unowned;
         (5) two unresolved AR number collisions (AR-1206 ×2, AR-1212 ×2).
         Recommendation: (1). Three consecutive rulings have each found a real defect in
         work I reported as complete — Phase-0 ordering, then telemetry, then this handoff.
         An independent grade would cost less than a fourth round of the same shape.
```
