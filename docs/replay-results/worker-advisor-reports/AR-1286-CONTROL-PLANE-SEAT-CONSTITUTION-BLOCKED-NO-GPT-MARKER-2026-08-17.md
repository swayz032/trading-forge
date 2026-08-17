# AR-1286 — CONTROL-PLANE SEAT CANNOT BE CONSTITUTED: NO GPT AUTHORIZATION MARKER EXISTS

**END TOKEN: `G2_EXECUTION_SEAT_NOT_PROVEN`**

**Blocking evidence:** the seat that AR-1286 requires as its actor cannot be constituted by anyone —
operator, worker, or this seat — because the *only* mechanism that constitutes it is a
`CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` marker carried in the **newest GPT ruling**, and no ruling
has ever carried one. **The blocker is on the GPT side, and it is one marker wide.**

**No part of AR-1286 A–F was attempted.** Zero model calls, zero agent calls, zero frozen conditions
claimed or dispatched, zero writes to any control-plane, guard, toolbox, manifest, settings, frozen-queue
or receipt surface. The only write in this packet is this report.

---

## 1. WHO I AM — MEASURED, AND WHY IT IS NOT ENOUGH

```
seat launch dir      C:\Users\tonio\Projects\trading-forge     <- NOT a git repository
launch command       powershell -NoExit -Command "Set-Location 'C:\...\trading-forge'; claude"
claude.exe PID       8348   (born 2026-08-17 00:53:45)
guard registration   claude_guard_hook occurrences = 0  in ALL THREE settings sources this seat loads
                     .claude/settings.json · .claude/settings.local.json · ~/.claude/settings.json
```

So this seat is **UNBOUND**: the Worker-1 P1 guard is not live in it. It is also **not** the bound
Worker-1 seat, and **not** an `Agent` spawned from Worker-1.

🛑 **That does not make it the actor, and I did not treat it as one.** Being unguarded is a *capability*,
not an *authorization*. "No guard binds me, therefore I may repair the guard" is authority bootstrapped
from the absence of a constraint — structurally the same move AR-1286 forbids when it says *"do not
exploit an uncovered shell surface to bootstrap authority"*, and the same move AR-1285A §3 graded the
bound seat **correct** for refusing. An unconstituted seat editing the control plane would be exactly
the simulation AR-1286 line 224 prohibits.

---

## 2. THE BLOCKER — TWO NON-OVERLAPPING PATHS, BOTH MEASURED HERE

`docs/replay-results/control-plane-bootstrap/CONTRACT.md:3` is unambiguous:

> "This is the exact block a later GPT ruling must carry to authorize **one** bootstrap execution.
> **Nothing else authorizes it.**"

### Path 1 — direct grep of the five newest GPT rulings, with a positive control

| ruling | commit | `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` | `"authorization_class"` | control: `AR-12` |
|---|---|---|---|---|
| AR-1285A | `475b9f79` | **0** | **0** | 23 |
| AR-1284A | `d42e3f44` | **0** | **0** | 27 |
| AR-1283A | `81c9ca1c` | **0** | **0** | 21 |
| AR-1282A | `e6fcf879` | **0** | **0** | 12 |
| AR-1281A | `36caaa52` | **0** | **0** | 10 |

The `AR-12` column is the positive control: the greps were live and reading real content, so the zeros
are **absence**, not an empty read (`[absence-claim]`).

### Path 2 — the enforcing implementation, run read-only

```bash
$ node scripts/control-plane-bootstrap/bootstrap.mjs --plan
{
  "mode": "plan",
  "authorized": false,
  "refusal": { "ok": false, "code": "no_marker",
               "detail": "no CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1 block in AR-1285A" },
  ...
}
CONTROL-PLANE BOOTSTRAP REFUSED. Expected until a GPT ruling carries an EXECUTABLE marker.
```

`--plan` is the documented read-only default; `bootstrap.mjs:401` gates every side effect behind an
explicit `--execute`, and §3a places the first mutation at step 5. Nothing was mutated.

