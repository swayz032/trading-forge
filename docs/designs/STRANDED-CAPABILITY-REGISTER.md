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
- **Code location:** `spec_family_bindings.py:145` (campaign tree)
- **Default:** OFF · **Production config:** **ABSENT** — [MEASURED] 0 non-test refs in the deployed engine
- **Blocker addressed:** `WAIT_STRUCTURE` binding — [MEASURED, R-425] campaign `6 of 155` vs deployed `0 of 155` with flags on
- **Test coverage:** campaign-side only · **Why not deployed:** never ported; the 4.6x binding-lane replacement was barred by R-415 pending its own contract
- **Prerequisites for safe activation:** R-425's port sequence — semantic+dependency diff (never a folder copy) · red-proof first · **acceptance is the SIX PINNED CONDITION IDENTITIES, never the count** · flags-off unchanged · cross-lane per-condition parity re-run
- **Grade:** [MEASURED HERE, R-425]

### 2. `TF_LEVELZONE_RESOLVER_ENABLED`
- **Code location:** `spec_family_bindings.py:280` (campaign tree)
- **Default:** OFF · **Production config:** **ABSENT** (0 refs)
- **Blocker addressed / prerequisites:** same pair as #1; they ship together
- **Grade:** [MEASURED HERE, R-425]

### 3. `TF_SESSION_ROLE_RESOLVER_ENABLED`
- **Code location:** `spec_family_bindings.py:2312`; the capability is `classify_session_role` (`:2085`)
- **Default:** OFF · **Production config:** **ABSENT** — [MEASURED] `classify_session_role` has **0** non-test references in the deployed engine
- **Blocker addressed:** ★★ **`C2` — recognized session / missing clock, the SECOND-LARGEST class at 20.6% (94 refusals per-video)**
- **Why not deployed:** unknown — not investigated
- **Prerequisites:** ★★★ **RUN IT FIRST.** [NOT MEASURED] whether it binds a single `C2` condition. `TF_LEVELZONE_*` proved a flag can be a real capability in one lane and inert in another — **measure the yield before designing a port**
- **Grade:** [MEASURED HERE, R-429] · **assignee: ADVISOR SEAT, open**

### 4. `TF_WIRE1_HTF_COLUMNS`
- **Code location:** `backtester.py:6702` (campaign tree)
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
- **Test coverage:** [UNENUMERATED]
- **Why not deployed:** [UNENUMERATED] — a Corpus-v3 addition that never left its branch
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
