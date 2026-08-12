# AR-1070 — WORKER — **STEP 2A CLOSED (AR-1068 §10 NEXT UNIT 1).** `displacement_candle_low → fvg_displacement` mapped, canonical sVkm source-risk artifact minted on Tier-A spans, golden transcript committed into the branch. 🛑 **ONE DECLARED NARROWING OF §4 THAT I WANT RULED ON BEFORE UNIT 2 STACKS ON IT.**

```
RULING   : AR-1068 (gpt-rulings 06d63e2b) §4 and §10 NEXT UNIT 1
TREE     : C:\Users\tonio\Projects\wt-h1-wave4-20260712     [MEASURED HERE]
BRANCH   : h1-wave4-sealed12-driver
PIN IN   : 64420de6   (the head AR-1068 independently observed)
PIN OUT  : b9640129   [MEASURED] pushed and re-read from origin via git ls-remote
COMMITS  : 809d2192 STEP 2A · b9640129 SYSTEM-INVENTORY regenerate
SCOPE    : STEP 2A only. STEP 2B / 5+4 / 6 UNSTARTED. No source-faithful backtest claimed.
```

---

## 1. WHAT THE DEFECT ACTUALLY WAS

AR-1068 §4 called Unit A "stale". `[MEASURED HERE at 64420de6]` it was worse than stale — it was
**inverted**. `ANCHOR_TO_RESOLVER` refused the one anchor the sVkm teacher taught and accepted the
one AR-1063 proved wrong:

| anchor | before STEP 2A | meaning |
|---|---|---|
| `displacement_candle_low` | **THROWS** "no implemented structural resolver anchor" | the taught stop |
| `fvg_low` | resolves to `"fvg"` | the **gap boundary** — the wrong price (AR-1063) |

The exclusion comment justified itself with *"the Python resolver implements no candidate for
them"*. That sentence was true when written and became **FALSE at `64420de6`**, when STEP 1 landed
`"fvg_displacement": (fvg_displacement_low, fvg_displacement_high)` at `structural_stops.py:267`.
★ **A justification comment is a claim with a timestamp, and nothing re-reads it.**

## 2. THE REPAIR — 4 FILES, 315 INSERTIONS

1. **`src/server/services/source-risk-contract.ts`** — `displacement_candle_low: "fvg_displacement"`.
   **`fvg_low` / `fvg_high` UNTOUCHED**, still `"fvg"`, per §4 *"Do not globally remap"*. The sVkm
   repair graduates to its own anchor rather than redefining a shared one.
2. **`src/engine/extraction/fixtures/svkm_source_risk_canonical.json`** — the canonical artifact:
   `mode=SOURCE_FAITHFUL`, `stop{anchor=displacement_candle_low, include_wick=true, span{13912,14135}}`,
   `target{FIXED_R, r_multiple=2, span{14448,14515}}`.
3. **`src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt`** — the golden
   transcript, **committed into the branch**.
4. **`src/server/services/__tests__/svkm-source-risk-canonical.test.ts`** — 17 tests.

### 2.1 Why I committed a 25 KB transcript, unasked

`[MEASURED]` the transcript existed **only in the primary tree** at
`backups/h1-shadow-eval/transcripts-78fe8ea7/transcripts/sVkmZklJDHI.transcript.txt`. It was **not
in this worktree and not tracked on this branch** — `ls` returned `No such file or directory`.

§4 orders *"Preserve the exact transcript quote/span that justifies that canonicalization."*
★ **A span pointing at a file the branch does not carry is not preserved evidence — it is a
citation to something the reader cannot open.** §11's discriminator 18 requires the exact quote to
survive to the execution receipt; it cannot survive from a file that is not in the repo.

Copied byte-identical and re-verified **in the destination**, not the source:
`25071 B`, `sha256 df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc` — the exact
artifact AR-1065 named. No CRLF mangling.

## 3. THE SPAN CHOICE — AND THE WRINKLE I AM NOT HIDING

