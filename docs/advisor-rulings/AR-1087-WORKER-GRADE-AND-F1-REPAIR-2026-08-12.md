# AR-1087 (worker) — THE GRADE: VERIFIED ON THE CLAIM, AND IT FOUND A HIGH I HAD MISSED

**Governing:** AR-1082 §5.7, §5.8 · **Graded pin:** `4936aae8` · **Pin now:** `744ab54f` (pushed)
**Full verdict, committed and fetchable:** `docs/designs/GRADE-SOURCE-BCDF-VERTICAL-2026-08-12.md` (476 lines) at `11efed54`. **This is a pointer, not a substitute — read it.**

---

## 1. VERDICT

**Band 7 — VERIFIED.** The claim as worded is CONFIRMED; the grader could not refute it.

**And it did not grade from my fixture.** It built its own session at ~2050–2150 and an oracle importing **nothing** from `src.engine`. Through the real `bt.main.callback`, all seven load-bearing values matched its independent arithmetic: `entry_idx=8`, `Avg Entry Price=2088.0`, `Long`, `risk_points=27.0`, `stop_basis='source_exact'`, `Avg Exit Price=2142.0`, `exit_reason='source_fixed_r_target'`, `Size=1.0`; `GrossPnL=270.0 = 54 × $5`. **No constant shared with my 111.5 / 119.0 / 7.5 / 134.0.** That is the answer to "are your greens an artifact of one hand-built fixture" — they are not, and I could not have established that myself.

