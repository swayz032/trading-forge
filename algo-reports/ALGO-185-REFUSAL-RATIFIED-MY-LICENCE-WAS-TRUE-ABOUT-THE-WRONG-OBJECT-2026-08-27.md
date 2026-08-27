# ALGO-185 — **THE REFUSAL IS RATIFIED AND IT CONVICTS MY OWN LICENCE. I WROTE *"PIVOTS ON A 15M FRAME CANNOT CHANGE BETWEEN 15M CLOSES"* AND MADE IT THE WHOLE AUTHORISATION. IT IS TRUE, AND IT IS ABOUT PIVOTS — I ASSERTED IT ABOUT ZONES.** **[VERIFIED HERE at `031dfc29`] `v2_2:443` SLIDES THE 40-DAY LOOKBACK EDGE WITH `asof`, `:487` RECOMPUTES A RECENCY-WEIGHTED `center` EVERY BUCKET, AND `:519` PUTS THAT CENTER IN THE ZONE ID. TWO INDEPENDENT MECHANISMS, BOTH CONTINUOUS.** **MEASURED: BANDS DIFFER AT `28 of 448` INTRA-WINDOW STEPS (`6.2%`), IDS AT `11 of 448`, AND `6 of 448` FROM THE LOOKBACK EDGE ALONE WITH THE CENTER EXCLUDED. `R:2026-03-18T14:45` MOVES `15 TICKS` BETWEEN `09:30` AND `09:35` ON THE SAME PIVOTS.** **🛑 AND THE `45.5`-HOUR COST STANDS UNIMPROVED — SO THE FIDELITY GATE IS CLOSED AND THE BACKTEST IS NOW BLOCKED ON RUNTIME ALONE. THE ROUTE THROUGH IT IS NOT AN APPROXIMATION: `1,925` SESSIONS ARE INDEPENDENT AND PARALLEL EXECUTION IS EXACT BY CONSTRUCTION.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `dc9ae15a`.
**Strategy head `031dfc29`.** **PR #38: DRAFT / DO NOT MERGE.**

---

## 1. RATIFIED — AND TESTING THE LICENCE FIRST IS THE WHOLE POINT

**ALGO-175 §5 said the optimisation's licence was *"a fact about the data… never a runtime figure."*
⇒ THE LICENCE WAS THE AUTHORISATION.** **You tested the licence before building anything, it failed,
and nothing was built.** ⇒ **exactly the obligation, executed exactly.**

> ## **MY LICENCE WAS TRUE ABOUT PIVOTS AND I ASSERTED IT ABOUT ZONES. A ZONE IS NOT A PIVOT — IT IS A RECENCY-WEIGHTED AGGREGATE OVER A SLIDING WINDOW OF PIVOTS, AND BOTH OF THOSE MOVE CONTINUOUSLY. I MADE A TRUE STATEMENT ABOUT THE WRONG OBJECT AND HANDED IT OVER AS A PERMISSION.**

**That is ALGO-155's shape** — *a true finding about the wrong object* — **and it is mine again, this
time as an authorisation rather than a finding.** ⇒ **the third time today the desk's own artefact was
the defect: `C` blind to a zone family, `P1` blind to a call site, and now a licence blind to the
difference between a pivot and a zone.**

**And the second mechanism is what makes the refusal robust rather than marginal:** `6 of 448` change
**with the center excluded entirely** — the lookback edge alone. ⇒ **even a fix to the center would not
have rescued it, so there is no near-miss version of this optimisation.**

**Reporting NO achieved runtime is right and I want it named:** *"reporting one would imply something
ran."* **A performance figure is a claim that a thing executed.** **And declining to propose an
alternative because identifying one is a ruling — correct, and it is what §4 is for.**

## 2. 🛑 YOUR FIRST RED-PROOF UNDER THE NEW LAW BROKE THE NEW LAW — AND IT IS THE THIRD OF ITS KIND TODAY

**It matched `"different engine"`, a string that appears in the guard's OWN DOCSTRING, echoed by
pytest above the assertion.** ⇒ **it printed `RED FOR THE PLANTED REASON` while reading prose the guard
had written about itself. A red-proof certifying itself.**

**This is the same mechanism three times in one day, on three different instruments:**

| # | instrument | what it read |
|---|---|---|
| 1 | the builder's cleanliness grep | **its own docstring**, which named the forbidden strings |
| 2 | the mutation harness | **a docstring**, so the mutation changed no code and still went RED |
| 3 | **this red-proof** | **the guard's own docstring**, echoed by pytest |

> ## **PROSE INSIDE AN ARTIFACT IS PART OF THAT ARTIFACT'S SEARCHABLE SURFACE, AND EVERY TEXT-MATCHING INSTRUMENT WILL READ IT. A DOCSTRING IS DATA. THE MORE CAREFULLY A GUARD DOCUMENTS WHAT IT FORBIDS, THE MORE RELIABLY IT PLANTS THE EVIDENCE OF ITS OWN COMPLIANCE.**

**Adopted as an addendum to `[red-for-the-wrong-reason]`: parse the INSTRUMENT'S STRUCTURED OUTPUT, not
its transcript.** **Your fix — read only pytest's `E ` assertion lines and require the planted value BY
NAME — is the correct general form**, and the resulting line is the proof:
`E  AssertionError: … the kernel anchors on ['ts'] and the X-ray on ['warmup_ref']`.

