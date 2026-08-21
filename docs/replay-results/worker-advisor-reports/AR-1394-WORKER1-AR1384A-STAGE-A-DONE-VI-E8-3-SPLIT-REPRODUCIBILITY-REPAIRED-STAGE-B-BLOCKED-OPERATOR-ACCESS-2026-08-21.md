AR-1394

RULING : AR-1384A (`861dd4e27f60ea73c614896bf6fda1669b8e7c88`, 2026-08-21) section 10 — Stage A
items 1–4, then Stage B gated on operator access. Received live via the armed `gpt-rulings` ear
mid-session (`7d7fe297 -> 861dd4e2`).

PIN : branch `claude/worker1-h1-20260815`, HEAD `5794c195` before this commit — the exact head
AR-1384A inspected.

RESULT : **Stage A COMPLETE. Stage B `BLOCKED_OPERATOR_ACCESS_REQUIRED`. Stage C not started.**
One new architectural finding escalated, not decided.

CHANGED :
- NEW `.../opus-transcript-first-diagnostic/E8-EXTERNAL-DEPENDENCY-RECORD.md` — the three-axis split,
  the typed contract, receipt v2 fields, the seven ownership questions, Stage B outcome, finding 8a.
- MOD `.../E8-SOURCE-COMPLETENESS-REFUSAL.md` — supersession banner,
  `SUSPENDED_PENDING_EXTERNAL_DEPENDENCY_PREFLIGHT`. Body preserved verbatim as history.
- MOD `.../visual-intelligence-e8-round1/E8Wg6tFPYjo/vi_findings.md` — VI-E8-3 verdict corrected in
  place, measurement retained, inference struck.
- MOD `.../E8Wg6tFPYjo/vi_task.json` — `vi_e8_3a_semantic_dependency`, `vi_e8_3b_provider_access`,
  `native_reimplementation_status` as separate keys; correction record.
- NEW `scripts/_worker_vi_e8_generate_magnifications.py` — now the ONLY writer of artifacts.
- MOD `scripts/_worker_vi_e8_final_frame_proof.py` — read-only, **enforced** by an in-module guard.
- MOD `scripts/_worker_vi_e8_hash_manifest.py` — dual identity: portable PIXELS + local BYTES.
- NEW `scripts/_worker_vi_e8_reproducibility_test.py` — five arms, two of them controls.
- NEW 2 artifacts (`zoom_vi3_cp_panel_premium.png`, `..._discount.png`); manifest now 34.
- MOD `docs/replay-results/CURRENT_STATE.md`.

---

## 1. I ACCEPT THE CORRECTION, AND THE MECHANISM IS WORSE THAN "WRONG ANSWER"

AR-1384A is right and the operator caught it. **I measured chart navigation when the question was
computation ownership.**

The 236-tile scan is a true measurement with a working positive control. But *"the visible chart
stayed on 15m"* **cannot discriminate** between:

```
H1  no 4H information exists                              <- what I concluded
H2  a component overlays 4H information onto the 15m chart <- what is true
```

Under H2, the absence of a chart switch is exactly what you would *expect to see*. **My evidence was
equally consistent with both hypotheses and I reported it as though it settled one.**

★ **`A PERFECT MEASUREMENT OF THE WRONG DISCRIMINATOR IS STILL A FALSE FINDING — AND IT IS MORE
DANGEROUS THAN A SLOPPY ONE, BECAUSE THE RIGOUR IS REAL AND TRANSFERS ITS CREDIBILITY TO THE
CONCLUSION.`** I put 236 samples and a positive control behind a claim the samples could not support.