`SourceStopContract` carries **ONE** span, and that span must justify all three fields it stamps.
I pinned **`{13912, 14135}`**, which re-slices verbatim to:

> *"we're just going to put it at the bottom of the fair value candle. Really simple. If this candle
> had a big wick, then you would also include the wick. Don't just go to the body. Please include
> the wick of the candle as well"*

anchor = **"the fair value candle"** · extreme = **"the bottom of"** · `include_wick` = **"include
the wick of the candle"**. All three, in one quote.

🛑 **THE WRINKLE:** this is the teacher's **rule statement**, and `[MEASURED]` he speaks it over the
**SHORT** worked example — he says *"click the short tool here"* at char `~13320`. The **LONG**
worked example, at `{18758, 18852}`, says:

> *"We would put our stop to the low of the fair value gap would be just there including the wick."*

— which **resolves direction for the long side but names the GAP, not the candle.** Neither quote
alone carries everything; the anchor-type authority and the direction authority live in different
sentences. I recorded the long example as a **corroborating span** in the artifact and test it too.

**I did not re-litigate this** — AR-1068 §2/§3.1 already ruled the long side `TEXT_SUFFICIENT` on
exactly AR-1063's reasoning (a gap boundary is a price level with no wick to include). I am
surfacing it because **the field the artifact stamps and the sentence it cites are not word-for-word
the same claim**, and a reader six weeks out should not have to rediscover that. If you want the
long-example span as primary instead, it is a two-value change.

## 4. 🛑 THE DECLARED NARROWING — RULE ON THIS BEFORE UNIT 2

§4 says: `displacement_candle_low/high -> required_anchor="fvg_displacement"`.
**I mapped `low` ONLY. `displacement_candle_high` is still absent from the map.**

**Why.** §4's own preceding line conditions it — *"SHORT source stop -> `displacement_candle_high`
**ONLY if** source authority resolves the short side"* — and §12 orders short kept **FAIL-CLOSED**.
Leaving the key unmapped makes that refusal **structural at two layers** (no source authority AND
no resolver mapping) rather than one. Opening it later is a **one-line** change.

**This is a narrowing of a literal instruction and I am not taking it silently** (`0-CTRL.6`). It is
stated in the code comment, in the artifact, in the commit message, and here. **If you want both
keys mapped now, say so and it is one line.**

## 5. PROOF

**RED → GREEN by ablation of the single map line** (I removed exactly that line, ran the
**unchanged** suite, restored, re-ran):

| state | result |
|---|---|
| **ablated** | **4 RED / 13 GREEN** — `anchor=displacement_candle_low has no implemented structural resolver anchor` |
| **repaired** | **17 GREEN** |

★ **The 13 that stayed GREEN under ablation are the point, not a shortfall** — they are the
evidence-join and narrowing controls, and they are *supposed* to be independent of the mapping. A
suite where everything goes red on one ablation is not discriminating.

**The 17, and what each one bites:**
- **positive witness first** — transcript non-empty, `25071 B`, sha256 matches. *Without it, every
  slice assertion below is vacuous on an empty read.*
- stop span and target span **re-slice to the pinned quotes verbatim** — span↔text join key.
- **the pinned stop quote occurs EXACTLY ONCE** — a join key that matched twice would join to anything.
- **negative control on the span mechanism**: `start+1` and `end-1` **must not** match. *Without
  this, the slice test passes even if `slice` returned the whole file.*
- the quote contains `fair value candle` · `include the wick` · `bottom of` — the three stamped facts.
- corroborating long-example span contains `including the wick` and `low of the fair value gap`.
- **`required_anchor === "fvg_displacement"`** (the RED→GREEN).
- artifact anchor **is not** `fvg_low` and **does not** resolve to `"fvg"` — the AR-1063 defect guarded.
- `fvg_low`/`fvg_high` still `"fvg"`, **and** a spec teaching `fvg_low` still resolves to the gap anchor.
- `displacement_candle_high` **throws** — short fail-closed.
- **the short refusal is the MISSING MAPPING, not a blanket ban on high-side anchors** — proven by
  `fvg_high` still resolving. *A refusal nobody can characterise is not a guard.*
