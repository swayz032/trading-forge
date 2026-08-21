# CURRENT_STATE

**NAVIGATION POINTER — NOT AUTHORITY.** If this file disagrees with the newest ruling on
`external-advisor/gpt-rulings`, the repository wins. The authoritative ruling channel is
`origin/external-advisor/gpt-rulings` (AR-1382A section 8) — resolve the newest ruling by THAT
branch's commit time (`git log -1 --format="%H %ad %s" --date=iso origin/external-advisor/gpt-rulings`),
never by filename or AR-number sort. A newer commit on `gpt-engineering` or any other
`external-advisor/*` branch does NOT become a ruling by being newer. See
`.claude/skills/worker-onboarding/SKILL.md` section 1.

- **Path deviation, disclosed:** AR-1381A section 8B asked for this file at
  `docs/governance/CURRENT_STATE.md`. Worker-1's guard `edit_scope` (`.claude/worker1-hook-guard-manifest.json`)
  does not cover `docs/governance/`; it does cover `docs/replay-results/`. Placed here instead of
  requesting a guard widening for a navigation file, matching the AR-1380A precedent on the
  `AGENT-LOGS.md` friction (widen nothing merely for logging ceremony). GPT/operator may relocate it
  if a wider path is authorized.

## Architecture stage

3 — Strategy Factory.

## Latest controlling GPT ruling

**AR-1387A**, `origin/external-advisor/gpt-rulings @ d84b8391`
(`advisor-reports/AR-1387A-GPT-EXTERNAL-ADVISOR-RULING-AR1397-PARTIAL-PASS-C0-CORE-ACCEPTED-AUTHORITY-BINDING-DETERMINISM-CLOSURE-REQUIRED-2026-08-21.md`),
2026-08-21. Grades AR-1397 **PARTIAL PASS — the C0 core repairs are ACCEPTED, Stage C0 closure is
not**, and orders the bounded AR-1398 packet. **Stage C1, E8 trading, PAPER, Topstep and live work
all remain gated.**

### AR-1398 — DELIVERED, INDEPENDENT GRADE OWED (not yet dispatched)

- Report: `docs/replay-results/worker-advisor-reports/AR-1398-WORKER1-AR1387A-STAGE-C0-CLOSURE-COMPILE-AUTHORITY-BOUND-DETERMINISM-FINDING-AGAINST-RULING-2026-08-21.md`
- Delivery pin: `24a95641` (+ inventory `9b50bc6a`).
- Red/green proof: ONE probe (`scripts/ar1398_attack_replay.py`) run against BOTH heads —
  `860525ce` = **3 of 3** AR-1387A attacks COMPILED/GREEN; delivery head = **0 of 3**, each refused
  with a distinct named cause.
- Closed: §2 CRITICAL (required dependencies bound to an independent, immutable, versioned
  `CompileAuthority`; `build_certified_record` takes it as a REQUIRED parameter), §3 HIGH (complete
  versioned record schema + recomputed contract hash before any readiness axis is read), §5 MEDIUM
  (`GATING_AXES` is a `MappingProxyType` over a dict no caller can reach).
- Suites: 123 C0 + 31 sibling + 24 vertical = **178 passed**; ruff clean; certifier
  `GREEN_ALL_ITEMS_DONE`; receipt byte-identical at `fd79f602…`.
- 🛑 **ONE FINDING AGAINST THE RULING, needs a ruling not code:** AR-1387A §4's four-hash seed-matrix
  measurement **does not reproduce on this tower**. CPython 3.12 made `builtins.sum` compensated
  (Neumaier) and this tower runs 3.13.0, so the pre-repair head yields ONE hash across all four
  seeds. The located line and mechanism are correct; the "same machine, four receipts" claim is
  interpreter-specific. The repair was applied anyway and made stronger (`math.fsum` over
  `sorted(...)`, closing interpreter dependence as well as order dependence).
- 🛑 **CLAUSE 7.3.10 DELIBERATELY NOT EXECUTED:** the receipt hash never moved, so there is nothing
  to rebaseline, and adopting GPT's diagnostic `a890b406…` would move the pin away from what this
  repo produces. AR-1387A itself calls that value diagnostic, not a pre-authorized pin.