Two of my named attack surfaces survived on evidence I did not have: **per-session OR** (a session whose own ORH refuses the zone my session's ORH accepts — `raw=1`, with `raw=0` as control), and **same-candle entry order**, which now has the fixture my structural claim lacked. **Attack #3's named sub-case is structurally unreachable** — two zones sharing `start_idx` implies `low[i] > high[i-2] >= low[i-2] > high[i] >= low[i]`, a contradiction.

---

## 2. F-1 (HIGH) — REFUTATION FOUND, AND IT IS REPAIRED

**`main()`'s `mode="walkforward"` branch calls `run_walk_forward_class()` WITHOUT `source_risk_mode`** — its single-run sibling forty lines below does pass it — **and `walk_forward.py` contains ZERO occurrences of `source_risk`.**

So a SOURCE_FAITHFUL artifact dispatched to walkforward took the **full legacy execution path**: the +1 roll, the house stop map at `entry_idx-1`, the ATR fallback, the ceiling clamp, Style C, the DLL halt, the 2/day cap — **while the compiler, which reads the mode off the artifact itself, still built source events.** No refusal. No red. The two halves disagreed silently, and the resulting numbers would have been plausible, well-formed and not the teacher's.

The grader proved it two ways: the call signature, and executing both modes on one config — `single: rollover=40, mode='SOURCE_FAITHFUL'` vs `walkforward: rollover=19 ≠ gate=20, mode=None`, having first measured the legacy arm at `raw=0` on that identical price action so the `raw=20` could only be the source population.

**It quoted my own comment back at me:** the roll skip and the map offset "are the SAME decision expressed twice." On that arm neither was expressed at all.

★ `THE OFF BRANCH IS WHERE THE DEFECT LIVES — OFF MUST REFUSE, NEVER FALL BACK.`

**REPAIRED at `11efed54` — as a REFUSAL, not an implementation.** AR-1079 §9 is explicit that walk-forward source-risk transport is not certified and that B/C/D/F must not widen into it. Threading the mode through would be that widening *and* would enable an unproven path. The refusal enforces the ruling's own boundary instead of leaving it uncertified-but-running. `AN UNCERTIFIED PATH THAT STILL EXECUTES IS NOT AN OPEN QUESTION, IT IS AN ANSWER NOBODY CHECKED.`

Two ablations, **disjoint** red sets: removing the refusal kills exactly the two refusal tests; making it fire for every artifact kills exactly the two positive witnesses (legacy and TF_OVERLAY_VARIANT must still REACH walkforward). A guard that refused everything would have passed both refusal tests.

---

## 3. F-3 — MY WARMUP CLAIM IS PARTIALLY REFUTED, AND I AM DOWNGRADING IT

**`mode="single"` passes no `warmup_data`, so `warmup_rows = 0` and my timestamp rebase is the identity map. A naked-offset implementation would produce a byte-identical vertical proof.**

My unit-level `test_17b` *does* discriminate it — it drops two further rows so offset arithmetic lands late — but **the vertical route does not**, and AR-1085 implied the vertical green covered the rebase. It does not. Correcting that plainly rather than letting it stand.

---

## 4. F-2 (HIGH) — PRE-EXISTING, OUTSIDE MY CLAIM, AND IT REACHES PROP-FIRM COMPLIANCE

`backtester.py:8051` updates `Exit Idx`, `Avg Exit Price` and `PnL` but **never `Exit Timestamp`.** On the source arm every trade carries `Status:"Open"`, so that timestamp is the **last bar of the frame** — and `prop_sim.py:84-94` reads it.

**Consequence, measured on my own 3-session fixture: `overnight_violation: true` for a trade that entered and exited fifteen minutes apart.**

I did not introduce it and I am not opening it — but it is a false positive in the surface that decides prop-firm rule breaches, so I am escalating it rather than filing it. **Recommend a named unit for it.**

---

## 5. F-4 (MEDIUM) — MY DISCLOSED 67% IS 97.5% AT SCALE

40 sessions → `raw=40` → **1 trade.** I disclosed the three-session case (67% dropped) and pinned it as a test. The grader ran it at scale: the drop is **97.5%**, because the first position never closes in vectorbt's signal model and every later entry is ignored.

The mechanism is the one I described and is pre-existing, but the magnitude is not what my disclosure implied. **Any future source-faithful trade-count or performance claim is dominated by this, not by the source logic.**

---

## 6. F-5 (LOW) — REPAIRED, AND IT CONVICTS ME OF A NAMED PATTERN

`assert "REFUSING rather than mislabelling" not in msg` went vacuous when §8 retired that string. **I repaired the OTHER decayed control in that same file and never went looking for its siblings.** The grader enumerated the class — 8 negative string assertions across four files, 1 still decayed, behind a scanner self-test — and found it.

★ `I CLOSED THE INSTANCE AND CALLED THE CONDITION CLOSED.`

Repaired at `744ab54f`, repointed at the live subject, and **red-proofed**: with the contract gate applied to legacy too, the assertion goes red. It is a control again.

---

## 7. WHAT THE GRADER COULD NOT CHECK — ITS OWN COVERAGE SECTION, NOT MY SUMMARY OF IT

- **My "7 pre-existing failures across 63 files" is `RELAYED`, not verified.** It could not reconstruct my 63 denominator (`ls src/engine/tests/test_*.py` = **363**) and its censuses were still running. **It is right, and the correct answer is AR-1086**, which supersedes that claim with a 107-member committed population and an empty member-diff in both directions. `A COUNT IS NOT A JOIN KEY` — I should have named the seven.
- **Not measured by either of us:** real market data · DST / half-session / gap frames · unsorted frames (my `min/max(indices)` assumes contiguity — **HYPOTHESIS, untested**) · a ≤10-minute OR variant · post-RTH bars sharing an ET calendar date.
- **An environment fact worth having:** a plain `git worktree add` of `b609f039` is **impossible in this repo** — a `docs/replay-results/h1-scripts/frontier-birth-gate/...` filename exceeds Windows MAX_PATH. The grader needed two sparse-checkout widenings. My own baseline worktrees succeeded only because I removed them immediately.
- **Confirmed against me where I was right:** the rewritten Style-C tests weakened nothing (31→34, a vacuous negative replaced by a positive `raises`); and the FVG bypass changed **0 differing lines** across 16 legacy specs, with a planted-bad control flipping **5 of 18** specs across **14 reachable conditions** — so that null is not vacuous.

---

## 8. STATUS AND WHAT I RECOMMEND

AR-1082 §5: **steps 1–5 DONE · 6 PARTIAL · 7 DONE · 8 DONE (this).**

Open, none of them started: **F-2** (prop-sim false positive, HIGH, needs its own unit) · **F-4** (signal-to-trade collapse, blocks any trade-count claim) · **F-3** (the vertical route does not discriminate the rebase) · discriminators 11, 12, 14, 15, 16 without committed Band C tests · the unsorted-frame contiguity hypothesis.

**My recommendation: F-2 next.** It is the only open finding that produces a WRONG ANSWER in a surface that decides prop-firm rule breaches, and it is independent of everything else here.

One leftover I could not clear: `C:\b609`, the grader's sparse baseline worktree — `git worktree remove --force` returns *Permission denied* (a lock, not a git state). The worktree registration is pruned; the directory is inert and cosmetic, and I did not force it. **Pin `744ab54f`.**
