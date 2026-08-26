# ALGO-122 — **THE EXIT HALF, FOUND AND CITED AT THE EXECUTABLE LINE.** His taught rule is *"the nearest **MEANINGFUL** physical structural S/R reaction, 5m liquidity/reaction cluster, or active 15m FVG owns TP1."* **[MEASURED HERE, pin `a355507d`] `meaningful` IS implemented — `touches >= 2 AND quality >= min_zone_quality` (`targets.py:81`) — and it is applied to exactly ONE of the three families.** For the other two it is **hardcoded `True`**: `KEY_ZONE_15M` at `targets.py:193` and `:213`, `FVG_15M` at `targets.py:309`. And the 15m family is fed by `build_entry_locations_v24` **unfiltered** (`targets.py:258-263`) — the entire ~62-zone entry map, `touches=1` single-swing zones included. Destinations are sorted by first-contact **ascending** and the live gate takes the **first `meaningful` one past the $400 floor**. ⇒ **THE PREDICATE THAT DECIDES THE DESTINATION CANNOT REACH THE FAMILY THAT SUPPLIES THE DESTINATIONS.** That is why the bot takes 20.68 pt where he takes 66.1 — **not a broken rank, an unreachable predicate.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `42b7bf50`.
**Pin:** `a355507d`; `targets.py` and `target_policy.py` are **byte-identical in the working tree** —
tonight's build does not touch them. **Live path verified:** `v2_4_engine.py:20` imports
`build_and_classify` from **`target_policy`**, whose `classify_first_reaction_destination`
(`:122-186`) is the executing gate. `targets.py:325`'s same-named function is **not** the live one —
I checked before ruling, because reading the wrong surface is how ALGO-076 and ALGO-102 §2 both went
wrong. **PR #38: DRAFT. Nothing lands. No repair is ordered here.**

---

## 1. The mechanism, at the lines

**The universe** (`targets.py:245-315`), all three taught families present and correctly built:

| family | built from | `meaningful` |
|---|---|---|
| `KEY_ZONE_15M` | `build_entry_locations_v24(...)` → **`established + swings`, UNFILTERED** (`:258-263`) | **`True`, hardcoded** — `:193`, `:213` |
| `LIQUIDITY_CLUSTER` (5m) | `core.build_zones(piv5, ...)`, standalone only | **COMPUTED** — `:286`, `_structurally_meaningful_cluster` |
| `FVG_15M` | `active_15m_fvgs(...)` | **`True`, hardcoded** — `:309` |

**The gate** (`target_policy.py:135-186`, live), with the list sorted by
`first_contact_distance` **ascending** (`targets.py:320`):

```python
structural_min_room = p.min_room_r * p.stop          # 1.50 × 17.25 = 25.875 pt
for d in destinations:                                # NEAREST FIRST
    if not d.meaningful:
        ...  # may BLOCK as a weak near blocker; NEVER owns TP
        continue
    reference_reward = distance × $2 × 15
    if reference_reward < 400:  return None, "TP1_REFERENCE_REWARD_UNDER_400"   # BLOCK
    return target, f"FIRST_REACTION:{d.kind}"          # ← the first meaningful one WINS
```

⇒ **The first `KEY_ZONE_15M` or `FVG_15M` ahead of entry that clears $400 always owns TP1**, because
its `meaningful` flag is never tested. **With ~62 candidates per session there is nearly always one
just past the floor.** `$400` at the frozen 15-MNQ reference = **13.333 pt**
(`semantic_crosswalk.tp_safe_gap.reference_distance_points`, held). **A realised median destination
of 20.68 pt is exactly what "first candidate past a 13.33-pt floor in a 62-zone map" produces.**

**PRE-REGISTERED PREDICTION, recorded before anyone runs it, and it can convict me:** the
distribution of the bot's *chosen* TP1 `first_contact_distance` across the fourteen sessions should
**pile up immediately above 13.33 pt**. If it is instead broad or centred far above the floor, this
mechanism is not the explanation and I want that on the record.

## 1a. The population inversion — the filter is applied to the set that did not need it

`_target_only_15m_locations` (`targets.py:88-105`) **does** apply `touches >= 2 AND quality >=
min_zone_quality`. It applies it to `primary_zones` **minus the ids already in `primary_locs`** —
i.e. to the *supplementary* zones that entry authorization rejected. **The ~62 entry-authorized zones
skip it entirely.** Its docstring — *"Keep meaningful 15m S/R reactions even when entry authorization
is stricter"* — shows the intent: its author was thinking about **admitting** zones the entry gate had
excluded, and never about **filtering** the ones it had admitted.

> **THE SET THAT NEEDED THE FILTER IS THE SET EXEMPTED FROM IT** — the same population defect the
> campaign convicted three times last week, this time in production semantics rather than a guard.

## 2. What this corrects in my own two prior rulings

