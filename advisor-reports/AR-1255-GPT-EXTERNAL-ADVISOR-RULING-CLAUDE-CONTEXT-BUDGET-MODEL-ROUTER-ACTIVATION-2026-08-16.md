# GPT EXTERNAL ADVISOR RULING — AR-1255 · 2026-08-16

## POST-AR-1138 MASTER-PLAN ADDENDUM — ACTIVATE CLAUDE CONTEXT BUDGET + AUTOMATIC MODEL ROUTING WITHOUT MAKING THE OPERATOR BABYSIT `/model`

This ruling adds a permanent efficiency lane to the Trading Forge Claude Worker architecture. It does **not** downgrade the main Worker-1 or Worker-2 reasoning model, does **not** alter the G2-D frozen eight-call experiment, and does **not** weaken doer ≠ grader. The operator is not the model router. Worker sessions remain strong; cheap/mechanical side work is routed automatically to cheaper isolated agents, while high-stakes reasoning and independent grading remain on the strongest authorized path.

Operator-supplied Claude `/usage` baseline on 2026-08-16 shows the dominant inefficiency is long parent-session context, not custom-agent count:

```text
92% of recent usage at >150k context
main usage dominated by claude-opus-5
Haiku usage ~negligible
general-purpose subagent ~3%
accuracy-validator ~1%
/advisor-ruling skill ~11%
/worktree-session ~5%
```

That baseline is user-interface evidence, not a repository-derived metric. Do not restate those percentages as CI or deterministic telemetry. The engineering response is nevertheless justified: Claude Code's documented architecture supports cheap-model subagents, forked skills, and fresh/compacted contexts, and the current Trading Forge agent definitions leave meaningful routing opportunities unpinned.

```text
RULING TYPE          : MASTER-PLAN ACTIVATION / NOT A WORKER GRADE
PARENT WORKER MODEL  : PRESERVE OPERATOR-SELECTED STRONG MODEL; DO NOT AUTO-DOWNGRADE
MECHANICAL SEARCH    : HAIKU / BUILT-IN EXPLORE FIRST
STANDARD SIDE WORK   : SONNET WHEN BOUNDED AND TESTABLE
HARD REASONING       : OPUS
INDEPENDENT GRADING  : OPUS + GPT EXTERNAL ADVISOR
FABLE                : NO AUTOMATIC ROUTING YET; RARE MANUAL/SEPARATELY AUTHORIZED ESCALATION ONLY
SESSION MEMORY       : GITHUB + RULINGS + RESUME ANCHOR, NOT GIANT CHAT HISTORY
PACKET BOUNDARY      : NEW AR PACKET => FRESH MAIN CLAUDE SESSION BY DEFAULT
G2-D FROZEN 8 CALLS  : REMAIN FRESH OPUS SUBAGENTS; THIS ROUTER MUST NOT DOWNGRADE THEM
WORKER-2 ACTIVATION  : PREPARE POLICY ONLY; HONOR EXISTING WORKER-2 RUNTIME LOCK UNTIL ITS GATE OPENS
```

---

# 1. WHY THIS IS NOW PART OF THE AR-1138 MASTER PLAN

The earlier speed/robustness plan intentionally separated:

```text
strong parent worker
+ bounded specialists
+ deterministic tools
+ native hooks
+ durable GitHub state
+ independent GPT grading
```

from a naive design where every action happens inside one ever-growing Opus conversation.

The current usage evidence shows the architecture is only partially activated: the main worker is strong, but too much history is being carried forward and some helper definitions inherit the parent model when a cheaper fixed model can safely do the job.

The fix is **not** "operator manually switch models all day."

The fix is:

```text
OPERATOR STARTS STRONG WORKER
        ↓
WORKER CLASSIFIES SIDE TASK
        ↓
CHEAPEST MODEL THAT CAN PROVE THE TASK
        ↓
DETERMINISTIC TEST/CONTROL
        ↓
ESCALATE ONCE TO OPUS ONLY IF NEEDED
        ↓
REPORT
        ↓
GPT RULING
        ↓
FRESH MAIN SESSION FOR NEXT PACKET
```