### Superseded — AR-1386A, `gpt-rulings @ 725887a0b0ba8bde9322f114f400f83c3404444e`
(`advisor-reports/AR-1386A-GPT-EXTERNAL-ADVISOR-RULING-AR1395-1396-PARTIAL-PASS-STAGE-C0-FAIL-CLOSED-CLOSURE-REQUIRED-2026-08-21.md`),
2026-08-21. Grades AR-1395/AR-1396 **PARTIAL PASS — Stage C0 IMPLEMENTED BUT NOT CLOSED**, and
orders the bounded AR-1397 closure packet. **Stage C1, E8 trading, PAPER, Topstep and live work all
remain gated.**

### AR-1397 — DELIVERED, independently graded **VERIFIED 7/10**

- Report: `docs/replay-results/worker-advisor-reports/AR-1397-WORKER1-AR1386A-STAGE-C0-FAIL-CLOSED-CLOSURE-THREE-GRADE-ROUNDS-VERIFIED-7-2026-08-21.md`
- Graded pin: `39d60f49d4e96b6000e6f645feffb4d60a34ac95`
- Band history across three independent adversarial rounds: **5 → 6 → 6 → 7**. The grader held at 6
  twice because a live route to `COMPILED` with an unsatisfied dependency still existed; it is now
  closed in every shape either party could construct.
- Closed: AR-1386A §3 (semantic status now gates), §4 (readiness cannot be deleted, assigned-false,
  or container-confused), §5 (blocker reasons cannot contradict their own axes), §6 (order-independent
  receipts, a zero-call guard that can actually fail, the five E8 birth tests).
- 🛑 **TWO RESIDUALS ARE OPEN AND NEED A RULING, NOT CODE** — see report §7 and §11:
  1. **Unkeyed receipt stamp.** Deleting the dependency declaration and re-stamping still compiles.
     Closing it means a keyed/HMAC stamp (the frozen-policy pattern already in the repo) — a new
     keyed-integrity surface, forbidden inside this packet by AR-1386A §7 and reserved-class under
     `ratify-packet`.
  2. **Cross-platform float drift, made WORSE by this packet.** The receipt carries 18 float values
     and the stamp is now MANDATORY, so a float-repr difference on Linux would refuse EVERY receipt
     rather than merely weaken a check. Latent today (the vertical does not run on Linux), but it
     must be settled BEFORE anything runs this vertical there. Fixing it moves `fd79f602…`, a hash
     pinned in four committed locations = re-baselining a frozen certified ref.

Prior controlling ruling: **AR-1385A**, `origin/external-advisor/gpt-rulings @ a1ae225bd96908eec64f025bf76d8fcdc2ca0460`
(`advisor-reports/AR-1385A-GPT-EXTERNAL-ADVISOR-RULING-AR1394-PASS-WITH-CORRECTIONS-STAGE-C0-COMPILER-CALIBRATION-AUTHORIZED-CURRENCY-PROS-LIVE-GATED-2026-08-21.md`),
2026-08-21. Grades AR-1394 **PASS WITH REQUIRED BOUNDED CORRECTIONS** and makes the architecture
decision.

⚡ **ROUTE (b) ADOPTED — E8 IS A COMPILER-CALIBRATION SOURCE, NOT A LIVE STRATEGY.** The old Stage C
splits in two:

| Stage | What | Status |
|---|---|---|
| **C0** | Generic compiler representation of an external decision dependency + fail-closed tests. **Needs no Currency Pros access.** | **AUTHORIZED — and DONE, AR-1395** |
| **C1** | Real Currency Pros UI preflight, provider adapter, live/historical parity | **STILL GATED** on explicit lawful access |

Prior controlling ruling: **AR-1384A**, `origin/external-advisor/gpt-rulings @ 861dd4e27f60ea73c614896bf6fda1669b8e7c88`
(`advisor-reports/AR-1384A-GPT-EXTERNAL-ADVISOR-RULING-AR1393-PARTIAL-PASS-E8-REFUSAL-SUSPENDED-EXTERNAL-INDICATOR-DEPENDENCY-PREFLIGHT-2026-08-21.md`),
2026-08-21. Grades AR-1393 **PARTIAL PASS** and **SUPERSEDES AR-1383A sections 4 and 8.**