- **ALGO-120 §7** called `kernel.py:205/207` *"the exit half, and the larger of the two."* **It is
  not the exit half at all.** ALGO-121 §1a already retracted the rank framing; **this ruling names
  the actual site: `targets.py:193 / :213 / :309`.**
- **ALGO-121 §1a** said the lane was *"derive `meaningful`"*, implying it was undefined. **It is
  defined and it is enforced — on one family of three.** The lane is narrower and better posed:
  **not "invent a predicate" but "why is the implemented one unreachable for the family that
  matters, and what does he say makes a 15m S/R reaction meaningful as a DESTINATION?"**
- **ALGO-121 §1's "~62 zones/session is the destination candidate set" — I re-checked it here and it
  HOLDS.** `targets.py:258-263` passes `build_entry_locations_v24`'s full output, swings included,
  straight into `primaries`. Mid-investigation I suspected `touches=1` excluded swings from
  destinations; **that is false — `touches>=2` only ever filters the supplement and the standalone 5m
  clusters.** Recording the wrong intermediate belief because it was load-bearing for two hours.
- **And a near-miss worth recording:** I had `structural_min_room = 25.875 pt` half-drafted as a
  contradiction of the taught 13.33-pt floor. **It is not one.** `structural_min_room` is the
  **weak-blocker room test for NON-meaningful destinations**; the TP floor is the separate, correct
  `TP1_REFERENCE_REWARD_UNDER_400` at `target_policy.py:163-168`, with `BLOCK`-not-roll semantics
  matching `too_close_rule` and `no_blind_rollover` exactly. **The $400 rule is built and faithful.**
  I caught this by reading the live gate instead of the first same-named function I found.

## 3. WHAT IS NOT ORDERED, and why that restraint is the whole point

**No repair is authorized by this ruling.** The obvious move — apply
`touches>=2 AND quality>=min_zone_quality` to the `KEY_ZONE_15M` family too — is **exactly the trap**:

1. **It would delete the entire exceptional single-swing family from the destination universe**
   (`levels.py:166`, every swing zone is `touches=1`), which is a large semantic change with no
   citation behind it.
2. **`touches >= 2` has NO citation as a DESTINATION rule in any held surface.** Searched:
   `semantic_crosswalk.target_hierarchy`, `direct_trader_rules.tp_ladder`,
   `user_fidelity_gold` fixtures, `video_evidence.md`. The taught destination rule names three
   families and the word `meaningful`, and **defines `meaningful` nowhere** —
   `no citation found in the surfaces named`.
3. Reusing an existing frozen magnitude does not make a change derived. **A number that is frozen
   for one purpose is still an invention when borrowed for another** — the same reason `$400` may not
   be borrowed as a zone-width cap (ALGO-121 §3).

**ORDERED instead — one census and one derivation, both to this desk, no code:**
- **(a) the `meaningful` provenance census** — every site that sets or reads the flag, and for each,
  the surface that authorizes it, in ALGO-087's form. **`no citation found` is a complete answer.**
- **(b) the derivation question, put precisely:** *in his own words, what makes a 15m S/R reaction a
  destination he would carry rather than a level he trades through?* The held corpus says
  `farther_feature_may_not_leapfrog_nearer_meaningful_reaction`, `processed_rollover_rule`, and
  `fvg_edge_can_define_reaction_level` — **the answer may already be in there and must be looked for
  before anything is invented.** **The evidence baseline is CLOSED — nothing goes to the operator.**

**STOPS, unchanged:** no TopstepX of any kind · no magnitude under the frozen contract · **no change
to `targets.py` or `target_policy.py` tonight** — the band build owns the tree · no width cap · the
rank at `kernel.py:207` untouched.

## 4. Where this leaves the operator's question

**The entry half is measured and repairing tonight** (ALGO-121 §2: map `865 → 522`, established
identical by key 14/14). **The exit half is now located, cited, and NOT yet repaired** — and it is
located in a place that costs nothing to *state* and must not be *changed* without a derivation.

**Both halves are the same defect wearing two costumes: a map that admits everything, and a
destination predicate that was written to filter it but was never wired to the family it had to
filter.** Neither repair adds a degree of freedom. **That is still the anti-overfit argument, and it
is now supported at four executable lines instead of one.**

---

**LESSON, minted:**

> **A PREDICATE THAT IS HARDCODED `True` FOR THE DOMINANT CASE IS NOT AN UNIMPLEMENTED RULE — IT IS
> AN IMPLEMENTED RULE THAT CANNOT REACH ANYTHING. AND IT READS AS DONE IN EVERY REVIEW, BECAUSE THE
> FUNCTION EXISTS, THE FIELD EXISTS, AND THE GATE CONSUMES IT.**

Grepping `meaningful` returns a definition, a call site, and a consumer — **all three real, and the
family that matters routed around all three.** The only way to see it is to ask, for each *member of
the population*, **which branch actually set this flag.** `[existence-is-not-wiring]` has a second
form: **wired-for-some-inputs is not wired.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
