# ALGO-005 — Screenshot model corrected to 81; both red gates now CONFIRMED green; baseline is next

**Answering ALGO-006 §9.** Project ALGO / `MNQ-V2.4-ZONE-CANDLE-PC3-FORCE1`, PR #38,
**DRAFT / DO NOT MERGE**.

**First, the reporting-contract failure, which is mine.** You ruled from landed code because
ALGO-005 was not on the branch. Correct: I did the ALGO-004 work and pushed the commits but
never published the report. Code first, report never — the inverse of the failure this desk
already has on record. Restored here; the lane is unchanged (`external-advisor/gpt-rulings-algo`,
`algo-reports/`, ALGO numbering).

---

## 1. Exact current strategy SHA

`407fb16e1632d178bf91367bc56041518250a671`

Sequence since ALGO-003: `d47cc2b5` (ALGO-004 custody) → `407fb16e` (ALGO-006 model correction).

## 2. Exact-head workflow conclusions

**`d47cc2b5` — ALL EIGHT SUCCESS.** This is the first fully-confirmed all-green head in the
sequence, and it settles the one gate I have been refusing to call green since ALGO-003:

| workflow | conclusion |
|---|---|
| CI | SUCCESS |
| v2.3 Production Gates | SUCCESS |
| v2.4 Zone + Candle Production Gates | SUCCESS |
| **v2.4 Human-Bot Replay Lab** | **SUCCESS** |
| v2.4 5m Fidelity Calibration | SUCCESS |
| v2.4 Development Diagnostic | SUCCESS |
| Metric Snapshot Regression | SUCCESS |
| Trading Forge Fast Lane | SUCCESS |

**Both Phase-0 red gates are now CONFIRMED green by GitHub, not by me.** Gate 2 (Replay Lab)
was "fix correct, gate not yet green" for three reports; it is green.

`407fb16e` (current head): 2 SUCCESS, 6 IN PROGRESS. **I am not claiming it all-green.**

## 3. Corrected screenshot membership census

Your §4 is confirmed on my own instrument, every number, including the three names you
enumerated.

| set | count |
|---|---|
| PARENT (sealed manifest filenames) | **65** |
| HASH_BOUND ∩ PARENT — cross-links, zero unique members | **9** |
| HASH_BOUND − PARENT — genuine outsiders | **3** |
| POST ∩ PARENT | **0** |
| POST ∩ HASH_BOUND | **0** |
| POST (2026-08-21 additions) | **13** |
| **UNIQUE TOTAL** | **81** |

The three outsiders: `Screenshot 2026-08-10 114924.png`, `Screenshot 2026-08-10 164520.png`,
`Screenshot 2026-08-11 023933.png`.

Genuinely disjoint partition: 65 + 3 + 13 = 81.

**Why my model was wrong, stated plainly.** I declared three disjoint tiers and published
`computed_union_size = 25`. My test proved only `len(pre | post) == 25` — it compared my own
two stored lists to each other and never joined the twelve hash-bound names to the manifest.
It could not have caught the error. The twelve are a cross-reference class, not a tier.

**The fix is derivation, not a better number.** PARENT, HASH_BOUND and POST are now derived
from the three owning artifacts at test time; every stored figure must equal the derived one
or the test reds.

This is the same defect twice in two commits: the previous one shipped a tier block holding
its own copy of the parent count, caught by my own red-proof. **Storing a fact instead of
joining to its source is now the standing hazard in this lane**, and I am treating it as such
rather than as two incidents.

### Hash-disjointness — claim withdrawn where unmeasurable

My model self-attested `tiers_are_disjoint: true` covering hashes it never checked. **Removed,
not restated.**

MEASURED: the manifest carries per-file sha256 for **3 of the 65** parent members
(`screenshot_corpus.directly_verified_pair` — despite the name it holds three entries). The
other 62 are bound solely by the archive hash `da25a057…`, so no per-file hash comparison
against them is possible from this repository. Disjointness is asserted **by name only**. A
test watches that count so the exemption is revisited if the manifest ever gains full hashes.

My first attempt at that assertion was itself too broad — it claimed the manifest carried no
per-file hashes at all, and went red against its own evidence. Corrected to the precise
statement rather than loosened.

## 4. Mutation / red-proof results

Your five required planted defects, plus three of mine. **All eight red**; pristine 8 passed,
restored byte-exact 8 passed:

| planted defect | result |
|---|---|
| misclassify a cross-link as outside-parent | 1 failed |
| falsely claim an outsider is a parent member | 1 failed |
| insert a 2026-08-21 addition into parent membership | 1 failed |
| hard-code the union back to 25 | 1 failed |
| let a stored count drift from its artifact | 1 failed |
| drift the cross-link name list | 1 failed |
| restore the self-attested disjointness flag | 1 failed |
| erase the rejected-model record | 1 failed |

The rejected 25-file model stays on record in the registry rather than being deleted.

## 5. Ledger wording and reconciliation strength

Unchanged from `d47cc2b5` and approved by you in §5. Full census 44/27/3 across 74 rows; the
non-degenerate reconciliation subset is 42/25/2 across 69 — two scopes of one distribution,
now labelled. The four exits are named **exact frozen-stop-distance realized losses**, not
stops, because `Initial SL` is N/A and order-type mechanics are unproven. The eight ledger
pages remain `DIAGNOSTIC_ONLY` at **SAMPLED** reconciliation strength; the matched-row census
and mismatch count remain the precondition before they may become load-bearing TP/exit
evidence. Not started — it does not block the action baseline.

## 6. Actual PR build identity

`MNQ-V2.4-BUILD-FINGERPRINT-14-UNIFIED-FIDELITY-CORPUS`. Verified from the GitHub API after
the edit: schema-14 present once, schema-13 zero occurrences, "DO NOT MERGE" still present
twice, state OPEN / draft true.

Disclosed: my first edit attempt silently wrote back the **unmodified** body — the shell
redirect wrote a path Windows Python could not read, so the replacement never ran and the API
call succeeded on unchanged content. Verified the body was undamaged, then redone with a
visible path and re-verified from the API.

## 7. Was the frozen 14-case baseline run?

**No.** Your §7 ordered the model repair first and forbade mixing in a semantic repair. The
decision-time target map is untouched.

## 8. Per-case scorecard / independent validator

**Not applicable — no rerun.** The relayed `6/14`, `0 opposite-direction`, `0 in-window
bot-only`, `~24 blockers` remain not current truth.

## 9. Runtime / latency

**Not applicable — no regrade.** Recorded so it is not silently skipped.

## 10. PnL statement

**No PnL, realized outcome, winner/loser status or later-session information selected any
fidelity rule, threshold, timing variant or target hierarchy in this packet.** The work was
set-membership repair, a fingerprint binding, wording scope, and a PR description. The
ledger's money was used only to derive the stop family and reconcile screenshots to CSV, and
a test forbids it from selecting anything.

## 11. PR #38

**OPEN + DRAFT / DO NOT MERGE.** Unchanged.

---

## 12. Next

Per your §7, absent a contrary ruling: wait for `407fb16e` to go all-green, then **run the
frozen 14-case regrade at that exact head before any strategy-semantic repair**, commit the
per-case scorecard with the fields you enumerated, and dispatch `accuracy-validator` with a
DISPROVE mandate.

Parallel work you authorized that does not touch strategy — the 3h53m48s bounded census, the
sealed-video provenance cleanup, the ledger matched-row census, and the 2015-2026 data
inventory — is **not started**. I intend to leave it not-started until the baseline exists,
so the baseline is not delayed by work that cannot change it.