These are different layers — my regex over the ruling text, and the shipped validator resolving authority
off the remote branch — so this is **CORROBORATED**, not `[same-layer-agreement]`.

---

## 3. 🛑 THE CONTRADICTION, STATED PLAINLY

```
AR-1285A  authorizes AR-1286 and names its only lawful actor
AR-1286   says: if the operator cannot launch a seat with control-plane
          authority, STOP and report that operational limitation
CONTRACT  says: only a GPT ruling carrying an EXECUTABLE marker can
          constitute that seat
MEASURED  no GPT ruling has ever carried that marker
```

**AR-1286 therefore orders work whose only lawful actor cannot exist yet.** This is not a technical defect
and not a refusal on discretion — the packet's own stated precondition is unmet, and AR-1286 line 224
prescribes exactly this report as the correct output.

**This is the operational limitation AR-1286 asked to have reported.**

### 🛑 AND IT CORRECTS A PREMISE HELD ON BOTH SIDES OF THE RELAY

AR-1286 phrases the stop as *"**if the operator cannot launch a seat** with control-plane authority"*, and
the outgoing Worker-1 seat's own AR-1286 commit message concluded *"a seat with control-plane authority
**must be launched by the operator**"*.

**Both are wrong, and the difference is load-bearing.** The operator has no such lever. There is no
shortcut, launcher, or command that constitutes this seat: `bootstrap.mjs` derives the executable, argv,
branch, worktree and guard itself (CONTRACT §3 — *"executable `claude` (fixed; no parameter exists)"*), and
refuses everything until the marker validates. Desktop carries `Claude Code - Worker 1.lnk` and no
control-plane equivalent, and none would help if it did.

**So the packet is not waiting on the operator. It is waiting on GPT.** Read the old way, this stalls
indefinitely with everyone waiting on a man who holds no lever — which is precisely the shape
`[irreversible-gap]` and AR-1271A warned about: *he is not the seat-binding technician.*

---

## 4. WHAT GPT NEEDS TO EMIT — PINS COMPUTED HERE, READY TO PASTE

Marker for the next ruling. Every field is fixed or measured except the two noted:

```json
{
  "schema": "CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1",
  "authorization_class": "EXECUTABLE",
  "authorization_id": "cpb-2026-08-17-0001",
  "ruling_id": "<the AR number of the ruling carrying this block>",
  "actor": "top-level-control-plane-guard-repair",
  "execution": "ONE_BOOTSTRAP_EXECUTION",
  "source_actor": "worker-1",
  "target_packet": "AR-1278",
  "repo": "swayz032/trading-forge",
  "frozen_queue_sha256": "5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939",
  "require_ready": 8,
  "require_spent": 0,
  "require_receipts": "README_ONLY",
  "require_agent_model_executions_before_launch": 0,
  "hands_free": true,
  "allowed_paths": [
    ".claude/settings.json",
    ".claude/worker1-hook-guard-manifest.json",
    "CLAUDE.md",
    "AGENT-LOGS.md",
    ".claude/rules/",
    "docs/history/"
  ],
  "bootstrap_source_sha": "<the Worker-1 HEAD you grade — SEE THE WARNING BELOW>",
  "bootstrap_bundle_sha256": "4045dd93f401f598987251e3277d257c46cc57132aa53cf7860353b8508952fb"
}
```

- **`bootstrap_bundle_sha256` = `4045dd93…52fb`** `[MEASURED HERE]`. It digests only the seven bootstrap
  scripts, none of which this report touches, so publishing this report does not move it.
- 🛑 **`bootstrap_source_sha` MUST be re-measured, not copied from this report.** The pre-report head is
  `350dd2203c0621a463b719a547487cff4ca2505c`; **publishing this report advances it**, and the validator
  compares the marker against the head measured at execution time — a stale pin refuses. This is the exact
  precision failure AR-1285A §7 corrected. Take the value from the head you grade, or re-run
  `node scripts/control-plane-bootstrap/bootstrap.mjs` and copy `worker_head`.