**The law was an hour old and you broke it on first use, found it yourself, and reported it in the
title.** ⇒ **a law's first violation is its most informative test, and this one arrived free.**

## 3. 🛑🛑 THE MIRROR-CLAIM-AS-GUARD IS THE GENERAL ANSWER TO TODAY'S RECURRING DEFECT

**Today produced four claims that were true when written and false later, none of which anyone edited:**
`"causal pre-open structure"` · `"a second copy of the 09:30 literal"` deleted · `"grep returns zero"` ·
`"mirroring candidate_xray.py and kernel.py"`.

**Your fix is not a better comment. It is an executable join:** **whatever the kernel anchors on, the
X-ray must anchor on the same NAME** — asserted **against the kernel**, not against a literal.

> ## **A PROSE CLAIM ABOUT ANOTHER FILE'S BEHAVIOUR HAS NO WAY TO NOTICE WHEN THAT FILE CHANGES. THAT IS `[unjoined-duplicates-rot-together]` WITH ONE COPY IN CODE AND ONE IN ENGLISH — AND THE ENGLISH COPY IS THE ONE EVERYONE TRUSTS.**

⇒ **STANDING: a cross-file agreement claim is either an executable join or it is decoration.** **This is
the most transferable thing in the packet and it generalises past this campaign.**

**And the `meta` handling is right for the same reason:** `premarket_primary` / `premarket_structure` /
`authorized_locations` **were session-level facts about a session-level map.** **The object changed
shape, so a single value would now be a session-level claim about a per-decision object** — recording
them at the first decision bucket **and labelling them** is the honest form. **Both census artifacts
stamped `MEASURES THE PRE-REPAIR ENGINE`, not deleted, not re-scored.** Ratified.

## 4. THE RUNTIME — RULED. THE ROUTE IS PARALLELISM, NOT APPROXIMATION.

**`45.5` hours stands, and it is now the ONLY thing between this campaign and the operator's stated
destination.** **But it is a throughput problem, not an exactness problem:**

> ## **THE `1,925` SESSIONS ARE INDEPENDENT. EACH BUILDS ITS OWN MAP FROM ITS OWN 40-DAY READ AND WRITES NOTHING ANOTHER SESSION READS. RUNNING THEM ACROSS N PROCESSES IS NOT AN OPTIMISATION OF THE ALGORITHM — IT IS THE SAME CODE ON THE SAME INPUTS, N TIMES OVER. THERE IS NOTHING TO PROVE EXACT BECAUSE NOTHING IS APPROXIMATED.**

**AUTHORIZED — parallel execution across sessions, on two obligations and no others:**
1. **PROVE INDEPENDENCE, do not assume it.** **Enumerate every module-level mutable and every cache on
   the run path** (`global`, `lru_cache`, module dicts/lists, any `_MEMO`) **and show the set is
   empty or read-only.** **[This desk's grep found only constants at `kernel.py:43-74` — that is a
   lead, not a proof, and it is not evidence about `v2_2_engine` or `levels`.]**
2. **PROVE DETERMINISM.** **Run the SAME session in two separate processes and compare the full result
   BY KEY.** **Then run one session inside an N-way pool and alone, and compare.** **Identical or the
   pool is refused.**

**Report the achieved wall-clock and the worker count. `45.5` hours across a healthy pool is hours,
not days — and if it is not, that is a finding and the sequential run is still the correct fallback.**

**NOT authorized:** any sampling of sessions · any reduction of the horizon · any approximation of the
map · any parameter change to buy speed.

## 5. THE FIDELITY GATE IS CLOSED

**Two causality defects found, enumerated, repaired at source, and guarded structurally.** **One
optimisation refused on its own licence.** **One diagnostic restored to the thing it claims to mirror,
with the claim converted into a guard.** **Every superseded artifact stamped rather than deleted.**

**`FIDELITY → FREEZE → CLEAN EDGE`: the first arrow is complete.** **What comes next is a separate
ruling with its own pre-registration, and nothing in this packet is an argument for it.**

---

**LESSON, minted:**

> **I HANDED OVER A ONE-SENTENCE LICENCE AND CALLED IT THE AUTHORISATION. THE SENTENCE WAS TRUE. IT WAS ABOUT PIVOTS, AND THE THING BEING OPTIMISED WAS ZONES — AN AGGREGATE OVER A SLIDING WINDOW WITH RECENCY WEIGHTS, WHICH SHARES A DATA SOURCE WITH PIVOTS AND ALMOST NOTHING ELSE.**

**A licence stated as a fact about the data is the strongest form of authorisation this campaign has —
it cannot be fitted, it cannot decay, and it can be checked before anything is built.** **Which is
exactly why the OBJECT it names has to be the object being changed.**

> **WHEN YOU AUTHORISE SOMETHING ON A FACT ABOUT THE DATA, NAME THE OBJECT THAT FACT IS ABOUT AND CHECK IT IS THE OBJECT BEING TOUCHED. THE STRONGER THE LICENCE, THE LESS ANYONE RE-READS ITS SUBJECT.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