**And the disconfirming evidence was already in my own committed artifacts.** `vi_findings.md`
literally says the frames *"show only the Currency Pros panel's categorical verdict badge — `4H |
Premium`"*. **I quoted the answer and filed it as proof of absence.** That is the third time in four
reports (AR-1391 null-without-control, AR-1392 mid-drag frame, this) that I failed to test the
boundary of my own observation. The pattern is not carelessness in measurement — every measurement
was sound. It is **not asking what else my result would look like if I were wrong.**

Re-inspected independently this session at higher magnification, the panel is not a "badge" at all —
it is a **structured decision surface**: `[TF]` / `4H → Premium` (red) or `4H → Discount` (teal),
above the strategy's own checklist rows (`HTF Alignment`, `Liquidity Sweep`, `BOS + Imbalance`,
`71% Retracement`) and a numeric `Trade Score`. Committed as
`zoom_vi3_cp_panel_premium.png` / `zoom_vi3_cp_panel_discount.png`.

---

## 2. STAGE A — ITEMS 1–4

### Items 1–3: history preserved, verdict split three ways

`AR-1393` and the refusal body are **untouched as history**. The refusal carries a supersession
banner and is `SUSPENDED_PENDING_EXTERNAL_DEPENDENCY_PREFLIGHT`, explicitly **not authority**.

| Axis | Status |
|---|---|
| `VI-E8-3A` semantics | ✅ `MULTIMODAL_RESOLVED` — external provider, 4H decision on a 15m chart, PREMIUM ⇒ SHORT_ONLY / DISCOUNT ⇒ LONG_ONLY / UNKNOWN ⇒ NO_TRADE |
| `VI-E8-3B` access + replay | ⏳ `EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED` — **nonterminal** |
| native reimplementation | ❌ `SOURCE_INCOMPLETE_FOR_NATIVE_REIMPLEMENTATION` — retained; blocks a native rebuild only |

The typed dependency contract, receipt v2 fields, and all **seven** section-6.5 ownership questions
are recorded in `E8-EXTERNAL-DEPENDENCY-RECORD.md`. **Recorded, not wired** — AR-1384A section 10
puts the graph change in Stage C.

⚖️ **One thing I did NOT take on faith:** the contract's `condition_ref: "entry_sequence[1]"` is
carried verbatim from the ruling and is **flagged provisional**. I did not validate it against the
rejected candidate's actual indexing — that candidate is under lock, and its ordering is itself the
HIGH A direction-splice defect. Binding an index inherited from an artifact known to be mis-ordered
would be exactly the kind of quiet error this packet exists to stop.

### Item 4: the mutating-proof defect, repaired and red-proofed

RED — the design defect, reproducible in **every** environment:
`_worker_vi_e8_final_frame_proof.py` wrote five committed PNGs as a side effect of running the proof.

⚠️ **I could not reproduce GPT's byte-divergence locally** (Pillow 12.2.0 here vs 12.3.0 there; my
regeneration stayed byte-identical and the tree stayed clean). **I accept the finding on GPT's
measurement and do not claim to have confirmed that half.** The *design* half I confirmed directly,
and it is the load-bearing one: a proof that rewrites the evidence it is proving cannot fail in the
one way that matters. The Pillow difference only made a pre-existing defect visible.

REPAIR — separation plus two identities:
```
_worker_vi_e8_final_frame_proof.py          READS.  In-module guard aborts on any mutation.
_worker_vi_e8_generate_magnifications.py    WRITES. The only writer.
manifest: PIXELS = sha256(decoded RGB + dims)   CONTENT identity, PORTABLE   <- the claim
          BYTES  = sha256(encoded file)         EXACT-FILE identity, LOCAL   <- recorded only
```

GREEN — `python scripts/_worker_vi_e8_reproducibility_test.py`, five arms:
```
ARM A  READ-ONLY      proof exit 0; fingerprint before == after            PASS
ARM B  REPRODUCIBLE   all 7 magnifications match by decoded pixels          PASS
ARM C  MANIFEST       34 artifacts match by BOTH pixels and bytes           PASS
ARM D  MUTATION BITES one-pixel change -> exit 1, "PIXELS DIFFER"           PASS
ARM E  GUARD BITES    a copy of the proof with a write reintroduced
                      refuses itself: exit 1, "READ-ONLY VIOLATION"         PASS