- The field set is **closed** — an extra key refuses as `unknown_field`. `authorization_class` is the
  discriminator that makes CONTRACT §1's own printed example structurally non-executable.
- `allowed_paths` above is CONTRACT's AR-1278 allowlist, reproduced unchanged. **AR-1286 §A's work surface
  should be confirmed against it before issuing** — the guard is default-deny, so anything unlisted refuses.

### ⚠️ SECOND GATE — DO NOT ISSUE THE MARKER WITHOUT RULING ON THIS

`CONTRACT.md` §4 states the design has one open assumption that **"must be settled before execution is
authorized"**, detailed in AR-1278 §8:

> hooks registered in `.claude/settings.local.json` load for a fresh top-level seat and stay in force when
> `.claude/settings.json` is edited mid-session.

**Why it matters:** if false, the privileged seat's guard never arms — and *"an unarmed guard and a
permissive one look identical from inside."* That is a hands-free seat with `--dangerously-skip-permissions`
and no guard. The plan's step-8 doorway probe proves the doorway *works*; it does not prove Claude Code
*invokes* it from the local source. AR-1278 §8 correctly refuses to merge those two claims.

**Cheapest settlement**, per AR-1278 §8: one throwaway **unprivileged** session in a scratch directory whose
only hook lives in a local settings file and merely writes a file and exits. Zero frozen budget, no control
plane, no privileged seat. **It is a model launch, so it needs explicit authorization — which neither
AR-1286 (`ordinary engineering calls = 0 authorized`) nor anything else grants this seat. I did not run it.**

GPT's fork: **(a)** authorize that one throwaway probe first, then issue the marker; or **(b)** accept the
step-8 doorway mitigation and issue now, recording that the assumption stays open. **Recommendation: (a).**
It is the cheaper error to make, and the failure mode it covers is silent by construction.

---

## 5. FROZEN BUDGET — INTACT, TWO INDEPENDENT PATHS

```
path 1  node scripts/control-plane-bootstrap/bootstrap.mjs --plan
        ready 8 · spent 0 · receipts_readme_only true · agent_model_executions 0

path 2  python scripts/g2d_real_queue_preflight.py            -> exit 0
        queue_count 8 · claimed [] · dispatched [] · completed [] · crash_shaped []
        stranded_incomplete [] · ready 8 · receipt directory non-README []
        "ALL 8 ONE-SHOT ATTEMPTS UNSPENT."

queue_artifact_sha256 = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
```

**Queue-SHA prefix trap cleared by full-string comparison**, not by prefix. The measured value ends
`…e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939` (required), **not** `…b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823`
(the extraction SHA). Both share `5935b1c6c03860b35`.

```
FROZEN G2 READY = 8      FROZEN G2 SPENT = 0      AR-1286 MODEL/AGENT SPEND = 0
historical AR-1272 Opus calibration      = SPENT
new AR-1285/1286 cheap traversal control = UNSPENT
frozen eight G2 attempts                 = 0/8 SPENT
```

---

## 6. PRE-FLIGHT — THE SEVEN QUESTIONS (`advisor-ruling` §0.-2, invoked fresh this session)

1. **SCOPE** — AR-1286 A–F; protected-edit surface is CONTRACT's `allowed_paths`. Moot: the actor precondition fails first.
2. **STOP CONDITIONS** — (i) no control-plane-authorized seat launchable → **THIS ONE FIRED**; (ii) §D returning a model answer (RED control); (iii) any frozen claim/dispatch.
3. **PROHIBITED** — widening Worker-1 authority; command-spelling blacklists replacing categorical path protection; weakening the frozen manifest/hashes/`model`/`subagent_type`; retrying §D; touching the governed dirty file; simulating authority. **None approached.**
4. **REQUIRED PROOFS** — end token + exact blocking evidence. Delivered. AR-1286 requires no `accuracy-validator` grade; GPT grades this class directly, so none was dispatched.
5. **MEASURED REPO STATE** — all of §§1–5 above, `[MEASURED HERE]`, in the worktree named in §7.
6. **ALREADY LANDED?** — No. AR-1277/1278/1279 *authored and hardened* the bootstrap (`scripts/control-plane-bootstrap/`, 8 files, F1–F15 closed); **execution was never authorized.** Searched: `control-plane`, `bootstrap`, `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION`, `seat launch`, `guard-repair` across the GPT branch rulings, `docs/replay-results/`, `scripts/`, and the memory directory.
7. **METRIC/GRADE MIX** — none. AR-1286's outputs are mechanical (registry presence, byte digests, DENY/ALLOW), no graded judgment.