---

# 2. NON-NEGOTIABLE MODEL ROUTING LAW

## 2.1 Main Worker-1 / Worker-2

Do **not** force the parent Worker session down to Sonnet or Haiku as an automatic cost policy.

The operator may select the main model. Current operator preference/availability is Opus 5. Preserve it unless the operator explicitly changes it or a later ruling establishes a measured reason to do so.

The efficiency gain must come primarily from:

```text
shorter parent context
+ isolated subagent contexts
+ cheap-model side work
+ lean skills
+ deterministic scripts
```

not from weakening the primary engineer.

## 2.2 Read-only search / discovery / census

Default to Claude Code's built-in **Explore** subagent for tasks that are genuinely read-only discovery:

```text
find files
search symbols
map callers
list paths
read bounded code regions
collect simple repo facts
```

Explore is the intended cheap path and uses Haiku in Claude Code's documented built-ins.

Do **not** use general-purpose merely to grep/read a repository when Explore can do it. General-purpose inherits the parent model and is therefore an expensive default for mechanical discovery.

A worker may bypass Explore only when it records the capability reason, e.g. the task requires writes, multi-step mutation, or reasoning that the read-only Explore boundary cannot perform.

## 2.3 Standard bounded implementation/helper work

Create or adapt a **bounded Sonnet helper** for side tasks such as:

```text
implementing an already-specified small edit
writing straightforward fixtures/tests from a frozen contract
mechanical refactors with deterministic before/after checks
normal documentation generation from pinned artifacts
bounded failure reproduction where the hypothesis is already supplied
```

This helper may never:

```text
self-certify its own work
change architecture without parent approval
change trading/risk/live/broker policy
resolve ambiguous source evidence by judgment
promote a strategy
modify a frozen experiment law
```

Its output returns to the parent worker, which owns integration and final worker claims.

## 2.4 Accuracy validator / independent grader

`accuracy-validator` remains **Opus**.

Its role is explicitly independent false-green hunting and grading. Do not cheap-route it merely to save usage. Current repository configuration already pins this agent to `model: opus`; preserve that unless a future controlled benchmark proves an equivalent independent grader without reducing audit quality.

## 2.5 Autonomous-readiness

Current project agent `autonomous-readiness` has no explicit model field and therefore can inherit the parent model.

Phase 1 target: **pin it to Sonnet**, but only after a shadow control proves it still catches a fixed set of known vacation-mode failures. Use at least:

```text
known manual restart dependency
known in-memory-only state dependency
known alert-without-remediation dependency
known manual migration dependency
clean control with none of the above
```

If Sonnet misses a seeded defect the current Opus/inherited path catches, keep it on Opus and report the failed economy experiment. Cost never outranks correctness.

## 2.6 Institutional-edge-researcher

Current project agent `institutional-edge-researcher` also has no explicit model field and can inherit the parent.

Phase 1 target: **Sonnet for source collection + evidence table construction**, while the main Opus worker retains the decision about whether Trading Forge architecture should change.

Required shadow test:

```text
same fixed research brief
same source/time constraints
same minimum-source law
compare source coverage, date compliance, unsupported claims, and recommendation fidelity
```

If the Sonnet researcher meets the contract, pin it. If not, leave it inherited/Opus.

## 2.7 Fable

Do not add automatic Fable routing in this wave.

Reasons:

```text
operator reports it consumes substantially more allowance
current Claude Code public subagent frontmatter documents standard model aliases around Haiku/Sonnet/Opus
no Trading Forge benchmark yet proves Fable earns its extra burn on a repeatable class of tasks
```

Fable is a rare, explicit escalation lane after a separate benchmark/ruling. No worker may automatically choose it because a task "feels hard."

---

# 3. CONTEXT-BUDGET LAW — THE HIGHEST-VALUE CHANGE

## 3.1 One completed AR packet per main Worker session by default

A completed packet means:

