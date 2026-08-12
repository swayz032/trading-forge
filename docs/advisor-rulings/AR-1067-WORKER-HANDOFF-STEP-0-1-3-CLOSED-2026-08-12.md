# AR-1067 — WORKER — **HANDOFF at a closed unit.** STEP 0, 1, 3 closed and pushed; Units A–E green. STEP 2/4/5/6 UNSTARTED (not half-done). The next seat re-derives nothing.

```
RULING  : AR-1064 (gpt-rulings 1d36573b)
ENGINEER: origin/h1-wave4-sealed12-driver = 64420de6f420eb9a6f48a08c4603ce73a355b0d2
GPT     : origin/external-advisor/gpt-rulings = 73fabf1d (AR-1066)
STATE   : working tree clean of my work. NOTHING half-written. No sub-agent outstanding.
```

## 1. FAN-IN: 3 of 7 AR-1064 steps closed, plus Units A–E from AR-1059

| step | state |
|---|---|
| STEP 0 expose commits | ✅ CLOSED — engineering branch pushed, `5958385d -> 64420de6` |
| STEP 1 anchor semantic | ✅ CLOSED — `64420de6`, 12 passed |
| STEP 2 same-FVG producer | ⬜ **UNSTARTED** |
| STEP 3 transcript sweep | ✅ CLOSED — honest null, AR-1065 |
| STEP 4 flag/floor bypass | ⬜ **UNSTARTED** |
| STEP 5 money path | ⬜ **UNSTARTED** |
| STEP 6 end-to-end RED/GREEN | ⬜ **UNSTARTED** |

Commits, all pushed: `d894f2e3` (B+C) · `d5b9f029` (D) · `56279f65` (inventory) ·
`93dfa18e` (A) · `0b1533ff` (E) · `64420de6` (STEP 1).

**Unstarted is not blocked — it is unstarted.** I am handing off on context, at a boundary
where nothing is mid-flight, not because the remaining work is stuck.

## 2. 🛑 THE ONE MEASUREMENT THE NEXT SEAT WOULD OTHERWISE RE-DERIVE

I checked STEP 4's feasibility before stopping, and the answer shapes the step ordering:

```
_resolve_stop_risk_points(entry_idx, is_short, atr_fallback_points,
                          stop_ceiling, structural_stop_map)   backtester.py:2984
```

- **It receives NO config, NO spec, NO mode.** There is nothing to branch a
  `SOURCE_FAITHFUL` bypass on at that site today.
- **It has exactly FOUR call sites:** `backtester.py:993, 1097, 1392, 1925`.
- **But `_apply_trade_management` (`:1188`) DOES receive `spec`**, and it already carries
  `exit_policy: str = "full_overlay"` — **an existing precedent for threading a mode down
  this exact chain.** So the plumbing shape is settled; copy `exit_policy`'s pattern.

⇒ **STEP 4 is implementable but its VALUE depends on STEP 2/5**, because the flag's value must
come from `compiled_spec.spec.source_risk`, which nothing in Python reads yet. Building STEP 4
first would add another `BUILT-UNREACHABLE` path. **Recommended order: STEP 2 → STEP 5 → STEP 4
→ STEP 6**, not AR-1064's numeric order. Flagging rather than silently reordering — GPT's call.

## 3. WHERE STEP 2 STARTS

`displacement_extreme(zone, high, low, direction)` already takes a **zone**, so the remaining
work is transporting **WHICH zone qualified**, not recomputing one.

- The money-path entry is `backtester.py:8526` -> `from_compiled_spec()` `:8547` ->
  `SpecConditionStrategy` (`spec_condition_compiler.py:501`).
- The FVG entry condition is evaluated at `spec_condition_compiler.py:1291 _h_fvg` /
  `:1478 _eval_fvg`. **That is where the qualifying zone identity exists and where it must be
  captured** — AR-1064 SS3 forbids re-scanning for a nearest FVG at stop time.
- `spec_condition_compiler.py:2357` already calls `compute_structural_stop` but is
  **trace-only** (`except Exception: pass`, *"trace is best-effort, never fatal"*) and passes
  only swing points. **Do not mistake that site for an execution path** — it was my
  predecessor's near-miss and mine.

## 4. STILL-OPEN FACTS THE NEXT SEAT MUST NOT RE-LITIGATE

1. **`BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` defaults FALSE** (`backtester.py:2969`) —
   structural map discarded for `atr_fallback`. **AR-1064 SS5 AUTHORIZED the SOURCE_FAITHFUL
   bypass.** Legacy/TF_OVERLAY_VARIANT must keep current behaviour.
2. **MES stop FLOOR 6.0pt** (`_STOP_FLOOR_ENV_MAP` `:3035-3060`, applied `:3248`) widens any
   tighter taught stop. Same bypass authorization, same legacy preservation.
3. **SHORT side is UNRESOLVED source semantics** (AR-1065: no mirroring authority anywhere in
   `df72444f`). It currently fails closed via the UNIT C wrong-side guard. **Do not implement
   the mirror.** GPT has authorized ONE bounded visual question if needed — not V0.
4. **Long side is fully source-resolved**: displacement candle low, wick-inclusive, fixed 2R.
   An isolated long-side fixture is permitted for engineering tests, but **no complete-strategy
   fidelity claim** while the short is open (AR-1064 SS4).
5. **The pre-existing red**: `test_wave_b_intrabar_stops::test_long_tp_fires_intrabar_even_if_
   close_falls_back` fails at baseline — attributed by ablation in AR-1060. Not yours.
6. **Pre-push hooks**: the inventory-freshness hook WILL block a push after any symbol change.
   Run `python scripts/system_inventory.py`, commit `docs/designs/SYSTEM-INVENTORY.md`, push.
   **Do not regenerate the ACCEPT-5 canonical manifest** — different artifact.

## 5. OPERATIONAL

- **The ruling ear dies with this seat.** Re-arm per `worker-onboarding` SS2a and **back-fill
  from `73fabf1d`** — that is the GPT-branch head at handoff.
- **No sub-agent is outstanding.** I dispatched none; no grade was required by AR-1059/1064.
- **The transcript is at**
  `C:\Users\tonio\Projects\trading-forge\backups\h1-shadow-eval\transcripts-78fe8ea7\
  transcripts\sVkmZklJDHI.transcript.txt`, sha256 `df72444f70e8c79d...` — **it is NOT in the
  worktree**, which is why two seats concluded it was absent. It joins by hash to the golden
  artifact AR-1057 SS7.3 named.

## 6. HONEST NOTE ON THIS SEAT

Two of my own errors are on the record and should stay there, because both were caught by
controls rather than by me: I published five ARs describing commits I had never pushed
(GPT caught it, STEP 0), and I nearly triggered the visual-evidence lane over a question the
transcript answered — I had searched only the worktree (the operator caught it). Neither
reached code, but both were failures of *scope of search*, which is this campaign's most
repeated shape.

**A fresh worker session is needed. Nothing blocking for the operator.**
