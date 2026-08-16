# WORKER REPORT — AR-1229 · 2026-08-16 · AR-1226 LANE L1 items 1/2/6 + the AR-1228 corrections

> **AR-NUMBER COLLISION, FOURTH THIS CAMPAIGN.** I built this report as AR-1228 and found your
> AR-1228 ruling already on the branch when I fetched to publish. Renumbered to AR-1229 and the
> unpushed commit object was discarded, not force-pushed.

---

## CLAIM LEDGER — built BEFORE the headline, per AR-1228 §4

| # | CLAIM | STATUS | SCOPE | EVIDENCE | NEGATIVE CONTROL | LIMITATIONS | CI | WIRED |
|---|---|---|---|---|---|---|---|---|
| 1 | The locator re-run does not repair the golden slice | **PROVEN** | 2 driver runs + the committed run, sVkm only | 3 anchor sets, all drawn to the same disclaimer region | frozen `phase1.json` empty diff proves the runs are independent of it | 3 runs is not a rate; no other source tested | none at SHA | no |
| 2 | Cross-role disclaimer reuse reproduces on a fresh pass | **PROVEN** | sVkm pinned transcript+extraction | run 1: 4 refs on 19546–19757; run 2: 10 refs on the disclaimer | run-2 group verified as direct overlap (min pairwise 1.0), not an over-merge | does not identify WHY gemma prefers it | none | no |
| 3 | The anchor set is not reproducible across runs of the same instrument on the same pin | **PROVEN** | 3 runs | only 2 of 12 conditions bind to the same span in run 1 vs committed; run 2 differs again; locate path byte-identical (`git diff --stat` empty) | the byte-identical diff is the control — the variance cannot be my code | N=3, qualitative only, no stability rate claimed | none | no |
| 4 | Identical counts concealed a changed membership | **PROVEN** | committed vs run 1 | both 7 located / 5 unlocated; only 4 of 7 refs shared, only 2 of those same-span | — | run 2 breaks the count equality, so this is a property of that pair | none | no |
| 5 | AR-1228 §2's transitive-grouping gap is real | **PROVEN** | the detector | RED against representative grouping: `stop.rationale` dropped to a silent singleton, HIGH degraded to REVIEW | discriminator asserts A~C really is < 0.80, so the RED is not vacuous | synthetic spans; not observed in live data | none | no (advisory) |
| 6 | The gate no longer auto-refuses on HIGH | **PROVEN** | the detector | `HELD_FOR_ADJUDICATION`; negative control asserts the cluster leaves the auto-accept path, not that it was convicted | positive control: same-role reuse stays on the accept path | — | none | no |
| 7 | One run-1 accepted condition was anchored inside the disclaimer block | **PROVEN** | `confluences[0].description`, run 1 | span 19845–19997 ⊂ 19546–19997, measured, with a positive control | a span known outside correctly reports outside | containment is measured; I do **not** issue the semantic verdict that the quote is wrong | none | no |
| 8 | The collision gate is blind to a solitary mis-grounding | **PROVEN** | the detector, by construction | pinned as an explicit limitation test | — | — | none | no (advisory) |
| 9 | Why the locator prefers the disclaimer (prompt / single-pass / relevance-is-primary) | **UNRESOLVED** | — | three readings stated, none chosen | — | I did not test between them; choosing is an instrument decision | — | — |

**Publication rule applied:** everything in the headline and in §7 below restates a PROVEN row at
its ledger scope. Claim 9 is carried as UNRESOLVED and is not summarized as a finding.

---

## HEADLINE

**The locator re-run is not a repair.** Three runs of the same instrument on the same pinned
input produce three different anchor sets, and all three are drawn to the same generic
disclaimer. Your §6 sequence assumes L1 can yield a trustworthy binding set; measured, in its
current form it cannot. **Your §2 chain-overlap gap was real and is now closed. Your §9.5
"do not auto-refuse solely on HIGH" contradicted the code I had already pushed; corrected.**

```
RULING : AR-1226 §6 LANE L1 items 1/2/6 (executed) + AR-1228 §2 and §9.5 (corrections)
         + AR-1228 §4 claim ledger (this report is the first under it)
PIN    : c24a03059865e280cb63620c334369bc2320b2a9
         (first push 586b091b9afdc8e12f1f41a96191291c1e44a490 — pre-AR-1228 semantics)
         worktree C:\Users\tonio\Projects\wt-claude-worker1-20260815
         branch claude/worker1-h1-20260815 — pushed, ls-remote verified with a negative control
CHANGED: scripts/svkm_locator_reissue_v2.py                     new driver
         .../grade/locator_reissue_v2_run1.json                 new artifact (run 1)
         .../grade/locator_reissue_v2_run2.json                 new artifact (run 2)
         src/engine/extraction/span_collision.py                union grouping + acceptance gate
         src/engine/tests/test_span_collision.py                +7 tests (7 -> 14)
         docs/designs/SYSTEM-INVENTORY.md                       regenerated (pre-push gate)
TESTS  : 50 pass across the four helper suites (was 43). 82 pass on locator+conveyor regression.
CI     : no GitHub status checks or workflow runs at this SHA. LOCAL evidence only.
```

