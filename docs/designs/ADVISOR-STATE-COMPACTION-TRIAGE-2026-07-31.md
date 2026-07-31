# ADVISOR-STATE compaction — TRIAGE ORDER (not a cut authorization)

**Produced 2026-07-31 ~08:10 by the advisor seat, while `R-511` was held for the
fifth external read.** Discharges the *classification* half of the compaction debt
recorded in `ADVISOR-STATE.md`'s `⚠️ COMPACTION DEBT` block. **It deletes nothing.**

---

## ⚠️★★★★★ READ THIS BEFORE USING THE TABLE — THE INSTRUMENT IS WEAK AND I AM NAMING HOW

The classification below was produced by extracting up to four backticked
identifiers from each block and counting their occurrences in `ADVISOR-RULINGS.md`.

**A TOKEN APPEARING IN THE LEDGER PROVES THE TOKEN APPEARS. IT DOES NOT PROVE THE
BLOCK'S FINDING IS CARRIED.** `bindable=128`, `reason=374`, `evidence=419`,
`MANDATORY=79` are high-frequency generic words that inflate a block toward
"carried" while saying nothing about whether *this* measurement was ever ruled.
★★★ **That is this desk's 6×-convicted `I MEASURED THE NEIGHBOURING OBJECT` shape,
and it would apply here if `LIKELY-CARRIED` were read as `SAFE TO CUT`. IT IS NOT.**

**THE ONLY HIGH-SIGNAL EVIDENCE IS A LOW-FREQUENCY DISTINCTIVE TOKEN — A SHA, A
FILE PATH, AN AR NUMBER — SCORING `0`.** Those are listed separately per block and
they are the real output of this pass.

**SO THE STANDING RULE FOR WHOEVER EXECUTES THIS: every block still needs a
FINDING-LEVEL check against the ledger before it is cut. This table only says
WHICH ORDER TO DO THEM IN and WHERE THE RISK IS CONCENTRATED.**

---

## SIZE OF THE DEBT `[MEASURED HERE]`

| quantity | value |
|---|---|
| `ADVISOR-STATE.md` total lines | **`3133`** |
| blocks marked `NOT RULED` | **`19`** |
| lines held by those blocks | **`625`** (**`20%`** of the file) |
| target per `advisor-onboarding` §5 | `~40–120` lines |

★★ **Note what this does NOT say: the other `80%` is not thereby cuttable. It is
seat narrative, superseded `AUTHORIZED NOW` blocks and standing contracts mixed
together, and `CUT NARRATIVE, NEVER CONTRACTS` still governs it.**

---

## TIER 1 — HIGHEST RISK OF BEING A SOLE CARRIER (do these first, PROMOTE before cutting)

These blocks contain a distinctive identifier that appears **`0`** times in the
ledger, so the specific fact around it may exist nowhere else.

| line | block | zero-hit tokens |
|---|---|---|
| `697` | AR-513 landed `14:15:51` — three of its outcomes | `3dfd8420` · `55f5561d` · **`AR-512`** |
| `674` | `F` happened at 14:10 while the desk was cold | `bqjjrt771` · `.audit-ledger-e-r496-39948d3c/` |
| `2113` | the classifier is reproducible / `classify.py` | `VOCABULARY-LEDGER-POP120-2026-07-29.md` · sha `90aedc77…` |
| `2010` | the transcript archive IS the extraction-time text | `e1cd57b7` |
| `1964` | AR-486's three findings / "enforced in CI" REFUTED | `src/server/services/spec-onboarding-service.ts` |
| `2154` | `pop120_census.py` is UNRECOVERABLE | `wt-h1-wave4-20260712/docs` |
| `830` | BLUEPRINT `67d650a8` audited and clean | `bde1d9ad` |

⚠️★★★★★ **`AR-512` SCORING `0` IN THE RULINGS LEDGER IS THE SINGLE MOST INTERESTING
ROW HERE AND IT IS NOT A COMPACTION FINDING AT ALL — it is a candidate
**NEVER-RULED AGENT REPORT**. `[HYPOTHESIS — the token count is real, the
conclusion is not measured]`: a `0` could equally mean the ledger disposed of it
without naming the number. **VERIFY BEFORE REPEATING IT**: read `AR-512` in
`AGENT-REPORTS.md` and search the ledger for its SUBSTANCE, not its label.
`AN ABSENCE FROM A LIST IS NOT A PASS.`**

## TIER 2 — every sampled token appears in the ledger (still verify at finding level)

Lines `269` · `320` · `635` · `803` · `1017` · `1040` · `1105` · `1180` · `2089` ·
`2192` · `2250` · `2345`.

★★ **Several of these are almost certainly genuinely carried — e.g. `2345`
(`0b0d6617`, `25` ledger hits) and `269` (the `7`-of-`33` divergent bodies, which
R-509/R-510 discuss directly). They are the cheapest wins. `2192` and `2250` are
also large (`58` and `33` lines) and token-rich, so they pay well per check.**

---

## THE PROCEDURE, UNCHANGED FROM THE BLOCK THAT ORDERED IT

1. Read the block.
2. Grep `ADVISOR-RULINGS.md` for its **finding**, not its tokens.
3. If the ledger carries the finding → **cut the block**.
4. If it does not → **PROMOTE it into a contract section of `ADVISOR-STATE.md`
   first, THEN cut the narrative around it.**
5. `AN UNRULED MEASUREMENT IS A CONTRACT, NOT NARRATIVE.`

⚠️ **And re-measure the file's self-described line count in the SAME commit as any
cut, with an assert that can actually FAIL the command — that number has been
wrong in this file more than once, and once because the assert was chained after
an `echo` and could not stop the commit.**
