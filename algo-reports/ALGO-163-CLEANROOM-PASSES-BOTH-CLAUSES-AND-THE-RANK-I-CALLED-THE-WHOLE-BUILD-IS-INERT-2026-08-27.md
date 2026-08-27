# ALGO-163 — CLEANROOM PASSES BOTH CLAUSES. **AND THE RANK I CALLED "THE WHOLE BUILD" IS INERT.**

**Strategy head:** `de7e43fd` — pushed, remote-verified (`git ls-remote` → `de7e43fd5a5d`).
**PR #38: DRAFT / DO NOT MERGE.**
**Semantic files modified: NONE.** No `current_mnq_strategy_v2_4_*` file was touched in either run.
v2.4 did not move while it was the comparison baseline. The clean-room builder's one-line cap
correction landed at `cb8739df` **before** the re-run and has not been touched since.
**Gate state:** `34 passed` — `test_current_mnq_strategy_v2_4_band_shape.py` (14) ·
`test_current_mnq_strategy_v2_4_levels.py` (12) · `test_algo_sunset_docs_agree.py` (8);
**enumerated by `--collect-only` (34 node ids), not read off a tail.**

---

## 1. THE RESULT YOU AUTHORIZED — **PASS, both clauses**

| clause | result | |
|---|---|---|
| **≤ 5 zones per session** | **3 on all 14**, mean **3.00** | ✅ |
| **overlaps > 13 of his 28** | **17 of 28** at exact overlap | ✅ |

**ALGO-162 pre-registered the adverse branch and I am reporting against it explicitly:** you wrote
that cutting `5.9 → ~3` *"removes about half the map. Coverage may fall from 17 to at or below 13,
in which case clause 2 FAILS … that is a real and likely outcome, it is the correct answer if it
happens, and it gets published as a FAIL."*

**It did not happen.** The map halved and coverage did not lose a single level. Checked directly:
**0 of his 28 were covered only by the dropped ranks 4–6.** The bottom half of the map contributed
nothing he drew.

**Both pads, per your instruction that they travel together from here:**

| | **clean-room** | **v2.4** |
|---|---|---|
| zones/session | **3.00** | **37.3** |
| his 28, pad 0.00 | **17** | 13 |
| pad 2.50 | **18** | 17 |
| **pad 10.00** | 20 | **25** |
| pad 0.00 · 7.25 arm | **17** | 16 |
| pad 2.50 · 7.25 arm | 19 | **20** |
| **pad 10.00 · 7.25 arm** | 20 | **25** |

**It still loses at pad 10.00, 20 vs 25** — *"what 37 zones buy."* Precision to the clean room,
blanket coverage to v2.4.

## 2. 🛑 THE PART THAT MATTERS MORE THAN THE PASS — I REFUTED MY OWN SPEC

`MNQ-SR-CLEANROOM-SPEC.md` §1, verbatim: ***"Rule 4 is the whole build … Here confluence count IS
the rank."*** **Measured false.**

| | |
|---|---|
| top-3 boundary decided **by confluence** | **0 of 14 sessions** |
| decided **by a tiebreak** | **14 of 14** |
| coverage **as built** | **17 of 28** |
| coverage **with confluence deleted from the sort key** | **17 of 28 — identical** |

**Cause, and it was knowable from my own spec before either run** — the second such defect in two
runs: **`5M_REACTION_CLUSTER` fires on 203 of 203 candidates.** Forty days of 5m pivots intersect
essentially any 15m band, so that family is a constant `+1`. `ROLE_FLIP` 83%, `ACTIVE_15M_FVG` 67%
⇒ **62% of candidates sit at the maximum.** A key that is flat where it must discriminate does not
discriminate.

⇒ **The PASS stands** — it was pre-registered on outputs, and the outputs hold. **The CREDIT does
not.** Rules 1 (cap), 2 (15m structure, 5m refinement) and 3 (≥2 reactions, band-overlap
clustering) built this map. **Rule 4 is dead weight.** The surviving distinction is worth keeping:
**confluence ACROSS independent families is inert here; repetition WITHIN one family — the member
count — carries the result.**

## 3. 🛑 THE HIGHEST-SCORING ARM, PUBLISHED AND REFUSED

Cap fixed at **3 in every arm**; only the sort key varies. **This is not a threshold search and
`TOP_PER_SESSION` never moved** — ALGO-162's prohibition is intact.

| arm | covers his 28 |
|---|---|
| **`RECENCY_ONLY`** | **22** |
| `AS_BUILT` · `NO_CONFLUENCE` · `MEMBERS_ONLY` | 17 |
| `CONFLUENCE_ONLY` | 6 |
| *v2.4, 37.3 zones/session* | *13* |

**`RECENCY_ONLY` beats my build by 5 and v2.4 by 9, from three zones a session. I am not adopting
it.** `run_algo163_cleanroom_rank_ablation_2026_08_27.py` carries this **written into the file
before it was run**: *"no arm of this ablation licenses a change to `mnq_sr_cleanroom_v1.py`. If an
arm scores higher, that is a FINDING ABOUT THE CLAIM, not a candidate build."*

**Recency is not one of ALGO-161's four published rules.** Promoting it on a score would be adding
a fifth rule chosen by what it does to his fourteen sessions — the contamination this build exists
to exclude, **arriving at the last step wearing a result as its credential.** It may not even be
real: recent levels are nearest the session he was drawing for, so this is either genuine S/R decay
**or** a labelling artifact, and **this instrument cannot separate them.**

## 4. WHAT I AM **NOT** CLAIMING

- **No profitability claim.** No PnL read; R-geometry is a frozen input and was never tested.
- **No licence to change v2.4.** Not proposed, not edited, did not move.
- **No claim that confluence ranking works.** Measured inert.
- **The contamination limit is carried, not filed:** a person with three days of exposure choosing
  which published rules to adopt is a channel no commit order closes. **A commit order is evidence
  about FILES, not about a MIND.** §3 is the sharpest evidence I can offer that the discipline is
  load-bearing rather than decorative — **the better-scoring arm is measured, published, unadopted.**

## 5. WHAT I AM ASKING YOU TO RULE ON

1. **Is the PASS accepted** given that the mechanism credited in the spec is refuted? My own read:
   the acceptance was pre-registered on outputs and holds, but the spec's §1 should be marked
   REFUTED in place rather than quietly rewritten.
2. **Does the inert rank get repaired, retired, or left standing as measured?** A repair means
   re-deriving a discriminating family set from published practice — **and I am not doing that
   without a ruling, because "pick families until the rank separates" is threshold search wearing
   a different hat.**
3. **Anything further on this lane at all**, or does the clean-room build close here as a completed
   comparison?

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this packet.*
