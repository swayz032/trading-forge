# WORKER REPORT — AR-1225 · 2026-08-15 · AR-1224 §5 — EVIDENCE-RELEVANCE GATE

## IT CATCHES ALL **8** MIS-GROUNDED CONDITIONS — INCLUDING THE TWO THAT FALSE-CLEANED.
## 🛑 AND IT INTRODUCES EXACTLY THE FAILURE CLASS YOUR §4 WARNED ABOUT. **It is not ready to be a hard gate, and I am not proposing it as one.**

```
RULING : AR-1224 §5 (relevance gate + reds A–D). Lane G closure remains REJECTED — this
         does not re-claim it.
PIN    : worker head 497308b75df67e8166d2d5c25696df261a19cfe1 — pushed, verified
ADDED  : src/engine/extraction/evidence_relevance.py + 9 tests; wired as stage 2 of the
         v2 pre-screen
TESTS  : 36 passed across the three helper suites. Local evidence only.
```

---

## 1. DESIGN — NOT "SHARE N KEYWORDS"

§4 forbids an absolute lexical threshold because it would reject faithful paraphrase. The gate
is **relative**: *does this span fit THIS condition better than the OTHER conditions of the same
strategy?* **Generic boilerplate fits everything equally — that is its signature.** A span that
grounds every condition grounds none.

---

## 2. TWO CORRECTIONS MY OWN REDS FORCED

Worth recording, because the first design was wrong in a way that looked right:

1. **Unweighted term counting let the disclaimer "discriminate".** It shares the single common
   word `strategy` with one condition and nothing with the rivals — so a naive relative rule
   scored it as *grounding* that condition. Fixed with **rarity weighting**
   (`1/(1+document frequency)`): a word the speaker uses constantly carries almost no evidence
   about *which* rule a span supports.
2. **Discrimination alone still passed it**, because any non-zero score beats a zero rival. Added
   a floor — **derived from measurement, not chosen**:

```
generic disclaimer vs 5 real conditions : max own-score 0.019
four real evidence spans                : 0.34  0.34  0.37  0.48
```

An order of magnitude apart. `0.10` sits ~5× above the noise and ~3.4× below the weakest real
evidence. ⚠️ **Measured on ONE source** — it is a parameter, and a caller on new material must
re-derive it rather than assume it transfers.

---

## 3. REDS A–D — ALL REAL SPANS FROM THE PINNED TRANSCRIPT

| red | result |
|---|---|
| **A** the char-19546 disclaimer vs all five conditions | **refused**, every one |
| **B** the real 2R span vs the target condition | passes |
| **C** the real close-outside span vs the breakout condition | passes |
| **D** the real stop/wick span vs the stop condition | passes |
| **D′** a relevance PASS carries no geometry | asserted — the verdict object has no anchor, price or geometry field, so it cannot be misread as a stop primitive |
| paraphrase safety | a genuine paraphrase still passes |

---

## 4. END-TO-END ON THE REAL EXTRACTION

```
evidence=12  screened=12  flagged=7  MISGROUNDED=8  unresolved=[]
```

**It catches all six char-19546 conditions — including `entry_sequence[3].*` and
`stop.rationale`, the two that FALSE-CLEANED through the fidelity screen in AR-1223.** That
closes the false-clean gap you identified.

---

## 5. 🛑 AND IT FALSE-REJECTS A FAITHFUL PARAPHRASE — YOUR §4, EXACTLY

`entry_sequence[2].rationale` is refused as `MISGROUNDED_NO_OVERLAP` against a candidate that is
genuinely about it:

```
condition terms : fvg, entry, breakout, directional, initial, high, probability, point, provides
candidate terms : gap, enter, printed, outside, range, confirming, see, soon, trade
shared          : NONE
```

**Zero shared tokens because the extractor normalized `gap` → `FVG` and `enter` → `entry`.** That
is not irrelevance; that is the terminology normalization §4 predicted a lexical rule would
punish.

⇒ **THIS GATE MUST NOT REFUSE ANYTHING YET.** It needs stemming (`enter`/`entry`) plus a
normalization map (`gap`/`FVG`) before it can be load-bearing. **I did not add either** — both
are new rules, and inventing a synonym map for a source-truth gate at the end of a long run is
exactly how a plausible-but-wrong primitive gets born. It is a ruling, not my initiative.

**So its current honest status: a strong ADVISORY signal that found a real defect the literal
fence is blind to, with a known and demonstrated false-reject mode.**

---

## 6. FINDINGS AGAINST MYSELF

1. §2 — my first design passed the very span it was written to catch. Two rounds of my own reds
   to fix it.
2. §5 — and the fixed version now fails a faithful paraphrase. **The gate has both error
   directions demonstrated, which is the only reason its status is honest.**
3. I am **not** re-claiming Lane G closure. Your rejection stands: this is still a sidecar and
   the wiring into the real Phase-1 → certificate route has not been done.

---

```
STOP   : Reporting before adding stemming/normalization. That is the decision point.
NEXT   : yours:
         (1) does the relevance gate get stemming + a normalization map, and if so who owns
             the map — it is a source-truth artifact, not a convenience;
         (2) the mis-grounding itself: 8 of 12 conditions have no valid evidence. Even with
             a perfect gate, that extraction cannot be graded until the locator is repaired
             or re-run. That is the upstream blocker your AR-1224 §2 named;
         (3) Lane G's real wiring into the Phase-1 route, still open;
         (4) stop geometry, the 40-ID surface, and the two AR number collisions.
         Recommendation: (2). The gate now measures the damage precisely — 8 of 12 — and
         that number is the argument for whatever the locator repair turns out to be.
```
