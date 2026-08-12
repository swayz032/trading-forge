# AR-1062 — WORKER — **UNIT E GREEN. All five authorized units (A–E) now closed at their layers.** The money-path crossing is blocked on the AR-1060 §3 fork, and that is now the only thing between here and the certification GREEN.

```
RULING : AR-1059 (gpt-rulings 8e9ea5bc) SS4 UNIT A-E
BRANCH : h1-wave4-sealed12-driver (engineering)
COMMITS: d894f2e3  UNIT B+C  source-exact FVG anchor, no unstated buffer
         d5b9f029  UNIT D    whole-position fixed-R target
         56279f65  SYSTEM-INVENTORY regen
         93dfa18e  UNIT A    source-risk contract at the onboarding boundary
         0b1533ff  UNIT E    overlay stops replacing a source-owned stop
PRIOR  : AR-1060 (617b2f71), AR-1061 (bf9f34a8)
STATUS : NOT the SS6 certification GREEN. Five units green at their layers; the money
         path is NOT crossed and I am not claiming it is.
```

## 1. UNIT E — the overlay half (commit `0b1533ff`)

`framework-overlay.ts` replaced **any** `stop_loss.type !== "atr"` with `atr 1.5x`. The
overlay runs immediately after onboarding builds the config, so the `source_structural`
stop UNIT A had just preserved was destroyed one stage later. Two stages, opposite
intentions, three lines apart.

**Repair:** the exemption is keyed on **`ownership === "source"`, not on the type string** —
so it cannot be claimed by shape alone. There is a test for exactly that: a config carrying
`type:"source_structural"` *without* the ownership stamp is still replaced. Everything else
takes the identical framework path. `TF_OVERLAY_VARIANT` never reaches the branch; it is
stamped `type:"atr"` at onboarding.

**Also corrected** (reported in AR-1058 §2, unrepaired until now): the replacement warning
read *"is non-structural; CLAUDE.md §13 forbids fixed-point stops"*. That **inverted the
clause it cited** — `CLAUDE.md:255` is titled *"Stop Loss — structural, NEVER fixed-point"*
and `:704` forbids fixed-point stops while **requiring** structural ones. It now states the
real, narrower reason: `"atr"` is the only implemented framework stop type. I grepped first
and confirmed **no test pinned the old string**.

### Evidence

```
RED  : 3 failed / 4 passed
GREEN: 7 passed   framework-overlay-source-faithful.test.ts
REGRESSION: 152 passed / 8 files  (every suite touching the overlay)
TSC  : 0 errors, exit 0
```

★ **The RED is worth reading closely: all 4 legacy tests passed BEFORE the fix.** That is
the positive control that my legacy assertions describe the system's *actual* behaviour and
not my intention for it — a legacy assertion that only passes after the change would have
been describing the fix, not guarding against it.

## 2. THE FIVE UNITS, AND WHAT EACH PROOF ACTUALLY COVERS

| unit | state | proof | layer reached |
|---|---|---|---|
| **A** source-risk contract | GREEN | 10 passed; red-proved by mutation (6 / 1 / restored) | onboarding boundary |
| **B** source-exact stop | GREEN | 16 passed; value witness `5999.25` vs taught `6000.00` | resolver |
| **C** anchor command + refuse | GREEN | included above; nearer sweep/OB/swing cannot hijack | resolver |
| **D** whole-position fixed R | GREEN | 13 passed; asserts ladder fields ABSENT | pure math |
| **E** mode separation | GREEN | 7 + 152 passed | onboarding + overlay |

**RED->GREEN covered: 3, 4, 5, 6, 7, 8, 9.**
**RED->GREEN NOT covered: 1 (end-to-end transport), 2 (same-setup FVG identity),
10 (quote/span authority end-to-end), 11 (MP1/MP2/OR non-regression).**

## 3. WHAT IS STILL FALSE ABOUT THE SYSTEM

Stated plainly so nothing here reads as more finished than it is:

1. **The Python side never reads `source_risk`.** `from_compiled_spec` /
   `SpecConditionStrategy` do not look for it. The contract reaches the persisted artifact
   and stops there.
2. **No FVG-extreme producer exists.** AR-1058 §3.1's zero-producer finding is unchanged;
   `compute_structural_stop` still has no caller that supplies a real `nearest_fvg_below`
   for sVkm.
3. **The source stop cannot execute even if wired**, because of the two AR-1060 §2 defects:
   `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` defaults FALSE (structural map discarded for
   `atr_fallback`) and the MES 6.0pt stop FLOOR widens any tighter taught stop.
4. **`SYSTEM-INVENTORY` still classifies the new symbols as having no non-test callers.**
   That is correct and I am not hiding it — it is the machine-checkable statement of
   points 1–3.

## 4. 🛑 THE FORK IS NOW THE CRITICAL PATH, NOT A SIDE QUESTION

AR-1060 §3 asked whether `SOURCE_FAITHFUL` may bypass the operator-set
`BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` flag and the MES stop floor.
**I have implemented nothing against it and will not without a ruling.**

It has been promoted from "a question" to "the blocker": with the flag authoritative, the
source stop provably never executes, so RED->GREEN 1 and the §6 certification GREEN are
**unachievable by construction**. Every remaining unit of work routes through it.

**Recommendation unchanged:** `SOURCE_FAITHFUL` bypasses both; everything else stays
byte-identical. The flag protects *comparability against existing baselines*, and no
`SOURCE_FAITHFUL` spec has ever been run — so the bypass cannot re-baseline anything that
exists, while leaving it authoritative makes the unit impossible.

## 5. WHAT I AM DOING WHILE WAITING

The **minimum FVG-extreme producer** (AR-1059 §3: *"Exact qualifying FVG producer — MISSING
from the sVkm money path. BUILD THE MINIMUM PRODUCER."*). It is explicitly authorized, it
does not depend on the fork, and it is the one remaining piece that is useless to defer.

**Nothing blocking for the operator.**
