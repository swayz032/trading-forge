# ALGO-173 — THE ENUMERATION. **`5 of 12` in-window BULLETS used a location the bot could not causally have had.**

**Strategy head:** `312ab490` — pushed, remote-verified. **PR #38: DRAFT / DO NOT MERGE.**
**Semantic files modified: NONE.** Read-only; nothing monkeypatched; **no repair proposed.**
**Gate:** `45 passed`, enumerated by `--collect-only`.

**Authorized by ALGO-172.** `[instance-not-condition]`: the next move after an instance is the
count, and here it is.

---

## 1. THE TWO COUNTS, KEPT SEPARATE AS ORDERED

| | |
|---|---|
| decisions strictly inside `08:00–09:30` | **19** |
| …of which became a bullet | **12** |
| **AFFECTED DECISIONS** | **5 of 19** |
| **AFFECTED BULLETS** | **5 of 12** |

**Every affected decision became a trade.** There is no population of affected-but-discarded
candidates — the defect is not diluted by near-misses.

**POSITIVE CONTROL: `14 of 14` sessions returned a NON-EMPTY `08:00` location set.** Every "absent
at `08:00`" is evidence about a zone, not about an empty call.

## 2. BY KEY — with the mechanism each one actually died of

| decision | zone | mechanism | control at `08:00` |
|---|---|---|---|
| `2026-03-23 08:10` | `S:2026-03-03T09:30:00:97791` | **AUTHORIZATION** | 40 zones |
| `2026-03-30 08:05` | `S:2026-03-30T08:45:00:93755` | **HARD** | 52 zones |
| `2026-04-02 08:05` | `SWING:S:2026-04-02T08:45:00:94666` | **HARD** | 17 zones |
| `2026-04-06 08:25` | `SWING:R:2026-04-06T03:30:00:97165` | **HARD** | 17 zones |
| `2026-04-14 09:15` | `SWING:R:2026-04-14T09:15:00:102865` | **HARD** | 19 zones |

**`4 HARD · 1 AUTHORIZATION`**

- **HARD** — the level is **not constructed by its own builder** at `08:00`. It does not exist in
  the causal map at all.
- **AUTHORIZATION** — the level **is** constructed at `08:00` but does not survive to the location
  list until later bars. **The level exists; its authorization depended on post-decision data.**

**Both are non-causal for the decision. They are not the same defect and I am not giving them one
number.**

## 3. WHY THE COUNT IS DECOMPOSED RATHER THAN REPORTED FLAT

`build_entry_locations_v24` runs `build_zones → zone_state_at_v24 → enrich_confluence →
valid_location → swing builder → _range_room_authorization`. **An absence can be manufactured at
any of them.** The location surface is the right one to *count* on — a decision consumes locations —
but it is a composite, and **"5 lookahead bullets" would have been a gate label presented as a
sub-reason**, which is a law this campaign minted against itself.

## 4. 🛑 A JOIN-KEY ERROR OF MY OWN, CAUGHT BEFORE PUBLICATION

**Established and exceptional zones come from DIFFERENT BUILDERS** — `core.build_zones` and
`levels.exceptional_single_swing_zones` — **and one join key cannot see both.**

My first decomposition joined everything on `build_zones`. It reported two `SWING:` rows as an
*"id-shape mismatch"* and called `2026-04-06` **QUALITY/STATE**. **That was my key, not the data.**
Joined on the builder that actually makes it, `2026-04-06` is **HARD**. The committed script joins
each zone on its own builder and carries a per-builder control.

**Had I published the first pass, the tally would have read `1 HARD · 2 AUTH · 2 UNJOINED`** — and
the two "unjoined" rows would have looked like an instrument limit rather than the four-fifths
majority they are part of.

## 5. WHAT I AM **NOT** CLAIMING

- **No extrapolation to the full backtest.** This is 14 sessions and the in-window population. The
  `-$21,075 / 42%` curve is **not** re-scored here and I have not touched it.
- **Still EXISTENCE and AUTHORIZATION, never STATE.** ALGO-137's refutation stands untouched —
  `zone_state_at` really is re-evaluated per bucket.
- **No repair.** Moving `kernel.py:222` changes which zones exist and would invalidate every
  campaign number measured against the current map. **That costs the operator his baseline, so it
  is a ruling.**
- **Nothing here rehabilitates the clean-room or v2.4.**

## 6. HOLDING

**Per ALGO-172: report the two counts, then hold.** No repair, no re-scoring, no adoption decision.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this packet.*
