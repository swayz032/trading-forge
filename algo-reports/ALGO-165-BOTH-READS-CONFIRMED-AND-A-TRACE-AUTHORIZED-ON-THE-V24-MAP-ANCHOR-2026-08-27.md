# ALGO-165 — **BOTH READS CONFIRMED, RULED BEFORE THE NUMBER LANDS. (1) A FIXED `3.83R` TARGET IS FORBIDDEN TWICE OVER — IT CONTRADICTS HIS RATIFIED §7 *AND* PUTS HIS VOLUNTEERED FIGURE INTO A PREDICATE, WHICH A STANDING RAIL BANS. THE NEAREST-ZONE-EDGE READING IS CORRECT AND THE AST GUARD IS THE RIGHT INSTRUMENT. (2) THE `08:00` MAP ANCHOR IS FORCED, NOT CHOSEN.** **🛑 AND THE OBSERVATION THAT FELL OUT OF IT IS RATIFIED AS AN OBSERVATION AND NOTHING MORE: `v2_2_engine.py:897` anchors v2.4's map at `09:30` while `:43` starts entries at `08:00` — VERIFIED HERE AT ALL THREE LINES. I AM RULING NO LOOKAHEAD AND AUTHORIZING A TRACE, BECAUSE ALGO-137 IS MY OWN CONVICTION FOR PUTTING EXACTLY THIS HYPOTHESIS TO THE OPERATOR BEFORE IT WAS CHECKED.** **The committed comment beside the anchor defends it as deliberate on the grounds that moving it *"would silently invalidate every number in the campaign"* — 🛑 THAT IS AN ARGUMENT ABOUT MEASUREMENT CONTINUITY AND NOT ONE ABOUT SOUNDNESS, AND NOTHING IN IT ADDRESSES WHETHER AN `08:15` DECISION MAY CONSULT A MAP BUILT FROM `09:15` BARS.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `db0502a5`.
**Strategy frozen `7c5ffc77`, runner `779a4729`.** **PR #38: DRAFT / DO NOT MERGE. No v2.4 edit
authorized here or anywhere.**

---

## 1. READ 1 — **CONFIRMED. DO NOT RE-RUN. THE FIXED-R READING WOULD HAVE BEEN A RAIL BREACH.**

**You read it correctly and you read it against the right authority.** A fixed `3.83 × 17.25 = 66.06`
pt target fails **two independent standing constraints**, either of which alone is fatal:

1. **His ratified §7** — the target is **the nearest meaningful reaction, never skipped for a farther
   one**, `no_blind_rollover`. A fixed multiple skips whatever sits between entry and `66.06`.
   **`MNQ-STRATEGY-SPECIFICATION.md` is operator-ratified — *"thats correct"* — so where code and
   confirmed method disagree, THE CODE IS WRONG.**
2. **`[operator-target-tiers-oracle-never-a-rule]`** — his `$1,000`/`$2,000` figures are **ORACLE,
   NEVER A RULE**, and **may not enter any predicate.** `3.83R` is `66.1 pts = $1,984` — **the same
   figure in R clothing.** ⇒ **putting it in a comparison node is the banned move wearing a unit change.**

> ## **`target = nearest map zone edge ahead of entry; NO ZONE AHEAD MEANS NO TRADE` IS THE CORRECT IMPLEMENTATION. `3.83R` IS A REPORTING REFERENCE, AND AN AST GUARD THAT FAILS THE BUILD IF IT REACHES A COMPARISON OR ARITHMETIC NODE IS EXACTLY THE RIGHT INSTRUMENT — IT ENFORCES THE RAIL STRUCTURALLY INSTEAD OF PROMISING IT IN PROSE.**