🛑 **THE BIG CORRECTION — the operator caught it and GPT retracted its own framing.** The E8 chart is
intentionally on **15m** while the **Currency Pros indicator** computes and displays the configured
**4H** Premium/Discount state on that same chart. *"The private formula is not shown"* was mistaken
for *"the required state is absent."* AR-1382A framed a false binary — recover the private formula
**or** refuse the source — omitting the third branch: **consume the exact provider output under a
pinned dependency contract.**

- `VI-E8-3` is **split**: **`VI-E8-3A`** semantics = `MULTIMODAL_RESOLVED`; **`VI-E8-3B`** provider
  access + historical replay = `EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED` (**nonterminal**); native
  reimplementation = `SOURCE_INCOMPLETE_FOR_NATIVE_REIMPLEMENTATION` (retained, blocks a native
  rebuild only).
- The E8 refusal is **`SUSPENDED_PENDING_EXTERNAL_DEPENDENCY_PREFLIGHT`** — history, not authority.
- **The buy-target correction PASSES.** The action-frame rule (BEFORE → DURING → AFTER-DROP →
  LAST-STABLE) is accepted and remains mandatory.
- **New standing rule (AR-1384A §6.5):** before any future source-missing ruling, seven ownership
  questions must be answered and preserved, starting with **"who computes this value?"**. A terminal
  refusal cannot pass review with those fields omitted.
- **New standing rule (AR-1384A §6.4):** anything that changes direction, entry eligibility, exit,
  size, or a required checklist item may **not** be labelled only `context` / `tooling` /
  `non-executable`.

Full record: `docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/E8-EXTERNAL-DEPENDENCY-RECORD.md`.

Prior controlling ruling: **AR-1383A**, `origin/external-advisor/gpt-rulings @ 7d7fe29732e9b35dd68eb575fbdc109d363ff3bc`
(`advisor-reports/AR-1383A-GPT-EXTERNAL-ADVISOR-RULING-AR1392-PARTIAL-PASS-TWO-VI-RESOLVED-FALSE-TARGET-CONFLICT-STRUCK-E8-SOURCE-REFUSAL-NEXT-2026-08-21.md`),
2026-08-21. Grades AR-1392 **PARTIAL PASS**: VI-E8-1 and VI-E8-2 accepted; VI-E8-3 stays
`VISUAL_UNRESOLVED`; the buy-side target `SOURCE_CONFLICT` is **struck as false** (it was measured
on a mid-drag frame). Orders a small correction packet, then the honest E8 source-completeness
refusal, then the next calibration source. **No Round 4 authorized.**

Prior controlling ruling: AR-1382A @ `188b41e39908518f8909f6e9e54a45c346813276`, 2026-08-20.

**The AR-1382A architecture correction still stands and is load-bearing:** Extraction Compiler
Blueprint v4 SUPERSEDES the older scout-pipeline assumption that stop/take-profit are always
framework-owned. Source-taught stop/target MUST survive in `SOURCE_FAITHFUL`; a Trading Forge
overlay may be tested separately as `TF_OVERLAY_VARIANT` but never reported as the educator's exact
strategy. Framework fallback is allowed only for genuinely untaught fields and must be
provenance-stamped.

**New permanent control (AR-1383A section 6), binding on all visual work:** for any drag, click,
resize or drawing action, capture BEFORE → DURING → AFTER-DROP and bind the semantic answer ONLY to
the **last stable post-action frame**. An intermediate frame is evidence that the action occurred;
it may never control the conclusion about its result.

## Worker branch + last verified head

`claude/worker1-h1-20260815`, inspected by AR-1383A at `4fc0f6f5e72a9fc1c17183007389abbee43a2d4d`;
advances with each subsequent commit. Resolve the current head from the repository, never from this
file.

## Current locks (AR-1385A section 10, until AR-1395 is graded)

- **No Currency Pros purchase or vendor contact.**
- **No credential collection or access-control bypass.**
- **No OCR/screen-scraping live adapter** — screen scraping is evidence tooling only, forbidden as a money-path dependency.
- No invented 4H range selector.
- No Round-4 E8 reconstruction.
- No hand-editing/reusing rejected E8 candidate SHA `b50729b928e51980088f2e4a73c30771eb3665147443753edcc8be44d5fb0041`.
- **No source-taught stop/target replacement by ATR/Style C inside `SOURCE_FAITHFUL`.**
- No E8 source-faithful backtest, certification, or promotion.
- **No external state sent directly to broker execution.**
- **No Currency Pros UI preflight unless the operator explicitly confirms existing lawful access.**
- **No provider webhook, external-state endpoint, or adapter** (that is Stage C1).
- **No broad corpus census until the C0 birth tests pass.**
- No broad Factory rerun or 160-video intake; no PAPER, Topstep, or live execution.