---

## 1. THE AR-1228 CORRECTIONS — BOTH APPLIED

### 1.1 §9.5 — I had auto-refused on HIGH, and you forbade it

Your ruling landed **after** my first push. My gate marked cross-role members
`REFUSED_PENDING_ADJUDICATION` — a decision the module is not allowed to make (§2: *"HIGH is a
review signal, not a semantic conviction … it does not decide"*).

Corrected to `HELD_FOR_ADJUDICATION`. **The strongest act available to the module is now refusing
to AUTO-ACCEPT.** A held condition is not rejected, not condemned and not scored; it leaves the
auto-accept path and goes to an adjudicator. The negative control now asserts exactly that, and
no more.

I caught this only because I re-fetched before publishing and read the newest ruling first. Had I
pushed the report on my first fetch, I would have shipped a report describing behaviour your
ruling had already prohibited.

### 1.2 §2 — the chain-overlap gap was REAL

RED, against the shipped representative grouping:

```
A entry_sequence[0].action  1000-1200     A~B 0.900
B entry_sequence[1].action  1020-1220     B~C 0.875
C stop.rationale            1045-1245     A~C 0.775   <- below threshold

representative grouping -> group {A, B};  C becomes a silent singleton and is DROPPED
                        -> the `stop` role never reaches the severity decision
                        -> a CROSS-ROLE HIGH degrades to a same-role REVIEW
FAILED test_a_transitive_overlap_chain_cannot_walk_out_of_the_check
  Extra items in the right set: 'stop.rationale'
```

So it was worse than a split group: **a reuse chain could walk out of the check one step at a
time.** Replaced with connected-component (union-find) grouping. A companion discriminator
asserts A~C really is below threshold, so the RED is not vacuous.

---

## 2. THE RE-RUN — WHAT THREE PASSES ACTUALLY PRODUCED

Identical pins every time: transcript `df72444f…` 25,071 chars, extraction `c37ff26f…`.
**The locate path is byte-identical across runs** — `git diff --stat` over `anchor_locator.py`,
`pilot_conveyor.py` and `h1_pilot_phase1.py` from the first push to now is empty. The variance is
gemma, not my code. That empty diff is the control for claim 3.

| | committed `phase1.json` | run 1 | run 2 |
|---|---|---|---|
| located / unlocated | 7 / 5 | 7 / 5 | **10 / 2** |
| on the disclaimer region | 6 | 5 (incl. the accepted one) | **10** |
| cross-role HIGH groups | 1 | 2 | 1 (all ten) |
| auto-accepted | — | 1 | **0** |

- **Run 1** reproduced the cluster (4 refs on 19546–19757) **and created a second cross-role
  cluster the committed artifact does not have**: `entry_sequence[3].action` + `targets[0].rationale`
  both took 18462–18580, a span held in `phase1.json` by one condition, uncollided.
- **Run 2** put **all ten located conditions on the disclaimer**, across four roles.
- **Committed vs run 1: identical counts, different membership.** 4 of 7 refs shared; of those,
  2 kept the same span and 2 moved. A count-shaped comparison would have called this stable —
  the same shape as the `ZERO REGRESSIONS` defect your §5 names.

**Only 2 of 12 conditions bind to the same span across the committed run and run 1.** I am not
quoting a stability rate from three runs; the qualitative point is sufficient and is all I claim.

### 2.1 I audited my own new grouping before believing run 2

Ten conditions in one group is exactly what a bad union-find would produce, so I checked rather
than reported it. The three distinct spans are 19546–19757, 19574–19757 and 19546–19997 — all the
same disclaimer sentence. **Minimum pairwise overlap 1.000**, so every member joined directly; no
transitive chaining, no over-merge. Negative control: an unrelated span scores 0.0 and does not
join.

### 2.2 The one run-1 acceptance was also in the disclaimer block

`confluences[0].description` — *"The trade must be initiated during the 9:30 AM ET New York
session"* — anchored at **19845–19997**, inside the 19546–19997 disclaimer block you already ruled
invalid. Containment measured, with a positive control (a span known outside reports outside).

It was accepted for one reason: **no sibling shared its span.** The gate detects REUSE and is
structurally blind to a wrong-but-UNIQUE span. Pinned as an explicit limitation test so that
`ACCEPTED` is never read as `VERIFIED`, and so that a future silent growth of relevance judgment
inside this module fails loudly instead of shipping. **I did not add a relevance check to patch
it** — §3/§4 keep that advisory and unowned.

---

## 3. THE DRIVER — §6.1 / §6.2 / §6.6

- **§6.1 enforced, not intended.** `--out` aimed at `phase1.json`, `phase1_preps.pkl` or either
  certificate aborts before a single gemma call:
  ```
  [reissue] ABORT: phase1.json is frozen AR-1199/Phase-1 history — AR-1226 §6.1 forbids mutating it.
  EXIT=1
  ```
  `git diff --stat` on all three frozen artifacts after every run: **empty.**
- **§6.2 fence untouched.** Production seams reused *by import*
  (`extract_spine_condition_texts`, `locate_condition_anchors`, `robust_propose`);
  `f2_coverage_gate` still owns literal presence. I added a check after location and removed
  nothing.
- **§6.6 provenance.** Each quote carries `char_span`, the literal slice, `quote_sha256` and the
  full pin set, and the driver asserts `transcript[start:end] == result.quote` per condition, so
  a drifted locator cannot ship a quote that is not the slice it claims to be.
- **NOT WIRED** into Phase 1 or the certificate route. §7 unchanged.
- Both runs are preserved as separate artifacts; neither overwrote the other.

---

## 4. CONTROLS

| control | result |
|---|---|
| §6.5 negative — real cross-role cluster leaves the auto-accept path | every member HELD, roles `{entry_sequence, stop, targets}` |
| §6.4 positive — same-role reuse | `ACCEPTED_PENDING_REVIEW`, never held |
| clean-set discriminator | fully `ACCEPTED`, zero collisions |
| unlocated conditions | acquire no verdict at all |
| §2 chain RED | fails against representative grouping, passes under union |
| chain discriminator | A~C < 0.80 confirmed, so the chain RED is not vacuous |
| over-merge audit (run 2) | min pairwise 1.000 — direct, not chained |
| frozen-output refusal | aborts, empty diff witness |
| mutation: gate exists but never holds | bites exactly the negative control; positive control and clean-set stay green |

---

## 5. FINDINGS AGAINST MYSELF

1. **I shipped code your ruling then prohibited, and only the re-fetch caught it.** Not a defence:
   the ruling was on the branch before I published, and reading it first is the rule.
2. **My first RED was an `ImportError`** and I nearly reported it as the red-proof. An import error
   is a claim about a symbol, not about a guard. Replaced with a mutation that bites.
3. **AR-1227 parked this item asking for permission AR-1226 §6 had already granted** — the AR-959
   shape.
4. **I overwrote run 1's artifact with run 2 before realising run 1 was the evidence for the
   instability claim.** Recovered from the 586b091b commit; both are now separate files. It was
   recoverable only because the code was pushed first.

---

## 6. WHAT THIS DOES TO §6's SEQUENCE — YOUR CALL

Your L1 → L2 → Lane-G chain assumes L1 can produce a trustworthy binding set. **Claim 1 says it
cannot in its current form.** §9.1's "re-run/reissue the six proven bad bindings" has now been
executed twice; a third pass buys a third anchor set, not an answer.

Three readings. **I am not choosing between them and I have not tested between them** (claim 9,
UNRESOLVED):

- **(a) the locator PROMPT.** It asks for "the literal span that GROUNDS the condition" with no
  preference for topical specificity and no instruction to decline over guessing; the disclaimer
  is the longest fluent generic passage in the transcript. Changing it is an instrument change —
  yours, not mine.
- **(b) the SINGLE-PASS architecture.** One call per condition, blind to its siblings and blind
  to what it has already used. The collision gate can only object afterwards.
- **(c) RELEVANCE is genuinely the missing check**, which would invert §6's ordering — and §4
  blocks L2 until the terminology layer has an owner.

Under (b) or (c), §9.5's "manually/adjudicatively inspect any HIGH collision" is a per-run cost
that recurs on every re-run, because the next run produces a different set to adjudicate.

---

## 7. NOT DONE, NOT CLAIMED

- **L2** — no morphology normalization, no alias layer. §4 forbids a private synonym map and the
  terminology layer still has **no named owner**. This is the second report raising it.
- **The §6 report-claim lint lane** — authorized in parallel by AR-1228 §6, not started. This
  report is hand-built to the §4 contract; the lint is not written.
- **Lane G wiring, the certificate route, relevance hardening** — untouched.
- **§9's locks** — no certification, no compiler authorization, no paper, no live. Unchanged.
- **§8 session hygiene** — noting that this report comes from a fresh worker context seated today;
  none of the six over-claims you counted were made in it.

---

```
STOP   : L1 items 1/2/6 executed twice and reported; AR-1228 §2 and §9.5 corrections landed.
         Not running the locator a third time — it yields a third anchor set, not an answer.
         Not starting L2 (alias layer unowned). Not wiring anything into Phase 1.
NEXT   : yours, in the order I would take them:
         (1) §6's premise needs re-ruling given claim 1 — choose (a), (b) or (c) in §6 above.
             If (a), the locator prompt is an instrument change and needs your word.
         (2) name an owner for the terminology alias layer (§4) — still blocking L2.
         (3) the §6 report-claim lint lane, if you want it before the next large unit.
         (4) Lane G wiring, stop geometry, the 40-ID surface, the AR-number collisions.
```
