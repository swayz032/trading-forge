# External GPT correction — `R-537 §4` / `AR-582`

**Reviewed objects:** design commit `ef1c85d61d672b5f96075096b7694c1b48f4d333`, design blob `ed9a2ce45bdd99475627623c2502408f5f42ee69`; `R-537`; `AR-582` start receipt.

**RULING ID / TASK ID / DECISION:** external premise correction for `R-537 §4` and `AR-582` · **REVISE THE REFUTATION.** The design correctly separates symbol **keys** (row 44) from symbol **values** (row 45). The external review never disputed that separation and did not order either row changed. It identified a contradictory citation in the prose at line 210. That citation is present verbatim in the committed blob. `R-537 §4` says it is not present; that measurement is false. The worker’s “do not fix” instruction would preserve a real documentation defect.

## CLAIMS VERIFIED (and how)

**[MEASURED HERE, direct `git show` of the committed blob—not the working file and not a loose search surrogate]** line 210 is:

> `SYMBOL KEYS specifically are now IN scope and CAUGHT (row 45), because a symbol key is a DIRECT SYNTACTIC channel ... (row 44).`

The same direct blob read shows:

- row 44 = `SYMBOL-KEYED FUNCTION CAPABILITY`;
- row 45 = `NON-CONFORMING VALUE CLASS`, including a symbol **value**.

Therefore both statements are true:

1. the rows themselves distinguish key from value correctly; and
2. line 210 miscites the symbol-key catcher as row 45 before correctly citing row 44 in the same sentence.

The required correction is only to change the first citation in line 210 from `45` to `44` (or remove the duplicate row citation). It must not merge, renumber, or otherwise alter rows 44 and 45.

## EVIDENCE INDEPENDENTLY CHECKED

- `git show ef1c85d6:docs/designs/P0-VNEXT-DESIGN-2026-08-01.md` found exactly one `SYMBOL KEYS specifically...` sentence at committed line 210.
- The exact same blob query printed rows 44 and 45 and confirmed their distinct key/value meanings.
- `AR-582 §3` correctly measures the row definitions but does not inspect the contradictory prose sentence that the external finding cited. It therefore answers a different claim.

## TESTS RERUN (command/result)

```text
Committed-blob search for “SYMBOL KEYS specifically...” → 1 hit, line 210
Line 210 row references                              → 45 and 44
Row 44 label                                         → SYMBOL-KEYED FUNCTION CAPABILITY
Row 45 label                                         → NON-CONFORMING VALUE CLASS / SYMBOL VALUE
```

## ARCHITECTURE INVARIANTS TOUCHED

- A citation must join a claim to the row that tests that claim.
- Verifying the target rows does not verify every sentence that cites them.
- A refutation must answer the finding actually made, not a stronger claim the finding did not make.

## FAILED OR UNPROVEN CONDITIONS

- `R-537 §4` states that line 210 does not contain the row-45 symbol-key citation. The committed blob contradicts it.
- `AR-582` currently plans to preserve that line under an instruction based on the false refutation.
- This correction does not change the other sustained findings or expand implementation scope.

## REQUIRED CORRECTIONS

1. Strike `R-537 §4`’s factual claim that the citation was not reproduced; record the direct committed-blob evidence.
2. Amend `R-537 §5.1` / the worker instruction narrowly: preserve the row-44/key and row-45/value distinction, but correct line 210’s symbol-**key** citation to row 44 only.
3. Continue the already-authorized five-item design pass unchanged otherwise.

## FILES / SCOPE ALLOWED

The existing design-only scope remains sufficient: `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md`, the normal worker report, and the advisor’s own ruling/state correction. No implementation, blueprint, pinned-lane, ledger/oracle/census, engine, grade, merge, deployment, Surface B, P3, or Gate-B work.

## ACCEPTANCE COMMANDS

1. Query the committed or candidate design blob directly for the full `SYMBOL KEYS specifically...` sentence.
2. Assert that the sentence cites row 44 for symbol **keys** and never row 45.
3. Assert row 44 remains symbol-key capability and row 45 remains symbol-value/non-conforming class.
4. Re-run the broader carrier/atom-manifest checks already authorized by R-537.

## STOP CONDITION

Stop if “do not change the rows” is used to justify preserving the wrong prose citation. Stop if a loose search result is used to overrule a direct committed-blob line read.

## LESSON TO PERSIST

> **Correct endpoints do not repair a wrong citation between them. Verify the sentence that makes the join.**

**Authorized next action:** the current worker seat continues R-537’s five design items and also corrects this one citation—no row renumbering or semantic change. First observable and ETA remain the structured atom manifest within the already declared 20–30 minute window.
