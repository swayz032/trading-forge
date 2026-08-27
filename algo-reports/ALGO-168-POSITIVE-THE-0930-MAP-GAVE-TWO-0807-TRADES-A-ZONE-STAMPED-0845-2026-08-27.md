# ALGO-168 — 🛑 **POSITIVE. TWO OF THE FOURTEEN TRADES ENTERED AT `08:07` ON A ZONE STAMPED `08:45`.**

**Strategy head:** `de002b65` + this trace — pushed, remote-verified. **PR #38: DRAFT / DO NOT MERGE.**
**Semantic files modified: NONE. This trace is read-only and opened no v2.4 file for writing.**
**Gate:** `40 passed`, enumerated by `--collect-only`.

**Authorized by ALGO-165. You pre-registered that you expected neither outcome. It is POSITIVE.**

---

## 1. THE RESULT, BY KEY

**19 candidate decisions have a `signal_time` strictly inside `08:00–09:30`.**

| | |
|---|---|
| **(a) decisions whose CHOSEN zone was created AFTER the decision** | **2** |
| **(b) decisions whose AVAILABLE SET contained a later-created zone** | **8** |

**POSITIVE CONTROL RAN FIRST AND PASSED** — a synthetic zone created one minute after the decision
moved **(b) from 8 → 9**. The instrument sees a later-created zone, so the counts above are
evidence about the code and not about a blind extractor.

## 2. 🛑 THE TWO, AND BOTH BECAME **THE TRADE**

| session | signal | entry | location used | zone `created` | outcome |
|---|---|---|---|---|---|
| **2026-03-30** | `08:05` | **`08:07`** | `S:2026-03-30T08:45:00` | **`08:45`** | **`became_the_trade: True`** |
| **2026-04-02** | `08:05` | **`08:07`** | `SWING:S:2026-04-02T08:45:00` | **`08:45`** | **`became_the_trade: True`** |

Both `deepest_gate: REACHED_THE_TRADE`. Both `REV`, both `ZONE_REJECTION_STORY_THEN_INTRA5_FORCE`.

**And the zone did not merely locate the entry — it set the exit.** `target_source` is
`WICK_ZONE` and `STRONG_SWING_DISPLACEMENT` respectively: **the same not-yet-existing zone supplied
the target.**

**The gap is worse than the stamps suggest.** A zone stamped `08:45` is built from a **15-minute**
bar, which does not complete until **`09:00`**. The decision is at `08:05`. **That is on the order
of fifty-five minutes of information the decision could not have had.**

## 3. WHAT THIS IS AND IS NOT

- **It is EXISTENCE, not STATE.** ALGO-137 correctly refuted the state version —
  `zone_state_at_v24` is re-evaluated per bucket at `ts`. **Which zones the `09:30`-anchored build
  ADMITS AT ALL was never traced.** Different object; different answer.
- **It bears on the census exactly as you pre-registered.** Two of the fourteen sessions' trades —
  and therefore the `8 of 14` agreement figure and any refusal reasoning resting on those two
  sessions — **rest on a location the decision could not have seen.**
- **I am NOT claiming a magnitude for the whole campaign.** 2 of 19 in-window decisions, on a
  14-session capture. **That is what was measured; nothing further is entailed.**
- **INSTRUMENT LIMIT, STATED:** this reads the **pinned** capture
  (`algo137_map_RELAND.json`, whose own `map_anchor` field records *"09:30 session open, mirroring
  `candidate_xray.py` and `kernel.py`"*) plus the pinned candidate walk. **It does not re-run the
  kernel**, so it cannot see a filter applied live between the map build and the decision that the
  capture does not record. **If such a filter exists, this is a false positive and re-running the
  kernel is the way to find out** — I am not authorized to do that and have not.

## 4. WHAT I AM NOT DOING

**No repair is proposed. v2.4 was not touched and I am not authorized to touch it.** Moving the
anchor would, as the committed comment says, change which zones exist at all — **and that comment
is a statement of what a fix would COST, which is exactly why it is not a defence of the constant.**

**No adoption decision, no re-scoring of the census.** You ruled that a result and what to do about
it are separate rulings; this is the result.

## 5. CONTEXT YOU SHOULD HOLD WHILE READING THIS

> ### 🛑 A CORRECTION TO MY OWN ALGO-166 HEADLINE, ACCEPTED FROM THE DESK AND RECORDED HERE
>
> **ALGO-166 said *"v2.4 WINS the only comparison that controls for width."* That overstates it.**
> `+1.43 sd` is **`p = 0.112`**, which clears no conventional bar. **The correct statement is a
> NULL RESULT ON BOTH ARMS: the clean-room map is AT chance and v2.4 is WEAKLY ABOVE chance and is
> NOT DEMONSTRATED.** `13 of 28` never meant what three days of rulings took it to mean — and
> accepting v2.4's "win" at `p=0.112` *because it now points where I expect* would be the identical
> error I just retracted, run in the opposite direction. The stricter pivot-drawn null would move
> **both** arms, not one.

**This lands the same hour I retracted ALGO-163 (see ALGO-166).** The two are independent — one is
my map being an artifact, the other is v2.4's map being anchored ahead of its decisions — **but
they point the same direction: every map-layer number this campaign has published deserves a
control it never got.** ALGO-166's was a null; this one's was a positive control that took four
lines.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this packet.*
