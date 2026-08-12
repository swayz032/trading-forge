# ACCEPT-5 ISOLATED EXECUTION ARCHITECTURE — PROMOTION RECORD

**Date:** 2026-08-12 · **Tree:** `wt-h1-wave4-20260712` · **Branch:** `h1-wave4-sealed12-driver`
**Authorized by:** GPT external advisor ruling on `AR-1014` (2026-08-11), §3 — *"Worker is
authorized to perform the already-planned ISOLATED ACCEPT-5 ARCHITECTURE PROMOTION. This should be
mechanical."*

---

## 1. WHAT WAS PROMOTED

`scripts/accept5_isolated_runner.py` — one pytest subprocess per governed file — ceases to be a
PROTOTYPE and becomes the **ACCEPT-5 EXECUTION AUTHORITY**.

Prior status, `[MEASURED HERE]` at its own `:3`–`:4` before this change:

> `PROTOTYPE. The committed acceptance_runner.py is untouched and remains the authority until
> obligations [A]-[J] are proven (R-821 §5).`

`R-821 §5` set the gate: *"Prototype → prove `[A]`–`[J]` → only then promote to authority."*
`R-826 §5` set the sequence: `1 RATIFY-1 passes → 2 promote the isolated architecture →
3 execute R3-4 CLUSTER-E → …`. Both preconditions are now satisfied.

## 2. THE AUTHORITY EVIDENCE THIS PROMOTION RESTS ON

| Artifact | SHA | Status |
|---|---|---|
| Execution pin (arms `GA`–`GE`) | `f4e9a9d2` | `[MEASURED HERE]` resolves; on `origin/h1-wave4-sealed12-driver` |
| Live independent certification, band 8 | `cb2c5bb0` | `[MEASURED HERE]` resolves; on origin |
| Branch landing head + SYSTEM-INVENTORY regen | `6f6b0ec7` | `[MEASURED HERE]` resolves; on origin |
| `AR-1014` durability close | `e3fad69d` | `[MEASURED HERE]` resolves; on origin; `origin..HEAD` = `0` |
| DEMOTED comparator | `1155e270` | resolves; **diagnostic only, not consulted** |

The certification is `docs/designs/GRADE-RATIFY1-LIVE-2026-08-12.md` — a live independent grade in
which the grader **executed the five arms in its own processes** rather than auditing a claim about
them: `108` children · `2419` observed nodes per arm · `0` missing / invented / unmapped /
duplicate · all `10` pairwise comparisons `0` exact node→outcome differences · the `33`-node
failure set identical across all five **by exact node ID**.

🛑 **It is `PASS — BOUNDED`, band 8, and the bounds are part of the record, not a footnote:** the
expected `2419`-key set comes from a **single authority** (`population_successor`) and is therefore
unverifiable by that grade; tree stability was sampled at arm boundaries only; and **the `33` were
NOT adjudicated — this certifies EXECUTION IDENTITY, NOT TREE HEALTH.**

## 3. WHAT THIS PROMOTION CHANGED — THE COMPLETE LIST

**Two files. One is a docstring; the other is this record.**

1. `scripts/accept5_isolated_runner.py` — module docstring only: authority declaration replaces the
   prototype caveat, and carries the standing condition in §5 below.
2. `docs/designs/ACCEPT5-ISOLATION-PROMOTION-2026-08-12.md` — this file.

**NOT changed, and each verified against the GPT §4 stop list:**

- governed execution semantics — **no executable line touched** in the runner or anywhere else
- child population — `accept5_isolated_population.py` untouched; it still imports
  `acceptance_runner` as *"the ONLY manifest authority"*; **no second population registry**
- file / node ordering — untouched
- isolation behaviour — the plugin `accept5_isolation_plugin.py` is untouched
- compiler / trading logic / production engine — untouched
- the RATIFY authority path — unchanged; the demoted comparator stays demoted
- `scripts/acceptance_runner.py` — **UNCHANGED**, still imported at `:54` as the manifest authority

`[MEASURED HERE]` there is **no configuration, CI workflow, or manifest that selects which runner
is canonical** — a repo-wide search for `isolated_runner` across `*.yml`/`*.yaml`/`*.cfg`/`*.toml`/
`*.json` returns nothing outside replay artifacts, and `acceptance_runner` has **zero CI-workflow
callers**. **Promotion therefore cannot be, and is not, a wiring change — it is a declaration.**
The isolated *canonical ACCEPT-5 authority run* is a later, separate step (`R-826 §5`, item 7),
after `CLUSTER-E`, the census and the successor seal.

## 4. WHAT IS EXPLICITLY NOT CLAIMED

- **`RATIFY-1` is not re-certified here.** No band is issued by this document or by the worker.
- **No grader was dispatched for the promotion** — GPT §3: *"Do NOT dispatch another grader merely
  because promotion occurred."*
- **The `33` are untouched and unadjudicated.** The post-`CLUSTER-E` map is not assumed to still
  contain exactly `33`; it will be measured.
- **`F-R4-1`..`F-R4-7` are not repaired.** They remain OPEN against the demoted diagnostic and are
  non-blocking per the ruling.

## 5. 🛑 THE STANDING CONDITION — WHAT REOPENS THE BLOCKER

`ACCEPT5-AGGREGATE-PROVENANCE-1` (banked `R-826 §3` as **HIGH, PROMOTION BLOCKER**) is, per the GPT
ruling §1:

> **DISCHARGED AS MOOT FOR PROMOTION BY REMOVAL OF THE DEFECTIVE COMPARATOR FROM THE CERTIFICATION
> AUTHORITY PATH — IT IS NOT "FIXED."**

The discharge is conditional. It **reopens immediately** if `scripts/ratify1_controls/
g_order_identity.py` is:

- wired into CI, or
- wired into ACCEPT-5 promotion, or
- made a gate by its exit code, or
- treated as authoritative through its `CERTIFIED` output, or
- restored as RATIFY authority via its aggregate/provenance chain.

The basis for the discharge is the authority-use census in `AR-1013`: `g_order_identity` appears in
`9` files — `8` docs/grade receipts plus its own control harness — with `0` in `runtime-production`,
`0` in the main repo, and `0` across all `8` CI workflow files in three trees.

⚠️ **THIS CONDITION IS RECORDED, NOT ENFORCED BY CODE.** No guard prevents a future seat from wiring
the demoted comparator back in; nothing would go RED if it did. Building such a guard is
**explicitly out of scope** under the same ruling's §8 token-conservation order (zero further spend
on RATIFY verifier work). **A condition with no detector is a condition that decays silently** — it
is flagged here so the next seat inherits the gap as a known one rather than discovering it.

## 6. NEXT

`R3-4 CLUSTER-E`, per GPT §5 — measure the exact sample files the governed row actually consumes;
make only that subset durable; positive control (remove a consumed sample ⇒ governed test MUST RED)
and negative control (remove an unconsumed candidate ⇒ governed result MUST NOT change).
