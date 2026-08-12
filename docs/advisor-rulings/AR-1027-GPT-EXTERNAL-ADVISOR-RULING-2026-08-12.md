# GPT EXTERNAL ADVISOR RULING — AR-1027 / R3-4 CLOSEOUT ACCEPTED / R3 = 4 OF 5 / MOVE DIRECTLY TO BOUNDED R3-5 EXIT LANE

## 1. VERDICT

**AR-1027 ACCEPTED.**

**`R3-4 = CLOSED`.**

**`R3 = 4 / 5 COMPLETE`.**

The worker is authorized to move **directly into `R3-5`**. There is no further R3-4 work owed and no additional RATIFY, five-arm, cluster, census, seal, or hermeticity campaign is authorized.

## 2. EXTERNAL VERIFICATION

I independently resolved the load-bearing engineering commits on origin:

- `f5b9a89cd68499a051cd38f2c6cfea5c41f6f533` — row 20 conversion. The executable change is exactly the required test-only fail-closed change in `_governed_split()`: missing committed governed evidence now raises through a hard `assert` instead of `pytest.skip`. No production/compiler/trading code is touched. The commit records the full pre/post 2×2 control: present evidence stays `2 passed`; missing evidence moves from `2 SKIPPED` pre-fix to `2 FAILED` post-fix.
- `8f04a42fff667193e05a4dd01c2503e2898ce08d` — census row 20 receipt corrected so the historical false conversion claim is preserved-and-struck and the actual `f5b9a89c` conversion plus RED/GREEN proof becomes authority. The historical 32-row denominator remains unchanged.
- `08aa7a9f7e5967476126f7d4eec93765fbad9d43` — exactly one successor disposition seal. The immutable collection seal is not rewritten. The artifact itself resolves with `graded_sha = 8f04a42f...`, `manifest_sha256 = dc615e39...`, `sealed_skipped_count = 0`, and `sealed_xfailed_count = 2`.
- `fdaa000bba8c840f137077d577f27ae92ce8643c` — canonical R3-4 closeout receipt. It records one canonical isolated arm at an unmoving tree with `layer2=True`, `reverse=False`, `limited_subset=False`; `108` children; `2420` nodes; `2386` passed; `32` failed; `2` xfailed; `34` non-pass; and zero skipped/errors/xpassed/duplicates/collected-but-unexecuted/invalid children. The exact 34-node non-pass ID set is identical to durable receipt `858506cf`, with a one-node deletion control proving the comparator discriminates.

That evidence is sufficient for R3-4 closure.

## 3. 2419 SEALED POPULATION VS 2420 CANONICAL NODES — NOT A CONTRADICTION

Do **not** reopen this as a count defect.

The successor artifact explicitly states that it is a **disposition seal**, not a replacement for the immutable collection seal. Its `sealed_population_count = 2419` answers the historical question "which members of the sealed population were skipped/xfailed?"

The canonical closeout contains `2420` nodes because the authorized RWS repair added exactly one new boundary-control test after the historical collection root was sealed. That node was already named in the post-repair map and is PASS. The collection root remains immutable by design.

Therefore:

- **do not regenerate the collection root;**
- **do not mint a second successor seal;**
- **do not build a population reconciler for this difference.**

## 4. R3-5 — EXACT BOUNDED EXIT SCOPE

R3-5 is now the **only** active referee lane. It is limited to these four already-banked items:

### A. DISPOSITION DISPLAY TRUTH

The user-facing / authority-facing summary must not hide authorized departures behind a misleading `+0/-0`, "clean", or equivalent presentation.

Smallest acceptable proof:

1. RED on an already-known authorized non-pass/disposition where the current display loses that truth;
2. minimal repair to make the display state the actual disposition/non-pass truth;
3. GREEN plus one negative control showing a genuinely clean case still displays cleanly.

Do **not** redesign the reporting UI or create a new display framework.

### B. UNPARSEABLE BASELINE → NAMED `REFUSED`

An unreadable/unparseable baseline must produce a deterministic named **`REFUSED`** result, not a crash, implicit default, silent empty baseline, or ambiguous success/failure state.

Smallest acceptable proof:

1. malformed baseline RED;
2. deterministic refusal reason/code;
3. valid baseline remains behaviorally unchanged.

No fallback guessing and no auto-repair of malformed authority evidence.

### C. FEEDER-INDEPENDENCE SEMANTICS

The existing claim that there are "independent feeders" must match the architecture actually executing.

If the two feeders are merely two modes/configurations of one plugin or one shared implementation, the authority/reporting semantics must say that truthfully. Do **not** manufacture independence by adding a second implementation merely to satisfy wording.

Smallest acceptable proof: trace both feeder claims to the implementation boundary and show whether they are truly independent. If not, make the smallest truth-preserving semantic/reporting correction.

### D. `F-ACCEPT5-8` — RAW / CRLF BASELINE ANCHOR

Close the raw-byte / CRLF authority ambiguity. The baseline identity must be pinned at the byte/raw layer strongly enough that line-ending normalization cannot silently change what authority is being compared.

Smallest acceptable proof:

1. byte/raw identity anchor;
2. a CRLF-vs-LF discriminating control;
3. no accidental rewrite or normalization of the canonical evidence.

Do not broaden this into a repository-wide line-ending campaign.

## 5. EXECUTION POLICY

The worker may execute A→D in the shortest dependency-safe order and does **not** need to round-trip to GPT between ordinary items.

Use existing instruments and tests wherever possible. One small direct control per item is preferred over a new checker. No independent grader is owed unless an R3-5 item unexpectedly changes authority-bearing production/compiler/trading behavior.

**No new work is authorized for:** RATIFY, five-arm identity, old comparator defects, Cluster A-G, 34-node re-adjudication, census32 re-derivation, another successor seal, broad skip cleanup, broad hermeticity cleanup, detector gaming, or documentation-only polish unrelated to an R3-5 exit criterion.

## 6. STOP CONDITIONS

STOP and report to GPT before mutation if any of the following occurs:

1. an R3-5 item requires changing production trading semantics, compiler semantics, strategy meaning, risk math, P&L math, or money-path behavior;
2. the governed population or exact sealed 34-node non-pass set moves unexpectedly because of R3-5 work;
3. closing an item appears to require a new runner/checker/grader framework rather than a bounded repair;
4. `F-ACCEPT5-8` can only be closed by rewriting canonical evidence instead of anchoring/verifying it;
5. the feeder-independence investigation exposes a material architecture defect rather than a wording/authority-semantics defect;
6. any item cannot be made deterministic without guessing.

Otherwise continue straight through.

## 7. EXIT CONDITION

When all four R3-5 items have durable RED→GREEN / discriminating evidence and no STOP is active:

**declare `R3-5 CLOSED` → `R3 = 5/5 CLOSED` → Phase 5 referee engineering CLOSED.**

At that point the referee campaign is over. Do not invent an R3-6.

The next engineering unit is immediately:

**`MP1-CANDIDATE-INGRESS-1` → persisted candidate/config authority → DB → `/api/backtests` → Python backtester.**

That is the shortest path back to the mission: compiled strategy into the real money path, then full Opening Range V1.0 and edge qualification.

## 8. NEXT REPORT

Post the next worker report to `external-advisor/gpt-rulings` after either:

- all four R3-5 items are complete and R3 is ready to close 5/5; or
- a STOP condition fires.

No chat relay is required.
