# ERRATUM — the published `DEV-14` partition list

**R-459 step (2) · 2026-07-29 · AR-445/446 · ADDITIVE. Nothing in the frozen artifact was altered.**

> ★★★★★ **THIS DOCUMENT DOES NOT REPLACE ANYTHING. It corrects ONE list inside
> `SHADOW-EVAL-FREEZE-AND-RESULTS-2026-07-29.md` and leaves that file's bytes exactly as
> frozen. A frozen artifact whose bytes can be edited was never frozen; the correction is a
> new document that points at the old one.**

**CORRECTS:** `docs/designs/SHADOW-EVAL-FREEZE-AND-RESULTS-2026-07-29.md`, the `DEV-14`
enumeration under **STEP 1 — THE FREEZE**, lines 26–28.

---

## 1 — THE ONE-LINE VERDICT

**The published `DEV-14` LIST is wrong in four places. Every RESULT in that document is
correct and reproduces to the digit. The run used the right population; the document's
typed-out list did not describe it.**

★★★★★ **AND THE COVENANT SURVIVES INTACT: the `HOLDOUT-26` list published in
`SEMANTIC-ROLE-MIGRATION-PACKET-2026-07-29.md` (the AR-405 amendment) is [MEASURED] IDENTICAL
to the mechanically-emitted complement — 26 of 26, zero difference. The anti-overfitting
covenant protects exactly the right videos.**

---

## 2 — THE DEFECT IS PROVABLE FROM THE TWO PUBLISHED DOCUMENTS ALONE

★★★ **Before any measurement of mine, the two published lists CONTRADICT EACH OTHER. A reader
holding only those two documents could have caught this:**

| | |
|---|---|
| appears in **BOTH** the published `DEV-14` **and** the published `HOLDOUT-26` | ★★★ **`x1ydP8bC7OE`** — it cannot be in both halves of a partition |
| appears in **NEITHER** published list, though both are drawn from the same 40 | ★★★ **`ktkqq7QsN9Q` · `sVkmZklJDHI`** |
| appears in the published `DEV-14` but is **not in the population at all** | ★★★★★ **`psH--oXkD8M`** — [MEASURED, AR-444] not in the frozen census and **`0` rows in the live library** |

★★ **A partition whose two halves overlap on one member and jointly omit two others is not a
partition. That is an internal contradiction, not a judgement call.**

---

## 3 — THE CORRECTED LISTS, EMITTED — NOT TYPED

★★★★★ **INSTRUMENT: `docs/replay-results/h1-scripts/regen_shadow_partition.py`. The block below
is its VERBATIM stdout. No name in it was typed by hand, and `HOLDOUT` is emitted as the
COMPLEMENT of `DEV` over the population — never as a second maintained list, because two
hand-maintained complementary lists is precisely how these drifted apart.**

```
POPULATION            40  (== census, verified)
PARTITION             DEV-14 / HOLDOUT-26
PATH A (run labels) == PATH B (split-file derivation): YES

DEV-14:
  75DJN5UVQnw
  FqxEKDxemtI
  HfZTCZTDfWk
  KXWRtV2LOVc
  N7uP9V0Iktc
  NMUd0oX_7Pg
  UBvfsImdI2U
  c8VLqF0XDR4
  jlShztsY3oA
  ktkqq7QsN9Q
  m-G1ag77aVc
  oDLt9zh33LE
  sVkmZklJDHI
  snNkQSyWX4k

HOLDOUT-26 (emitted as the COMPLEMENT, never enumerated by hand):
  1HFoStW_wsc
  7ieYBa7Z-Hg
  E8Wg6tFPYjo
  FAKWJ-1NlLE
  LOcaRWcc1xI
  N7SM8a7Dc9s
  Qxlu8v_6G3Y
  VTEQ2fhGLqE
  WV1fyudd7fw
  aHLIE_TXjpo
  bQp37aD1JLE
  dE4lPhAWke8
  dHmOosYof48
  deymRD3kSD0
  e5HQXYBUW-Q
  gddYspvW0_w
  h6TnE7QClJg
  iU8ww5MC2FQ
  l-2iKbcm5UI
  lRMFcsqhYBU
  mNcoaNdAyIE
  nV9gknhy2Ew
  qLtq73bTPBA
  x1ydP8bC7OE
  xTTDH5iRhJc
  z3Qn3fBoe2I

R-459's four named videos, checked against the census MYSELF:
  psH--oXkD8M    ruling says OUT | emitted OUT | in census: NO | AGREE
  x1ydP8bC7OE    ruling says OUT | emitted OUT | in census: yes | AGREE
  ktkqq7QsN9Q    ruling says IN  | emitted IN  | in census: yes | AGREE
  sVkmZklJDHI    ruling says IN  | emitted IN  | in census: yes | AGREE
```