**🛑 AND THE AMBIGUITY WAS MINE.** ALGO-164 §5 said *"the `3.83R` geometry as a FROZEN INPUT"* — which
reads as a fixed multiple. **ALGO-161's own frozen-input row said `median 3.83R, LADDERED TO STRUCTURAL
DESTINATIONS`, and my restatement dropped the laddering.** **This is the SECOND time in three rulings
that a restatement of mine lost the part that carried the meaning** — ALGO-162's cap lost its UNIT
(`per session` → `per side`), this one lost its KIND (`laddered` → `fixed`).
**`[unjoined-duplicates-rot-together]` twice in one day, same author, same mechanism.**
⇒ **ordered into the method and binding on this desk: a constraint is restated by CITATION
(`ALGO-161 §4 row 2`), never by paraphrase.**

## 2. READ 2 — **CONFIRMED. `08:00` IS FORCED AND THERE IS NO PARAMETER HERE.**

**An entry at `08:50` may not consult a map built from bars up to `09:30`. That is not a tuning choice
and treating it as one would be the defect.** Confirmed.

## 3. 🛑 THE v2.4 OBSERVATION — **RATIFIED AS AN OBSERVATION. I RULE NOTHING. A TRACE IS AUTHORIZED.**

**[VERIFIED HERE at `de7e43fd`, all three lines read directly]**

| line | text |
|---|---|
| `v2_2_engine.py:43` | `TRADE_START = pd.Timestamp("08:00").time()` |
| `v2_2_engine.py:897` | `open_ts = pd.Timestamp(f"{d} 09:30", tz=TZ)` |
| `v2_2_engine.py:935` | `if ts.time() < TRADE_START` |

**And the committed comment at `:38-42` defends the anchor explicitly:** *"stays at `09:30`
deliberately: moving it would change WHICH S/R zones exist and **silently invalidate every number in
the campaign**."*

> ## **THAT COMMENT EXPLAINS WHY THE ANCHOR WAS NEVER MOVED. IT SAYS NOTHING ABOUT WHETHER IT IS SOUND. "IT WOULD INVALIDATE OUR NUMBERS" IS A COST OF CHANGING IT, NOT A DEFENCE OF IT — AND A DELIBERATE DECISION IS NOT A VERIFIED ONE.**

**🛑 BUT I AM NOT CALLING IT LOOKAHEAD, AND THE REASON IS ON THE LADDER IN MY OWN NAME.** **ALGO-137:
*"I WAS WRONG, AND I TOLD THE OPERATOR BEFORE IT WAS CHECKED. I put a lookahead hypothesis to him as
'this might be it'"*** — refuted at `kernel.py:269`. **`lookahead` returns 19 subject hits on this
ladder.** ⇒ **this desk has the worst possible record on exactly this claim and will not extend it on
a reading.**

**What the ALGO-137 refutation DID and DID NOT cover, because the scope is the whole question:**

| object | status |
|---|---|
| **zone STATE** — `zone_state_at_v24(loc.zone, full5, ts, p)` re-evaluated per bucket at `ts` | **REFUTED — causal, and correctly so** |
| **zone EXISTENCE** — WHICH zones the `09:30`-anchored `build_zones` admits | **NEVER TRACED** |

**Those are different objects and the refutation of one is not evidence about the other**
(`[instance-not-condition]`: name the mechanism, then ask what the enumeration over it is).
**Your restraint in flagging and not re-deriving is exactly right and is ratified.**

**AUTHORIZED — a READ-ONLY trace, no edit, and it is not a v2.4 change:** at a decision timestamp
strictly inside `08:00-09:30`, **does the location set available to that decision contain any zone
whose constituent pivots confirm AFTER that timestamp?** **Report by key: decision `ts`, zone id,
latest constituent `confirm`.** **A positive control is required — plant a zone that confirms after
the decision and show the instrument sees it — so that a zero is evidence about the code rather than
about a blind extractor** (`[absence-claim]`, `[guard-green-for-the-wrong-reason]`).

**Why it matters enough to run today, stated without inflation:** memory records **the bullet spent
before `09:30` on 14 of 14 sessions.** **IF the trace comes back positive, every v2.4 behavioural
number in that window is affected — the bullet census, `8 of 14`, the refusals.** **IF it comes back
negative, the question is closed and a comment that has been read as a justification for two weeks
gets replaced by a measurement.** **Both outcomes are worth the run and I am pre-registering that I
expect neither.**

**⚠️ AND A CONFOUND IN MY OWN ALGO-164 THAT THIS RAISES:** **CLEANROOM-v2 anchors its map at `08:00`;
v2.4 anchors at `09:30`.** If the `17 vs 13` comparison was run with the two maps anchored at
different instants, **v2.4's map carried 90 extra minutes of information** — which would make the
clean-room's win **understated, not overstated**, but the comparison would still not be like-for-like.
**Verify and state the anchor of the v1 map used in ALGO-163 when you next report. Do not re-run
anything against the fourteen sessions to establish it — read the artifact.**

## 4. THE REST OF THE PACKET — RATIFIED, BRIEFLY

- **`FIDELITY → FREEZE → CLEAN EDGE` honoured literally**: at `7c5ffc77` no runner existed, so no
  value in the strategy could have been chosen by a result. **That is the strongest form of the proof
  and it is better than the commit order I asked for.**
- **6 AST guards, 4 planted defects RED, byte-exact restore (`sha256 352818bd72a5e8fb`), one POSITIVE
  CONTROL.** **The docstring naming the artifacts it promises not to read would convict a substring
  check — you built the guard that survives its own promise.** Ratified.
- **Window stated and verified, not relayed: `2020-01-01..2026-03-08`, 1,925 sessions**, with `2015`
  and `2018` excluded because a 40-day lookback cannot cross a gap. **Correct, and it matches
  `[nq-ratio-adj-parquet-history-has-holes]`.**
- **The abandoned optimization is the right call.** *"An unproven optimization is a silent semantic
  change"* — and `~72` minutes is a cheap price for not having to defend an accelerated path.
  **`[precommit-stash]`'s lesson generalises: an instrument you cannot prove exact is a writer.**
- **The `FIRST_A_PLUS` limitation written into the module as a limitation rather than papered over is
  the correct disposition** and matches ALGO-164 §3. **Clock order is inherited knowingly, not
  chosen.**
- **Structural triggers only, direction from the INTERACTION rather than a stored role** — the latter
  also sidesteps the `Zone.side` live-role trap. Ratified.

## 5. AUTHORIZED

1. **Let the backtest finish on the exact frozen path. Change nothing while it runs.**
2. **Run the §3 trace** (read-only, positive control required). **It touches no v2.4 file.**
3. **Report the ALGO-163 map anchor from the artifact** (§3, last paragraph).
4. **When the number lands: report it with the window, the trade count, and the R-distribution —
   and make NO adoption decision in the same message.** **A result is a measurement; what to do about
   it is a separate ruling** (`[order-premise-grade]`).

**Not authorized:** any v2.4 edit · any parameter change · any re-run against the fourteen sessions ·
any Monte Carlo · any adoption of recency · any fixed-R target.

---

**LESSON, minted:**

> **A COMMENT THAT SAYS *"MOVING THIS WOULD INVALIDATE EVERY NUMBER IN THE CAMPAIGN"* HAS BEEN READ FOR TWO WEEKS AS A REASON THE THING IS RIGHT. IT IS A STATEMENT OF WHAT IT WOULD COST TO FIND OUT.**

**The most defended line in a codebase is often the least verified one**, because the defence is about
the blast radius of changing it rather than about the property itself. **`deliberately` is a word about
INTENT and it appears in the same sentence as a claim about CORRECTNESS, which is how it borrows the
authority.**

> **WHEN A COMMENT DEFENDS A CONSTANT BY NAMING THE COST OF MOVING IT, THAT IS NOT EVIDENCE THE CONSTANT IS CORRECT — AND IT IS A REASON TO MEASURE, NOT A REASON TO STOP.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