- `atr_multiple` still unmapped.
- the new anchor **does not bypass** the `span={0,0}` LLM-rationale refusal.
- legacy specs with no `source_risk` still get `{type:"atr", multiplier:1.5}` byte-identical.

**Regressions, `[MEASURED HERE]`:**
- `npx tsc --noEmit` → **exit 0** (via `PIPESTATUS[0]`, not a piped exit code).
- Python `test_fvg_displacement_anchor` + `test_source_faithful_stop` + `test_source_fixed_r_target`
  + `test_producer_staging_vocabulary` → **53 passed**.
- `source-risk-contract.test.ts` (the existing UNIT A suite) → **10 passed**, unchanged.
- Full `src/server/services/__tests__/` → **12 failed / 33 files**, and I baselined it: I reverted
  the contract to `HEAD` content, re-ran, got **the same 12**, and **diffed the failing-test NAME
  SETS — IDENTICAL**. Membership, not cardinality. **Those 12 are pre-existing lifecycle/promotion
  failures, not mine.** I have not investigated them; they are outside this scope.

## 6. THINGS THAT WENT WRONG, STATED (`0-CTRL.4`)

1. **My first commit message was mangled.** I used a PowerShell here-string (`@'…'@`) inside a
   **Bash** heredoc call, so the subject landed as `@ SOURCE-RISK-HANDOFF-1 STEP 2A…` with a
   trailing `@`. Caught it, amended my own commit (`d53522ea` → `809d2192`). Nothing else changed.
2. **The push was REFUSED** by the `inventory-freshness` pre-push hook: `SYSTEM-INVENTORY.md` was
   stale. The hook regenerated on disk, then **rolled its own fix back** because unstaged files in
   this shared tree conflicted with its stash. I regenerated manually and committed per the hook's
   published remedy (`b9640129`) — **19/19 positive controls pass**, WIRED `3262` /
   BUILT-UNREACHABLE `1545`. **I did not route around the guard.**
3. ⚠️ **Pre-existing dirt in the shared tree, NOT mine:** `docs/wave25-exit-engine-ab-report.md`
   modified and ~20 untracked `docs/designs/GRADE-*` / `HANDOFF-*` files, all present at seating.
   They are what makes the pre-commit stash dance noisy. I touched none of them.

## 7. WHAT IS **NOT** CLOSED

- **STEP 2B / NEXT UNIT 2 — UNSTARTED.** The exact causal FVG identity. AR-1069 stands: the
  identity does not exist to transport; `_eval_fvg` discards `FVGResult.zones` and returns
  `any_active`, which admits any old still-unfilled zone on either side.
- **NEXT UNIT 3 (STEP 5+4) and NEXT UNIT 4 (STEP 6) — UNSTARTED.**
- **This artifact carries RISK ONLY.** No entry causality. **It is long-only and it is not the
  complete educator strategy** (§12).
- **`persisted`** in §10's chain `…-> persisted source_risk` is satisfied here as a **committed
  canonical artifact**, NOT as a DB row. The DB hop is STEP 6. Say so if you meant the DB now.
- **No grade dispatched.** AR-1068 does not require one for this unit; §10 puts the load-bearing
  certification at STEP 6. Order one and I dispatch it (`0-CTRL.2`).

## 8. WHAT I AM DOING NEXT, WITHOUT WAITING

Proceeding to **NEXT UNIT 2 / STEP 2B** — capture the newly qualifying, same-side, post-breakout
zone from `FVGResult.zones` and carry that exact identity to the stop resolver, and remove EMA-slope
direction selection for this source. Reusing `compute_fvg_signal()`; **not building a second
detector** (§5).

**The one thing worth a ruling before that lands: §4 of this report.** If both anchor keys should be
mapped now, it is one line and I will change it on your word.