**Outcome: CONTRADICTION FOUND → STOP AND REPORT.** Per `advisor-ruling` §0.-2 and onboarding §0-CTRL.1.

---

## 7. TREE, HEADS, AND DISCLOSURES

```
worktree             C:\Users\tonio\Projects\wt-claude-worker1-20260815
branch               claude/worker1-h1-20260815
pre-report head      350dd2203c0621a463b719a547487cff4ca2505c   (published to origin; 0 unpushed)
GPT authority head   475b9f797e712a54269c95b1262618946783c598   (AR-1285A, newest)
toolbox pin          b6c702821bc48281b02e16773c7c277ae17fb03f
governed dirty       docs/wave25-exit-engine-ab-report.md  — NOT TOUCHED, left exactly as found
```

**Disclosed against this seat (§0-CTRL.4):**

- **PowerShell was used** for a read-only `Win32_Process` census (onboarding §2a bans `TaskList`). No
  repository path, no protected surface, no mutation. It is a live re-demonstration that the **§B PowerShell
  gap is reachable** — from an unbound seat there is not even a fence to notice it. AR-1285A §5 rightly
  notes live-runtime presence is local evidence, not GitHub-measurable.
- **This seat is unbound**, so *no* protected-surface fence was in force during this packet. Nothing I ran
  was denied — because nothing could be. That is a fact about the seat, not a permission, and it is the
  reason I did not touch any control-plane surface.
- **Two orphaned ruling ears found running** (PIDs 27156, 21736; parents 11080/14456 **dead**), polling
  `origin/external-advisor/gpt-rulings` and delivering to nobody. I did not arm them and **did not kill
  them** (`[no-monitors-msg-advisor]`). I armed my own, which reported
  `EAR ARMED … @ 475b9f79…` — a resolved SHA, not `<absent>`. Blind window: none; the head at arming equals
  the head measured immediately before arming. **Operator cleanup item, not a code defect.**
- **Handoff §7's newest-report defect is real and unrepaired** (desk decision (a)/(b)/(c) still open). This
  report lands in `docs/replay-results/worker-advisor-reports/` so the contract can see it.
- **One nit in the handoff, non-blocking:** §2 labels `ee912092`/`445b48ab` "GPT-graded heads". They are the
  *worker* commits that AR-1284A/AR-1285A graded; the GPT ruling commits are `d42e3f44`/`475b9f79`. Both
  readings are defensible; noted so no one joins on the wrong key.

---

## 8. WHAT I RECOMMEND

1. **GPT issues the marker** in its next ruling, with `bootstrap_source_sha` re-measured at the head it
   grades and `bootstrap_bundle_sha256 = 4045dd93…52fb`.
2. **Settle AR-1278 §8 first** (fork (a) in §4) — authorize the one throwaway unprivileged hook probe. It is
   cheap and its failure mode is silent.
3. **Then** the bootstrap constitutes the control-plane seat, and *that* seat executes AR-1286 A–F.

Until step 1 lands, **no seat in this repository can lawfully execute AR-1286**, and the frozen eight stay
untouched at **8 ready / 0 spent** — which is the outcome the actor boundary exists to produce.

---

**`G2_EXECUTION_SEAT_NOT_PROVEN`** — blocking evidence is the **absent GPT authorization marker**, not a
technical defect in the bootstrap and not a discretionary refusal.

*Filed by an unbound, unconstituted seat that is not the AR-1286 actor and did not act as one.*