```text
work committed/pushed
required tests/controls run
worker report published
resume anchor / next-step state durable in GitHub
```

After that point, the current main Claude conversation is **spent for new packet work**.

The next AR packet starts in a fresh main session using:

```text
worker onboarding
latest GPT ruling
current branch/SHA
resume anchor / packet manifest
only the files needed for the new packet
```

Do not carry 10–20 prior rulings in conversational memory just because the session can hold them.

### Exception

Resume the same session only when it is an interruption of the **same packet** and the old context is directly useful. A new GPT ruling/new engineering packet is a natural reset boundary.

## 3.2 GitHub is durable memory

Before session rotation, all load-bearing state must exist outside chat:

```text
exact branch
exact HEAD
latest accepted ruling path
current packet id
locks
open findings
commands/results that matter
next authorized step
```

Do not depend on "Claude remembers from 200k tokens ago."

## 3.3 Mid-packet context pressure

If the same packet becomes large:

```text
first: push verbose discovery into Explore/other isolated subagent
second: write durable intermediate evidence to a file/artifact when appropriate
third: use focused `/compact` if continuity is still valuable
last: rotate to a fresh session with a resume anchor if the packet itself can be safely segmented
```

Never use compaction to hide missing evidence or lose a frozen experiment law.

## 3.4 Native hook integration

Add context/session rotation to the existing post-AR-1138 native-hook activation plan:

### SessionStart

Emit a **small** startup receipt only:

```text
worker id
branch
HEAD
packet/ruling id
allowed scope
lock state
resume-anchor path
parent model id
```

Do not inject whole old reports into every new session.

### TaskCompleted / finish

When a packet reaches report-ready state, emit:

```text
packet_complete = true
new_main_session_required_for_next_packet = true
resume_anchor = <path/hash>
```

A subsequent unrelated/new packet in the same spent session should be rejected or strongly blocked by the session/packet guard once native hooks are active.

The monitor/orchestrator should start the fresh session. The operator should not have to type `/clear` manually as the normal workflow.

---

# 4. SKILL BUDGET / CONTEXT HYGIENE

The operator's usage UI currently identifies `/advisor-ruling`, `/worktree-session`, and Worker-1 onboarding as visible context/usage contributors.

Do not blindly rewrite personal/user-level skills from the repository. First inventory where each active skill actually comes from:

```text
project .claude/skills
user ~/.claude/skills
plugin/bundled
```

For each mutable Trading Forge-owned skill:

1. Measure SKILL.md size.
2. Keep only the operational core in SKILL.md.
3. Move long examples/history/reference material to supporting files loaded only when needed.
4. Use `paths:` where a skill is only relevant to particular surfaces.
5. Use `context: fork` when the skill is a self-contained task whose verbose work should stay out of the main conversation.
6. Use a cheaper `model:` only when the skill's output is bounded and the shadow test proves quality.
7. Do not cheap-route a skill whose job is independent certification or ambiguous architecture judgment.

### `/advisor-ruling`

Treat this one carefully because it is currently a material usage contributor.

Desired architecture if technically compatible with the installed skill owner:

```text
CHEAP/FORKED INGEST STAGE
- find latest ruling
- extract exact directives/locks/paths/SHAs
- return concise structured packet

PARENT OPUS STAGE
- interpret conflicts
- make engineering decisions
- execute authorized work
```

Do not move final interpretation/decision authority into a cheap parser.

If `/advisor-ruling` is user-level or plugin-owned and cannot safely be changed from this repository, record that fact and create a lean project-owned ingest helper rather than silently shadowing unknown configuration.

---

# 5. ROUTER ESCALATION LAW

Cheap routing is not "retry models until somebody says green."

For a task assigned to Haiku/Sonnet:

```text
cheap attempt
→ deterministic contract/test/control
→ PASS: accept bounded output into parent review
→ FAIL/ambiguity: one escalation to parent Opus
```

No repeated Haiku→Sonnet→Opus→Fable shopping for the nicest answer.

Every escalation records a short reason:

```text
CAPABILITY_MISMATCH
FAILED_CONTROL
AMBIGUOUS_EVIDENCE
ARCHITECTURE_JUDGMENT_REQUIRED
HIGH_STAKES_GRADE_REQUIRED
```

This gives us measured evidence later about which tasks actually deserve Opus.

---

# 6. HARD NO-DOWNGRADE SURFACES

The router must always preserve the high-capability path for:

```text
GPT-ordered certification evidence
accuracy-validator independent grade
compiler/execution architecture changes
source-fidelity ambiguity
visual geometry adjudication
trading/risk/sizing policy
broker / Topstep / live-money surfaces
security/auth/credential changes
frozen experiment design or mutation
incident root causes with capital impact
```

Mechanical sub-parts of these jobs may still be delegated cheaply, but the load-bearing judgment stays Opus + external GPT review.

---

# 7. G2-D SPECIAL EXCEPTION — DO NOT TOUCH THE EXPERIMENT

AR-1254 remains controlling for the current G2-D pre-call repairs.

This efficiency ruling must **not** change:

```text
frozen 8-condition queue
one attempt per condition
fresh isolated Opus requirement
batch-vs-isolated substitution law
receipt/provenance law
collision/relevance/composition/fidelity order
```

The real eight G2-D model calls remain **Opus** regardless of the general router.

Recommended immediate context action:

```text
finish AR-1254 D1.1-D1.4 deterministic repairs
→ publish report + durable resume anchor
→ START A FRESH MAIN CLAUDE SESSION
→ load latest GPT ruling + exact G2-D packet only
→ execute the eight authorized Opus calls when the live runtime authorization gate is satisfied
```

This saves parent-context burn without contaminating the controlled eight-call experiment.

---

# 8. IMPLEMENTATION WAVES — FASTEST ROBUST PATH

## Wave E0 — inventory + baseline, read-only

Worker-1:

```text
1. inventory all project custom agents and explicit/inherited model fields
2. inventory active Trading Forge-owned skills and their locations/sizes
3. identify which helpers inherit the parent model today
4. record current native-hook/session-rotation capability
5. do not mutate G2 files
```

Produce a small machine-readable routing inventory.

## Wave E1 — cheap routing shadow tests

Without changing production routing yet:

```text
A. Explore/Haiku vs current path on fixed read-only repo discovery tasks
B. Sonnet autonomous-readiness vs current path on seeded known defects
C. Sonnet institutional researcher vs current path on fixed research brief
D. optional bounded Sonnet implementation helper on a non-money-path fixture
```

Grade by deterministic/explicit contract, not vibes.

## Wave E2 — pin only proven cheaper routes

If and only if E1 is green:

```text
autonomous-readiness -> model: sonnet
institutional-edge-researcher -> model: sonnet
mechanical discovery -> built-in Explore / Haiku preference
bounded implementation helper -> Sonnet, if its control passes
accuracy-validator -> stays Opus
```

Commit model/frontmatter changes with a before/after routing census.

## Wave E3 — context/session rotation

Integrate with toolbox/native hooks:

```text
packet-complete marker
resume-anchor receipt
fresh-session-required marker
lean SessionStart injection
no next AR packet in spent session
```

Run RED/GREEN controls proving:

```text
same-packet resume allowed
new-packet-after-completion blocked in old session
a fresh session with correct branch/ruling/anchor is allowed
wrong branch/SHA/ruling remains blocked
```

## Wave E4 — skill diet

Optimize only measured heavy skills that Trading Forge owns. Preserve semantics with golden-output or directive-extraction controls.

Do **not** edit unrelated personal Claude configuration without explicit repository ownership and evidence.

## Wave E5 — measured rollout

Run Worker-1 through at least three normal packets under the new law.

Report:

```text
parent model
fresh-session boundary compliance
subagent type + resolved model per dispatch
cheap-route pass/escalation counts
general-purpose uses that could have been Explore
context size/usage evidence that Claude actually exposes
skill usage changes from /usage where available
```

Do not promise a percentage cost reduction before the measurements exist.

