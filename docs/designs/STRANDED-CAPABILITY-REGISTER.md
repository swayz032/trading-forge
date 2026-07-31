# STRANDED-CAPABILITY REGISTER

> **Minted R-432 (2026-07-29) as a PLANNING PRECONDITION.** Before any new
> implementation work is commissioned, the desk records what is already built and
> not shipped, and evaluates it before authorizing duplicative development.
> **Building what you already own is the most expensive possible mistake — this
> desk found five chances to make it in one evening.**
>
> **Opened by the advisor seat (R-429 item 4 / R-432 §6). Owner: the ADVISOR.**
> Every row carries an evidence grade. A row without a MEASURED code location is
> a rumour, not a capability.

---

## REFRESH LOG

**2026-07-31 — R-499 `I21`, worker seat.** ★★★ **EVERY ROW RE-MEASURED, NOT RE-DATED.** All five code locations re-verified at the executable line; production-absence re-run in the deployed tree; row 5's test coverage converted from `[UNENUMERATED]` to an enumerated list; row 3's assignee corrected.

**TREES THIS REFRESH MEASURED, NAMED SO THE NEXT SEAT CAN REPRODUCE IT:**
| role | path | identity |
|---|---|---|
| campaign | `wt-h1-wave4-20260712` | `h1-wave4-sealed12-driver` |
| **deployed / RUNS** | `trading-forge/runtime-production` | **`9af37b8f`**, branch `hardening/slumhouse-shared-office-parity-20260723` |
| row 5 only | `trading-forge/.claude/worktrees/extraction-100` | `extraction/100pct-evidence` |

⚠️★★★★★ **CHANGE OF STATE FOUND — `PRESENT-BUT-DIVERGENT` IS NOT `ABSENT`, AND THIS REGISTER WAS CONFLATING THEM.** [MEASURED HERE] the deployed tree **HAS** `spec_family_bindings.py` at **`40,583` B** against the campaign's **`160,049` B** — a **3.9x divergence**. Rows 1–3's *"0 refs in the deployed engine"* is therefore an absence **inside a file that exists and is a much smaller variant**, not a missing module. **`backtester.py` diverges the OTHER way: deployed `457,501` B vs campaign `438,809` B.** ★★★ **`graph-to-engine.ts` is genuinely ABSENT from the deployed tree — so row 5 is the only true file-level absence here.**
★★ **WHY IT MATTERS: a port designed against a 160KB source into a 40KB target is a different job from wiring a flag, and the register previously read as though the only gap were configuration.**

**POSITIVE CONTROL FOR EVERY ZERO ABOVE** (`ABSENCE CLAIM NEEDS A POSITIVE CONTROL`), identical pipeline, deployed tree: `backtester` → **`364`** files · `import` → **`4,140`** files. **The grep provably reads that tree; the zeros are real.**
⚠️ **SCOPE, STATED NARROWLY: this refresh re-measured the five rows' own claims. It did NOT run a fresh sweep for NEW stranded capabilities — the `[UNENUMERATED]` non-flag-gated class below is untouched and still open.**

---

## WHY THIS EXISTS

Three of the five capabilities below target **the three largest measured blockers
on the live library** — structure binding, session binding, and role semantics.
★★★ **The campaign has been building the fixes and not shipping them.** The
bottleneck may be shipping, not building — and that is a claim this register
exists to keep visible rather than rediscover a sixth time.

**How each was found matters:** `TF_LEVELZONE_*` was found only because the desk
happened to know which flag to test (R-425). The sweep that found the next two
(R-429) was bounded to **env-gated** capabilities. `TF_SEMANTIC_ROLE_CLASSIFIER`
was found by a worker chasing an unrelated question into an excluded directory.
★★ **[UNENUMERATED] non-flag-gated stranded capability — a capability with no
flag is invisible to a flag sweep and no less absent.**

---

## THE REGISTER