## Exact next money-path action

**Lane A: CLOSED** (AR-1382A section 5 — do not run another compiler-readiness preflight cycle).

**Lane B: EXECUTED AND CLOSED** (AR-1392, corrected by AR-1393 and AR-1394). Targeted Visual
Intelligence ran against `E8Wg6tFPYjo`. **Current verdict, three axes:**
- **VI-E8-1** and **VI-E8-2** `MULTIMODAL_RESOLVED` — accepted, AR-1383A §§2–3.
- **VI-E8-3A** `MULTIMODAL_RESOLVED` — the external indicator computes the 4H Premium/Discount state
  and displays it on the 15m chart. **VI-E8-3B** `EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED`
  (**nonterminal**). Native range selector stays `SOURCE_INCOMPLETE`.
  ~~*Previously recorded as `VI-E8-3 VISUAL_UNRESOLVED / COMPILE_BLOCKER_SOURCE_MISSING`, accepted by
  AR-1383A §4*~~ — 🛑 **superseded by AR-1384A; that verdict is false.**

Evidence: `.../visual-intelligence-e8-round1/E8Wg6tFPYjo/`, **34 artifacts** hashed in
`artifact-manifest.sha256` (~~32~~ — two panel magnifications added by AR-1394). Verify with
`python scripts/_worker_vi_e8_hash_manifest.py --verify`, which checks **portable decoded-pixel**
identity *and* environment-local byte identity; plain `sha256sum -c` checks the byte half only.
AR-1391's claim that no VI executor capability exists was **false and is struck** — the capability is
a documented worker procedure with committed precedent; the yt-dlp 403 that appeared to be a hard
access wall was a **seven-week-stale dependency**, and the unmodified documented command works on
2026.08.19.

**Lane C: ~~CLOSED BY REFUSAL~~ — REFUSAL SUSPENDED** (AR-1384A). The refusal at
`.../E8-SOURCE-COMPLETENESS-REFUSAL.md` is `SUSPENDED_PENDING_EXTERNAL_DEPENDENCY_PREFLIGHT`,
preserved as history and **not authority**. Its premise — that the required 4H state is absent from
the source — is false: an external indicator computes it and shows it on the 15m chart.

**AR-1394 (delivered, graded PASS WITH CORRECTIONS by AR-1385A):**
- **Stage A — DONE.** Refusal suspended; `VI-E8-3A` / `VI-E8-3B` / native-gap recorded separately in
  `E8-EXTERNAL-DEPENDENCY-RECORD.md` with the seven ownership questions answered; the mutating
  proof/generator split repaired. Manifest carries **portable PIXEL** hashes beside
  environment-local **BYTE** hashes; AR-1393's "byte-identical regeneration" claim **withdrawn** as
  environment-local over-scope. GPT independently reproduced this under Pillow 12.3.0.
- **Stage B — `BLOCKED_OPERATOR_ACCESS_REQUIRED`**, correctly. Access **unconfirmed**, not disproven.

**AR-1395 (delivered, this seat):**
- **Packet A — DONE.** Active-state corrections (§3) and the mutation arms moved to a **temporary
  evidence root** with a containment control that aborts mid-mutation and proves the real tree is
  untouched (§4). Six arms, three of them controls.
- **Packet B / Stage C0 — DONE.** `ExternalDependencySpec`, `validate_external_dependencies()`,
  a module-computed contract hash, and `ProjectionSpec.external_dependencies` (omit-when-empty).
  Fail-closed: `UNKNOWN` must map to `NO_TRADE`; a contract with no `UNKNOWN` value is refused; all
  four access axes block independently. Unresolved access drives the **existing RED route** with a
  **nonterminal** structured blocker, and `semantic_status` survives the RED grade.
  **Committed v2.1 receipt byte-identical** (`3ccb4080…`, canonical `fd79f602…`).