Worker-2 receives the same policy configuration only after its pre-existing runtime-activation gate opens.

---

# 9. REQUIRED CONTROLS

No activation claim without these:

```text
CONTROL 1 — read-only repo search resolves through Explore/Haiku
CONTROL 2 — forcing general-purpose/parent Opus for the same mechanical task is detectable as a router-policy violation
CONTROL 3 — accuracy-validator cannot be silently downgraded
CONTROL 4 — seeded autonomy defect must still be caught after Sonnet pin
CONTROL 5 — seeded research freshness/source-count violation must still be caught after Sonnet pin
CONTROL 6 — cheap helper failing its deterministic contract escalates once to Opus
CONTROL 7 — Fable cannot be auto-selected by this router
CONTROL 8 — G2-D frozen eight are immune to generic downgrade routing
CONTROL 9 — completed packet creates durable resume anchor before session rotation
CONTROL 10 — fresh session reconstructs correct branch/SHA/ruling/locks without old chat history
```

Mutation controls must prove at least the load-bearing routing/lock guards can bite.

---

# 10. CLAIM CONTRACT FOR EFFICIENCY

Use these words precisely:

```text
CONFIGURED   = frontmatter/policy exists
ROUTED       = an actual invocation resolved to the intended model
PROVEN       = routed + control passed
SAVED        = measured usage/cost decreased on comparable work
ACTIVE       = native workflow enforces it without operator babysitting
```

Do not say "token optimized", "automatic", "native active", or "saves X%" merely because files were edited.

---

# 11. PRIORITY RELATIVE TO CURRENT COMPILER WORK

Do not derail the money path.

Immediate priority remains:

```text
AR-1254 D1.1-D1.4 pre-call provenance/bridge/receipt repair
```

Then:

```text
if G2-D live Opus dispatch gate is immediately available:
    fresh session → execute controlled G2-D
else:
    execute E0-E3 efficiency/native-session lane while waiting
```

After the real G2-D packet reports, use a fresh session regardless.

The context/session rotation portion is high priority because it reduces burn on every subsequent engineering packet.

---

# 12. SIMPLE OPERATING MODEL

The target system is:

```text
YOU
 │
 └── start/own the goal; NO manual model babysitting
        │
        ▼
WORKER-1 / WORKER-2 — strong parent model
        │
        ├── Explore / Haiku  → search, census, mechanical discovery
        ├── Sonnet helper    → bounded normal implementation/research
        ├── Opus specialist  → hard reasoning / ambiguous engineering
        └── Opus validator   → independent internal grade
                 │
                 ▼
        deterministic tests + toolbox + hooks
                 │
                 ▼
              REPORT
                 │
                 ▼
        GPT EXTERNAL ADVISOR
                 │
                 ▼
              RULING
                 │
                 ▼
       FRESH MAIN CLAUDE SESSION
```

That is the post-AR-1138 master-plan behavior this desk now authorizes.

---

# 13. LOCKS / SAFETY

This ruling changes no trading certification lock.

Still locked until separate evidence/ruling unlocks them:

```text
sVkm certification
sVkm compiler authorization
sVkm backtest campaign
PAPER
Worker-2 runtime activation
broker / Topstep / live
unresolved visual stop geometry
```

Efficiency is an engineering-control lane, not a trading promotion.

---

# VERDICT

**ADD THE CONTEXT-BUDGET + MODEL-ROUTER LANE TO THE POST-AR-1138 MASTER PLAN AND EXECUTE IT. KEEP THE MAIN WORKER STRONG; ROUTE CHEAP SIDE WORK AUTOMATICALLY; PRESERVE OPUS FOR LOAD-BEARING JUDGMENT/GRADING; MAKE A COMPLETED AR PACKET A FRESH-SESSION BOUNDARY; USE GITHUB/RULINGS AS DURABLE MEMORY; DO NOT AUTO-ROUTE FABLE; DO NOT ALTER THE FROZEN G2-D EIGHT-OPUS EXPERIMENT.**