★★★ **R-459 named four videos and told me to VERIFY them rather than adopt them. All four agree
with the emitted partition, and I checked each against the census myself rather than
inheriting the claim.** ★★ **`x1ydP8bC7OE` is IN the census — it is a genuine `HOLDOUT`
member. Only `psH--oXkD8M` is outside the population.**

### WHY TWO PATHS

The instrument derives `DEV` **twice** and refuses to emit unless they agree:

- **PATH A** — the run's own `pop` labels in `shadow_rows.json`.
- **PATH B** — the *stated* derivation re-applied: the harness's own line-11 regex
  (`/[A-Za-z0-9_-]{11}/`, **ported verbatim, not reimplemented**) over the split file's
  `rules_design_keys`, intersected with the run population.

★★ **They agree. A single path could have reproduced the same mistake twice; the point of the
second is that it is the derivation the FROZEN DOCUMENT CLAIMS, so agreement means the claim
and the run finally match.**

---

## 4 — WHAT IS **NOT** CORRECTED, AND WHY THAT MATTERS MORE

★★★★★ **THE RUN IS CLEAN. [MEASURED, re-derived from the retention copy] its population is the
census 40 EXACTLY — nothing in, nothing out — and its actual `DEV` is the split file's 14
exactly. `psH--oXkD8M` NEVER ENTERED THE EVALUATION.**

| figure | re-derived here | as published |
|---|---:|---:|
| `DEV14` conditions / videos | **575 / 14** | 575 / 14 ✔ |
| `HOLDOUT26` conditions / videos | **1776 / 26** | 1776 / 26 ✔ |
| `DEV14` `LEGACY_FALLBACK` | **510 (88.7%)** | identical ✔ |
| `HOLDOUT26` `LEGACY_FALLBACK` | **1704 (95.9%)** | identical ✔ |
| `DEV14` rules fired | **65 (11.3%)** | identical ✔ |
| `HOLDOUT26` rules fired | **72 (4.1%)** | identical ✔ |
| total rows | **2351** | 2351 ✔ |

**THEREFORE THESE STAND UNCHANGED:** the **VOID** verdict under the pre-registered criterion ·
the `4.1%` vs `11.3%` contamination gap · the ARM-B `0 of 2351` result.

★★★★★ **THE EMITTER WAS RIGHT; THE DOCUMENT DRIFTED FROM IT. `A REPORT'S TABLE IS AN
INSTRUMENT'S OUTPUT, NOT A TRANSCRIPTION` — and this is that law's cost, paid in the one field
a reader would use to check independence.**

---

## 5 — HOW THE FOUR SUBSTITUTIONS AROSE: **[NOT DETERMINED]**

★★★ **I will not invent a mechanism for this.** What is ruled out:

- **The harness could not have emitted it.** `DEV = all.filter(v => designVideos.has(v))`, so
  `DEV ⊆ designVideos` structurally, and `designVideos` provably excludes `psH--oXkD8M` and
  `x1ydP8bC7OE` (I ported line 11 and ran it).
- **Two of the names are not in the split file at all.** `grep -o` counts over it:
  `psH--oXkD8M` **0** · `x1ydP8bC7OE` **0** · `ktkqq7QsN9Q` **30** · `sVkmZklJDHI` **10** ·
  **positive control `75DJN5UVQnw` = 1.** ★★ The probe finds ids in that file; it cannot find
  those two.
- **An index-shift into the 41-long `POP-41` list — HYPOTHESIS FORMED AND FALSIFIED.** Mapping
  each correct-`DEV` index from `sorted(corpus40)` into `sorted(gen41)` yields `qLtq73bTPBA`,
  which is in neither list. ★★ **Killed because it was wrong, not kept because it was tidy.**

---

## 6 — STANDING REQUIREMENT

★★★★★ **NO POPULATION LIST IS EVER TYPED INTO A DOCUMENT AGAIN.** It is emitted by an
instrument, pasted verbatim, and the instrument is committed beside the claim. Where a
partition is published, **only one half is enumerated and the other is emitted as its
complement.**

**Retention copy of the harness, its input and its output (outside git, read-only, hash-verified):**
`backups/h1-shadow-eval/shadow-eval-edaa0c14/` — see its `README.md` for the provenance limit
on `shadow_rows.json`, which is stated rather than papered over.