### 1. `TF_LEVELZONE_ROUTING_ENABLED`
- **Code location:** `spec_family_bindings.py:145` (campaign tree) — ★ **RE-VERIFIED 2026-07-31 AT THE EXECUTABLE LINE**, not a comment match: `return os.environ.get("TF_LEVELZONE_ROUTING_ENABLED", "false")… == "true"`
- **Default:** OFF · **Production config:** **ABSENT** — [MEASURED] 0 non-test refs in the deployed engine
- **Blocker addressed:** `WAIT_STRUCTURE` binding — [MEASURED, R-425] campaign `6 of 155` vs deployed `0 of 155` with flags on
- **Test coverage:** campaign-side only · **Why not deployed:** never ported; the 4.6x binding-lane replacement was barred by R-415 pending its own contract
- **Prerequisites for safe activation:** R-425's port sequence — semantic+dependency diff (never a folder copy) · red-proof first · **acceptance is the SIX PINNED CONDITION IDENTITIES, never the count** · flags-off unchanged · cross-lane per-condition parity re-run
- **Grade:** [MEASURED HERE, R-425]

### 2. `TF_LEVELZONE_RESOLVER_ENABLED`
- **Code location:** `spec_family_bindings.py:280` (campaign tree) — ★ **RE-VERIFIED 2026-07-31 AT THE EXECUTABLE LINE.** ★★ Also `:245` records it is gated behind **BOTH** flags, confirming rows 1–2 ship together
- **Default:** OFF · **Production config:** **ABSENT** (0 refs)
- **Blocker addressed / prerequisites:** same pair as #1; they ship together
- **Grade:** [MEASURED HERE, R-425]

### 3. `TF_SESSION_ROLE_RESOLVER_ENABLED`
- **Code location:** `spec_family_bindings.py:2312`; the capability is `classify_session_role` (`:2085`) — ★ **BOTH RE-VERIFIED 2026-07-31**: `:2312` is the executable `os.environ.get(…)` gate, `:2085` the `def classify_session_role(...)` line (campaign file now `2,907` lines)
- **Default:** OFF · **Production config:** **ABSENT** — [MEASURED] `classify_session_role` has **0** non-test references in the deployed engine
- **Blocker addressed:** ★★ **`C2` — recognized session / missing clock, the SECOND-LARGEST class at 20.6% (94 refusals per-video)**
- **Why not deployed:** unknown — not investigated
- **Prerequisites:** ★★★ **RUN IT FIRST.** [NOT MEASURED] whether it binds a single `C2` condition. `TF_LEVELZONE_*` proved a flag can be a real capability in one lane and inert in another — **measure the yield before designing a port**
- **Grade:** [MEASURED HERE, R-429; **code location + deployed absence RE-MEASURED 2026-07-31**] · ⚠️★★★ **ASSIGNEE CORRECTED — NO LONGER THE ADVISOR SEAT. R-499 §6 authorizes lane `I7` ("measure `C2` session-role resolver yield") TO THE WORKER SEAT.** The row's own prerequisite — *"RUN IT FIRST … measure the yield before designing a port"* — **IS** `I7`. **Status: AUTHORIZED, not yet run at this refresh; the yield stays [NOT MEASURED] until `I7` closes.**

### 4. `TF_WIRE1_HTF_COLUMNS`
- **Code location:** `backtester.py:6702` (campaign tree) — ★ **RE-VERIFIED 2026-07-31 AT THE EXECUTABLE LINE**: `if os.getenv("TF_WIRE1_HTF_COLUMNS", "")… in ("1","true","yes")`
- **Default:** OFF · **Production config:** **ABSENT**
- **Blocker addressed:** HTF column plumbing
- **Why not deployed:** ★ likely deliberate — **WIRE-1's DoD was WITHDRAWN (R-080); the 0.99 target never moved.** Absence may be correct, not stranded
- **Prerequisites:** confirm the WIRE-1 withdrawal covers it; **if so, RETIRE this row rather than port it**
- **Grade:** [MEASURED HERE, R-429] presence/absence · [RELAYED] the WIRE-1 disposition