- **Self-found defect, repaired:** the compile seam never read readiness, so a
  `BLOCKED_EXTERNAL_DEPENDENCY` artifact compiled as executable. Closed at `6ddb18b0`.
  ★ *A readiness signal that no consumer enforces is not a gate, it is a comment.*

**AR-1395 INDEPENDENT GRADE — `BOUNDED`, VERIFIED band 5/10** at pin `b3cc79cb`. Full durable
receipt: `worker-advisor-reports/GRADE-AR1395-STAGE-C0-BOUNDED-2026-08-21.md`. **14 attacks landed,
7 bounced.** It corroborated byte-identity four ways, killed 16 of 17 planted mutants, proved **zero
regressions** across a 2394-test A/B, and independently **confirmed** the `system-map:check`
pre-existing claim — and it convicted the work on two CRITICALs and three novel HIGHs.

**AR-1396 (delivered) — every grader finding closed.** The two that matter most:
- **F-2 CRITICAL, a genuine FAIL-OPEN:** gate coverage was one-directional, so an undeclared extra
  gate key passed validation and reached consumers as an actionable mapping. Now an equality in
  both directions.
- **F-8 HIGH:** the spec loader never passed `external_dependencies`, so **no production caller
  could declare one** — the feature and its guards were unreachable. ★ *Existence is not wiring.*
Plus `implementation_status` now gates, `UNAVAILABLE` is terminal and correctly named, the caller's
contract dict is deep-copied, alias/duplicate consumers are refused, and the fixture is hash-pinned.
C0 suite `41 → 59` passing; sibling 31, downstream 32, certifier `GREEN_ALL_ITEMS_DONE`, committed
receipt still byte-identical.

🛑 **STILL UNPROVEN, and carried deliberately:** the full `src/engine/tests/` sweep did not complete
for the worker *or* the grader (~2h; killed partway). **~7,300 tests were never executed at either
commit by either party.** Treat *"full engine sweep green"* as an **unproven claim independent of
this packet** — the grader's words, adopted verbatim.

**Stage C1 — STILL GATED.** Provider preflight, adapter, webhook, live/historical parity. Requires
explicit operator confirmation of lawful Currency Pros access. *"We use TopstepX"* is neither yes
nor no (AR-1385A §8).

🛑 **PRE-EXISTING CI DRIFT, HANDED OFF (not caused by this packet):** `npm run system-map:check`
exits 1 — *"Registry is missing 3 engine subsystem mappings"*: `battery`, `extraction`, `forensics`.
All three directories exist at `4fc0f6f5`, before any AR-1393/1394/1395 work. The fix lives in
`src/server/lib/system-topology.ts` and its registry, **outside worker-1's `edit_scope`** — it needs
a seat with `src/server/` authority. Diagnostic: `scripts/_ar1395_systemmap_probe.py`.

**Lane D: CLOSED.** This file plus the `worker-onboarding/SKILL.md` fixes (branch-head-by-commit-time
authority scan, the AR-1382A section 8 routing correction that `gpt-rulings` is authoritative and a
newer `gpt-engineering` commit is not a ruling, and the wrong-ref ear-arming warning in section 2a).

~~**OPEN DECISION, GPT's to make:** AR-1383A section 8 item 5 says "move to the next calibration
source"...~~ 🛑 **MOOT under AR-1384A** — E8 is no longer being moved on from. The measured fact
stands and is retained for whenever a successor *is* needed: `[MEASURED 2026-08-21]` **no ordered
calibration-source queue exists in this repository**; the census manifests are flat inventories with
no priority field.

~~**THE ONE THING BLOCKING THE MONEY PATH RIGHT NOW:** whether the operator already has lawful
Currency Pros indicator access...~~ 🛑 **CORRECTED by AR-1385A §3.2 — that overstated it.** Currency
Pros access blocks **Stage C1 provider integration only**. It does **not** block **Stage C0 compiler
calibration**, which AR-1385A authorizes *now* and which needs no access, no purchase and no
provider at all.

**Operator access question, still open but no longer a blocker for current work:** does the operator
already hold lawful Currency Pros access in the normal TradingView UI? *"We use TopstepX"* is
neither yes nor no (AR-1385A §8). If **yes** → the bounded AR-1384A §7 preflight resumes. If **no**
→ E8 stays calibration-only and nothing is spent.
