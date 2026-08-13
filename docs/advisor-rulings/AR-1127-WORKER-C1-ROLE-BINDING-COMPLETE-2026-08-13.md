# AR-1127 (worker) — **ORDER C1 COMPLETE** at `a37f6329`. The validated role set is now the executing instance's set. **§9.2 still OPEN. R1 still STOPPED pending AR-1126.**

**Seat:** Claude Code worker · **Date:** 2026-08-13
**Governing rulings:** AR-1125 §7.3 (C1) · open stop in AR-1126
**Engineering head on origin:** `a37f6329` (impl `a0cb5b36` + inventory regen)

---

## 1. WHAT LANDED

`_bind_source_timeframe_roles()` in `backtester.py` closes the hop that made §9.1's consumer unable to act.

**The defect, restated from measurement:** `run_class_backtest` resolved the persisted carrier into `_cls_source_timeframe_roles` — a local `grep` found in exactly two places, its initialisation and its assignment, **read by nothing** — while the executing instance carried `None`. The engine validated a role contract it could not act on, so the AR-1115 fail-closed refusal **could never fire**.

**The bind:**
- validates through the **unchanged** `_resolve_source_timeframe_roles`, so the AR-1110 refusal semantics are preserved byte-for-byte;
- when the AR-1121 §4.C factory arrow already supplied a typed object, **that object is KEPT** and the persisted payload must agree **canonically** — no second independent authority, per AR-1119 §3.6;
- **refuses on disagreement** rather than picking a winner: two answers to *"which timeframe owns the opening range"* is the conflict AR-1110 §5 refuses to resolve;
- otherwise leaves the validated object **on the strategy**, so the set the gate proved is the set `_h_opening_range` reads.

**Enforced at the gate, not only at the Band C call site**, so the invariant holds for **every** caller that reaches it — not only the one production path I happened to wire. That is deliberately stronger than the minimum your order required, and it is the same amount of code.

---

## 2. RED PROOFS

Your §4 asks for the first. The second is mine.

| ablation | result |
|---|---|
| drop the pass-through onto the instance (restores the dead-local shape) | **construction witness FAILS**, legacy/no-role stays **GREEN** |
| drop the canonical-agreement check | disagreement test **DID NOT RAISE** |

**Each ablation convicted its own test only** — they discriminate rather than failing the file. Restored **7/7**.

**Control for the identity assertions:** the raw resolver returns a **fresh** object on each call (`a is not b`, equal payloads). So `is` passing after binding is a property of the binding, **not** an artefact of the resolver returning a singleton. Without that control, `is` proves nothing.

**Preserved:** a refusal leaves **no partial binding** (`source_timeframe_roles` still `None` after the missing-carrier refusal), and binding **does not invent a frame** — `opening_range_source_frame` stays `None`, since the 5m frame is a separate input (your §4) and must not be synthesised from the 1m execution series.

**Regression:** **207 passed**, 0 failures, across the role, factory, backtester, MP1 and opening-range consumers. The `metric snapshot` pre-commit hook also ran and passed, which it had skipped on my earlier commits because `backtester.py` was untouched.

---

## 3. WHAT THIS IS NOT

🛑 **One hop.** No certified sVkm record exists, so **no vertical witness is possible and none is asserted.** §9.2 remains **OPEN**.

The test role values are **SYNTHETIC and labelled so** in the module docstring — they stand for *"a valid role set"*, never for sVkm's taught semantics. Your §7 holds: the expected 5m/1m table is an acceptance expectation, **not permission to hardcode**.

---

## 4. STATUS

| Item | State |
|---|---|
| A1b stale-prose cleanup | ✅ COMPLETE (`f9eba98e`) |
| C1 role binding | ✅ **COMPLETE**, red-proofed (`a37f6329`) |
| R1 certification | 🛑 **STOPPED** — lane disproved, decision open in **AR-1126** |
| B TypeScript transport | ⬜ NOT STARTED |
| D direct 5m supplier | ⬜ NOT STARTED |
| §9.2 | 🔴 OPEN, NOT CLAIMED |

**DISCLOSURES:** no grader · no market data · no backtest · no trade · full engine suite still not a usable instrument, everything outside the named suites **UNMEASURED** · nothing dispatched to any reader, nothing certified · the broader extraction surface named in AR-1126 remains **UNENUMERATED**.

**AR-1126's decision is still the blocker for R1.** B and D are record-independent and I am proceeding to them unless you redirect.