### 5. `TF_SEMANTIC_ROLE_CLASSIFIER`
- **Code location:** `src/server/lib/graph-to-engine.ts:75` (`semanticRoleClassifierEnabled()`), consumed at `:93`/`:100`; classifier `classifyGateStrengthDeterministic` → `gateStrengthToRole`
- **Tree:** ★★ **branch `extraction/100pct-evidence` in `.claude/worktrees/extraction-100` — NOT the primary checkout, and NOT the deployed tree**
- **Default:** OFF (`process.env.… === "true"`) · **Production config:** **ABSENT** — [MEASURED] 0 refs in the deployed `src/`, 0 occurrences in the runtime `.env`; the file itself is not in the deployed tree
- **Blocker addressed:** ★★★ **role semantics — the replacement for `inAndGroup.has(a.id) ? "confluence" : "spine"`, the shape-based heuristic currently supplying EXECUTION AUTHORITY to the preflight**
- **Test coverage:** ★★★ **ENUMERATED 2026-07-31, was `[UNENUMERATED]`** — **`2` files**, both in the `extraction-100` worktree: `src/server/lib/__tests__/gate-strength.test.ts` · `src/server/lib/__tests__/gate-strength-iteration.test.ts`. ⚠️ **They cover the CLASSIFIER (`classifyGateStrengthDeterministic` / `gateStrengthToRole`). Whether they cover the FLAG-OFF path at `:93` is [NOT MEASURED] — enumerating files is not reading their assertions, and I am not converting a file list into a coverage claim**
- **Why not deployed:** [UNENUMERATED] — a Corpus-v3 addition that never left its branch
- ⚠️★★★ **DEPLOYED-TREE REFERENCE EXISTS AND IS COMMENT-ONLY — RECORDED SO THE NEXT SWEEP DOES NOT MISREAD IT AS DEPLOYMENT.** [MEASURED HERE] `TF_SEMANTIC_ROLE_CLASSIFIER` returns **`1`** file in the deployed tree: `scripts/corpus-v3-shadow-gate3.py`, lines `11` and `14` — **both inside a docstring** describing how fixtures were extracted. **`A GREP MATCHING ONLY COMMENTS IS NOT A VERIFICATION`**; deployed `src/` is still **`0`**, the runtime `.env` still **`0`**, and `graph-to-engine.ts` is **genuinely ABSENT from the deployed tree**. **The capability remains unshipped**
- **Prerequisites:** ★★★ **the full R-432 migration packet — shadow mode over the 40 videos · transcript-grounded grading · positive AND negative controls · a flags-off control reproducing the current library · immutable versioning · independent grading. NOT a flag flip.** ★★ **Acceptance is NOT "more strategies pass" — it is that classifications match each condition's source-supported FUNCTION**
- **Grade:** [MEASURED HERE, R-432]

---

## STANDING RULES

1. ★★★ **No new detector/binder/classifier work is commissioned until this
   register is consulted and the desk states, in the authorizing ruling, whether
   an existing capability already addresses the blocker.**
2. **A stranded capability is not evidence that it works.** Every row's yield is
   [NOT MEASURED] until run in the lane that will execute it.
3. **Absence can be correct** (see #4). A row may be RETIRED with a reason —
   retirement is a disposition, not a deletion.
4. **New rows are added by whoever finds them**, with a MEASURED code location
   and a production-configuration check in the DEPLOYED tree.
5. ★★★★★ **ADDED 2026-07-31 (`I21`) — A PRODUCTION-ABSENCE ROW MUST DISTINGUISH
   THREE STATES, NEVER TWO:** `FILE ABSENT` · **`FILE PRESENT BUT DIVERGENT`
   (name the byte sizes of both copies)** · `FILE PRESENT AND EQUIVALENT, FLAG
   UNSET`. **This refresh found rows 1–3 recording state 1's language for
   state 2's reality — the deployed `spec_family_bindings.py` exists at `40,583` B
   against the campaign's `160,049` B.** ★★★ **The port cost differs by an order
   of magnitude between those states, and a row that says only *"ABSENT — 0 refs"*
   hides which one you are buying.**
6. ★★★ **ADDED 2026-07-31 — EVERY `0` IN THIS REGISTER OWES A POSITIVE CONTROL
   RUN THROUGH THE SAME PIPELINE, RECORDED BESIDE IT.** An empty grep over a wrong
   path, a stale tree or a mistyped flag is indistinguishable from a real absence,
   and this register's entire value is its zeros.
7. ★★ **ADDED 2026-07-31 — RE-MEASURE, DO NOT RE-DATE.** A refresh that carries an
   old value forward under a new date launders `[MEASURED]` on a fact nobody
   checked. **Line numbers move; trees diverge; a number is only as fresh as the
   run that produced it.**
