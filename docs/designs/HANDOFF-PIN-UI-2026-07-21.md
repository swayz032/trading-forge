# HANDOFF — member-Office PIN entry UI (the actual cure for the Locked room)

> Authored 2026-07-21 by the ops-experience working agent at the end of a long context, per **OR-164**
> (fresh-context start approved). Everything below is **verified from disk at write time** unless tagged
> `[unverified]`. Read this cold; you should not need to re-derive anything.
>
> **Read first:** `ADVISOR-RULINGS-OPS.md` OR-163 §2 (the ruling) and OR-164 (the approval + why fresh).
> Report to `AGENT-REPORTS-OPS.md` as OA-144+. Single-writer: never edit the rulings file.

---

## 1. Why this unit exists

The member Office renders a permanent **"Locked / Enter your code"** card for every member. Two
independent gaps caused it, and **item 6 was graded BAND 8 with both live underneath**:

1. The API was never mounted — **FIXED and LANDED `048a6f7e`** (mount + a class-guard over every
   Slumhouse router).
2. **There is no PIN entry UI.** ← this unit. Nothing calls `pin/establish` or `pin`.

`src/server/lib/member-office-scope.ts:94` — `if (pinSatisfied !== true) return DENY("pin_required")` —
gates **every** surface. Only those two routes can set it true. So until this UI exists, `scope.surfaces`
is `[]` and the room stays locked no matter what else ships.

**Latency check (do this again before you tell the operator anything):** Tier-2 is Phase-5 deploy-gated,
`TF_PHASE_5_ENABLED` is absent from `.env` (default false), and item 10 (family onboarding) is still open
→ **zero members affected today.** Real defect, no live victim. Do not describe it as a live outage.

---

## 2. What already exists (verified — do not rebuild)

| Piece | Location | State |
|---|---|---|
| `POST /slumhouse/api/member/pin/establish` | `routes/slumhouse/api/member-office.ts:90` | Live, mounted. First-run only; **refuses if a PIN already exists**. |
| `POST /slumhouse/api/member/pin` | same, `:152` | Live, mounted. Verifies, mints the PIN ticket cookie. |
| `GET /slumhouse/api/member/scope` | same, `:210` | Live, mounted. Returns `{surfaces, displayName}`. |
| PIN policy / hashing / lockout | `lib/member-pin.ts` | `hashPin`, `verifyPin`, `evaluateAttempt`, `nextAttemptState`, `PIN_POLICY`, `PinPolicyError`. |
| PIN ticket (2nd factor marker) | `lib/slumhouse/pin-ticket.ts` | HMAC, 12h TTL, **purpose tag inside the MAC** — study this before touching auth. |
| Storage | `slumhouse_member_pins` (`schema.ts:3603`) | `pinHash`, `failures`, `lockedUntil`. **No migration needed.** |
| The page | `public/slumhouse/member-office.html` | Renders scope cards. **Zero PIN markup** — one comment mentions "pin", nothing else. |

**The backend is done.** This unit is a form plus its wiring. Resist scope creep into the routes.

---

## 3. What to build

A PIN section in `member-office.html`, shown when `scope.surfaces` is empty (today's "Locked" card):

- **First run** (no PIN yet) → establish: enter twice, confirm, `POST …/pin/establish`.
- **Return** (PIN exists) → verify: enter once, `POST …/pin`, then **re-fetch `/scope`** and render.
- Distinguish the two by the establish route's own response (it refuses when one exists — **read the
  route's actual status/error shape from disk; do not guess it**).

### Non-negotiables

1. **The PIN never enters the DOM, a log, an audit row, or a response.** Clear the input in a
   `finally`, not after a successful fetch — `member-office-html-guards.test.ts:36` already enforces
   exactly this for the connect-card key; **mirror that test for the PIN.**
2. **`type="password"`, `autocomplete="off"`, `inputmode="numeric"`.**
3. **Fail-CLOSED.** Any error → stay locked. Never render surfaces the server did not authorise.
4. **Never decide access client-side.** The page renders what `/scope` returns. `member-office.html:123`
   already states this; keep it true.
5. **Lockout is legible but not informative** — show that they must wait and roughly how long; never
   how many tries remain or whether they were close (`member-office.ts:191` is deliberate about this).
6. **Members only.** The operator has his own Office; Carter must never appear here
   (`member-office-html-guards.test.ts` enforces the Carter ban — keep it green).

---

## 4. Bars this unit must clear

- **Mutation-test every guard at birth.** Non-negotiable, and it is what caught the real holes all turn.
  Minimum mutations: PIN echoed into the DOM; clear moved out of `finally`; surfaces rendered on a
  failed `/scope`; lockout message leaking attempts-remaining. Each must go **RED**, and restore
  byte-identically after each.
- **The guard must be non-vacuous** — assert it fails when the property is absent, not merely that it
  passes today.
- **Independent grade before landing** (doer ≠ grader). ★ Per OR-160/OR-163 the grade **must verify the
  member can complete the WHOLE flow — sign in → enter PIN → see surfaces — through the PRODUCTION
  mount path**, never an app the test builds itself. That gap is exactly how item 6 escaped twice.
- FF-land on `hardening/phase-0`, sync `main`, verify with `ls-remote`.

---

## 5. Traps that cost real time this session

- **CRLF:** editing an LF file on Windows silently rewrote **whole files** (1809 lines for a 9-line
  change; again for AGENT-LOGS). **Always `git diff --numstat` before committing**; fix with
  `sed -i 's/\r$//'`. Do not add a repo-wide `.gitattributes` rule.
- **`npx tsc` false-cleans.** Use `node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc
  --noEmit -p tsconfig.json`. Baseline here is **0 errors** (the ~7036 in memory is stale) — and prove
  the instrument runs with a deliberate error injection before trusting a clean result.
- **`system-map:check` is RED and pre-existing** (SSE/cron inventory drift). Base-verified twice. Not
  yours; don't chase it.
- **Do not `git stash`** (shared ref, §11b). Do not force-push `ops/office-rails-20260719` (diverged).
- **A test that builds its own app proves nothing about production wiring.** The whole reason this
  unit exists.

---

## 6. ★ The one carried lesson

Every failure this turn was in a **claim about the work**, never the work. Severity ("broken this whole
time" — population never checked), coverage (accepting a filter claim that was refutable), cure (a commit
claiming to fix the Locked room it did not fix), and a count (102, mislabelled; truth 72).

**A claim's scope is a value, and it gets verified by a command — who is affected, what is covered, what
is actually cured, how do I know.** Not by conviction. Point the instrument you already aim at code at
your own sentences, including the ones you write to the operator: on that channel there is **no
backstop** (OR-162 §20 — the advisor relay does not cover it).

---

## 7. State at handoff

- `main` == `hardening/phase-0` == **`048a6f7e`** (`ls-remote`-verified).
- 9a security core (`agent-pairing.ts`, `agent-ticket.ts`, 30 tests, mutation-proved) sits **unlanded** on
  `ops/item9a-wip-20260721` @ `7ad24f2b` — deliberately, it has no caller yet.
- **Sequence: PIN UI (this) → 9a's pairing route → 9b heartbeat.**
- **9c (tray app + auto-update) RESERVED** on the operator's spend call — code signing is real recurring
  cost. Nothing installed, nothing incurred. Do not start it.