ALL FIVE ARMS HOLD.
```

**Arms D and E are controls, and E exists because I nearly shipped a vacuous A.** Arm A is computed
by the test itself, so it is sound — but the proof script *also* carries its own guard, and a guard
that has never fired is not an instrument. Without E, a broken guard would sit green forever behind
an A that passes for the unrelated reason that the script happens not to write.

🛑 **CLAIM WITHDRAWN:** AR-1393 said "determinism proven — byte-identical across reruns." That proved
**idempotence in one environment** and I reported it as **reproducibility**. The honest claim is
pixel-level reproducibility plus environment-local byte stability, and the manifest now labels the
two separately so neither borrows the other's authority.

---

## 3. STAGE B — `BLOCKED_OPERATOR_ACCESS_REQUIRED`

The section 7 preflight **did not run**. Its precondition is the operator already holding lawful
Currency Pros access in the normal TradingView UI.

Asked directly. Answer, verbatim: **"we using topstep x"** — not a yes. Per section 10 item 6 the
authorized outcome is a clean stop. **No purchase, no vendor contact, no credential request, no
access workaround was attempted.**

⚖️ **Stated precisely:** the operator answered a *different* question than the one asked — he named
the platform rather than confirming or denying access. This is recorded as **unconfirmed**, not as
"he lacks it." One word unblocks the preflight and nothing in this packet would need redoing. The
exact 10-step UI evidence list is preserved in the dependency record.

---

## 4. 🛑 NEW FINDING — THE INTEGRATION'S PLATFORM IS NOT THE EXECUTION PLATFORM

Surfaced by that answer, then **measured** rather than relayed (`[order-premise-grade]`).

| Grade | Fact |
|---|---|
| `RELAYED` | Operator: "we using topstep x" |
| `MEASURED HERE` | `src/server/services/broker-router.ts:5-6` — *"Today only the TradersPost path actually fires; TopstepX returns a clear `not configured` stub."* |
| `ARTIFACT-SOURCED` | `CLAUDE.md` §6/§7 — Topstep platform is **TopstepX ONLY**; Topstep routes TopstepX direct, **no TradersPost**. |
| `ARTIFACT-SOURCED` | `CLAUDE.md` §8 — TradingView → TradersPost is the **family/external Pine** workflow; TradingView is *"the bot's eye"*, **not** the live path for the full strategy. |

AR-1384A section 8 designs ingestion as **TradingView alert → webhook → `/api/external-indicator/state`**.
That is a *decision-input* path, not order routing, so it is **not** directly blocked by TopstepX
execution — the two can coexist. **But as designed, every E8 trade's direction gate would depend at
runtime on a third-party paid indicator, hosted on a platform the architecture deliberately keeps
out of live Topstep execution, over a live alert path whose failure mode must be NO_TRADE.**

⚖️ **Escalated, not decided** — architecture and money-path scope is GPT's (0-CTRL.6). Three routes,
laid out in the record: **(a)** accept the dependency with fail-closed delivery; **(b)** treat E8 as
a **calibration/compiler-fidelity** source only, proving the compiler can represent an
external-decision dependency without E8 becoming a live strategy; **(c)** require a native
implementation, which the source does not supply and no one may invent.

★ **(b) costs nothing and is not blocked by the access question at all.** The durable value E8 has
already produced is that it forced the typed external-dependency contract into existence — and that
contract stands whether or not Currency Pros is ever reachable.

---

FINDINGS :

- **Against myself, the pattern named:** three reports in four with sound measurements and untested
  observational boundaries (AR-1391 null without a positive control on the searched surface;
  AR-1392 semantic conclusion from a mid-action frame; AR-1393 absence claim from a
  non-discriminating measurement). Each was caught by someone else — operator, GPT, operator. **My
  self-checks catch arithmetic; they do not catch framing.** Arm E above is the first control I have
  written specifically against a *guard* rather than against a number.
- **GPT's byte-divergence finding is accepted but NOT independently reproduced here** (Pillow
  12.2.0 vs 12.3.0). Labelled as such rather than absorbed into the green.
- **`condition_ref` provisional**, per §2 — not validated against a locked, known-mis-ordered
  candidate.
- **`VI-E8-3B` carries one explicitly-labelled UNVERIFIED hypothesis** — that the panel renders via
  Pine `table.*`, whose cells are drawings rather than plots and so are absent from Data Window,
  plot-based alert placeholders, and chart export. **Recorded as measurable, NOT as a result.**
  Settling a capability question by appearance would repeat the exact error this packet corrects.
- **AR-1393's reproducibility claim withdrawn** and replaced with a scoped one.
- **Peer handshake NOT performed** — operator stated worker-2 is closed and directed this seat to
  continue. `messaging_startup_verified=false`. Disclosed, not papered over.
- **Section 9's corpus census NOT run.** AR-1384A section 9.4 places it *after* E8 passes the birth
  test; the birth tests are Stage C and Stage C is gated. Not started, not forgotten.

STOP : **Stage B stopped exactly where the ruling says to stop.** No purchase, no vendor contact, no
credential collection, no access bypass, no OCR adapter, no invented 4H selector, no Round-4
authoring, no compile/backtest/certification/promotion, no external state near broker execution.
All section 11 locks observed.

GRADER : not dispatched — AR-1384A section 10 says "No self-grade" and orders no grade. Stage A's
claims are reproducible by one command (`_worker_vi_e8_reproducibility_test.py`, five arms).

NEXT : **GPT's decision on the routing question in section 4** — specifically whether Stage C's
compiler work should proceed under route (b) regardless of the access answer, since the typed
dependency contract, receipt v2 fields, and the section 6.4 extraction lint are independent of
whether Currency Pros is ever reachable. **Secondarily, the operator's one-word answer on Currency
Pros access**, which unblocks the section 7 preflight.
