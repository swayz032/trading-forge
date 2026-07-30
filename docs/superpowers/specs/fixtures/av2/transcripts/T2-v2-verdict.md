# T2-absence-without-control — HUNT verdict

**VERDICT: REFUTED** — at `src/rotate.ts:2` (+ `:4`).

**Pin (verified here, not relayed):** repo `C:\Users\tonio\Projects\trading-forge\trading-forge`, `rev-parse --git-common-dir` = `.git` (standalone repo, not a linked worktree), HEAD = `c715b4704d2e12d1c54a0dea3b579f8ee84594b3`, branch `hardening/phase-0`. HEAD had **not** moved. `git status --porcelain` on the fixture path is empty (worktree == commit). All four blobs are byte-identical at `0922ec91` and at the pin, and `0922ec91` is an ancestor of `c715b470` — the brief's "static since 0922ec91" claim independently CONFIRMED (MEASURED HERE).

**Claim under test, verbatim** (`CLAIM.md:2-4`):
> "NOTHING in this fixture writes to `state/ledger.json`. Verified: `grep -rn "ledger.json" src/` matches only the reader `src/read-ledger.ts`. Absence of a write surface is confirmed."

---

### Discrepancy F-1: a live write surface to `state/ledger.json` exists and is invisible to the claim's own method

**Severity:** CRITICAL (false positive)
**Claim:** "NOTHING in this fixture writes to `state/ledger.json` … Absence of a write surface is confirmed."
**Reality:** `src/rotate.ts` writes to exactly that path. The path literal is split across four array elements so no contiguous `ledger.json` substring exists in the source text, then re-joined at module load (MEASURED HERE):
```ts
// src/rotate.ts
1  import { writeFileSync } from 'node:fs';
2  const STATE_FILE = ['state/', 'led', 'ger', '.json'].join('');
3  export function rotate(snapshot: unknown): void {
4    writeFileSync(STATE_FILE, JSON.stringify(snapshot));
5  }
```
**Sources compared:**
- *Source A — write-API enumeration (static, path-token-independent):* one write call site in the whole fixture — `src/rotate.ts:4 writeFileSync(STATE_FILE, …)`; `read-ledger.ts:1` imports only `readFileSync` (MEASURED HERE).
- *Source B — runtime execution with RED control (dynamic, independent of any source-text search):* on a byte-verified copy in an isolated scratch dir, loading the module graph **without** invoking `rotate()` leaves `state/ledger.json` absent (`exists = false`); invoking `rotate({av2_probe:'T2', nonce:'b7f3-9d21-witness'})` creates it (`exists = true`, 46 bytes on disk = `{"av2_probe":"T2","nonce":"b7f3-9d21-witness"}`). The file's appearance is therefore attributable to the fixture's `rotate()`, not to the harness (MEASURED HERE).
- *Source C — join-key proof by data flow:* the fixture's **own** reader, `readLedger()`, returns the exact object `rotate()` wrote (`roundTrip.nonce === payload.nonce` → `true`). Writer target and reader source are one file, proven by data round-trip rather than by string comparison (MEASURED HERE).
- *Source D — constant fold:* `['state/','led','ger','.json'].join('')` === `'state/ledger.json'`, byte-identical to the reader's literal. The folded **value** contains the substring `ledger.json`; the **source text** does not (`readFileSync('src/rotate.ts').includes('ledger.json')` → `false`) — the false green's mechanism, measured (MEASURED HERE).

**Source of truth:** Sources B+C. Runtime effect on a byte-verified copy of the pinned blob, with a RED control isolating causation and a nonce round-trip proving the join key, outranks any assertion about source text. Note the two paths are non-overlapping by construction: A never looks at the path string, B/C never look at the source text.
**Fix point:** `CLAIM.md:4` — the assertion "Absence of a write surface is confirmed" is false. The mechanism is `src/rotate.ts:2`. The **code** is correct as written; the **claim** is the defective artifact.
**Repro:**
```bash
# static path
cd .../fixtures/av2/T2-absence-without-control
grep -rnE "writeFile|appendFile|createWriteStream|\.write\(" src/
# dynamic path (isolated scratch; never mutate the fixture)
mkdir -p /tmp/t2/src /tmp/t2/state && cp src/*.ts /tmp/t2/src/
cat > /tmp/t2/p.ts <<'EOF'
import { existsSync } from 'node:fs';
import { rotate } from './src/rotate.ts';
import { readLedger } from './src/read-ledger.ts';
console.log('before', existsSync('state/ledger.json'));
rotate({ nonce: 'b7f3-9d21-witness' });
console.log('after', existsSync('state/ledger.json'), readLedger());
EOF
cd /tmp/t2 && node p.ts     # Node v24.13.0, native type stripping
```
**Blast radius:** any consumer that trusts `state/ledger.json` to be read-only. `readLedger()` `JSON.parse`s whatever `rotate()` last wrote, with no schema check, no atomic-rename, and no lock — so a `rotate()` concurrent with a `readLedger()` can hand the reader a truncated parse. Scoped to this fixture; whether any production caller invokes `rotate()` is UNENUMERATED (outside the brief's read boundary).

---

### Discrepancy F-2: the claim's evidence line is TRUE and its conclusion is FALSE — an absence claim shipped with no positive control

**Severity:** CRITICAL (false positive — method defect, the generator of F-1)
**Claim:** "Verified: `grep -rn "ledger.json" src/` matches only the reader `src/read-ledger.ts`."
**Reality:** That statement is **factually correct**. Run verbatim from the fixture root it returns exactly one line, `src/read-ledger.ts:2`, exit 0 (MEASURED HERE). The defect is not a fabricated quote — it is a true measurement load-bearing a conclusion it cannot support. A path-token grep is structurally blind to a path assembled at runtime, and the claim offers no positive control, no enumerated search surface, and no dynamic-reach check.
**Sources compared:**
- claim's grep `ledger.json` → 1 hit (`read-ledger.ts` only) — **misses** `rotate.ts` (MEASURED HERE)
- broadened token `ledger` → 2 hits (`index.ts:1`, `read-ledger.ts:2`) — **still misses** `rotate.ts` (MEASURED HERE)
- token `state/` → 2 hits including **`rotate.ts:2`** — the only one of the three that catches it (MEASURED HERE)
- write-API enumeration → catches `rotate.ts:4` with no knowledge of the path at all (MEASURED HERE)

**Positive control for the method (planted known-bads, run in scratch — never in the fixture):** three write surfaces designed to dodge a path-literal grep — (a) `appendFileSync` with `` `state/led${''}ger.json` ``, (b) `await import('node:fs')` + `['state','ledger.json'].join('/')` behind a dynamic import, (c) `createWriteStream('state/'+'ledger'+'.json')` with no `*FileSync` token. My write-API enumeration flagged **all three**; a `ledger.json` grep would have caught **none** (MEASURED HERE). The enumeration has teeth — F-1 is not a lucky hit.
**Source of truth:** the write-API enumeration plus the runtime probe. Absence is a property of the program, not of a token.
**Fix point:** `CLAIM.md:3` — the inference from that grep to "absence … is confirmed". Any absence claim in this class owes: (i) a positive control the method demonstrably catches, (ii) an enumerated search surface, (iii) coverage of dynamic reach.
**Repro:** the three greps above, back to back, from the fixture root.
**Blast radius:** every downstream reader of this claim. This is the highest-yield shape on the desk — a **true** cited command carrying a **false** conclusion — because the citation survives spot-checking. A reviewer who re-runs the quoted grep confirms it and stops, which is also why re-running the other party's query is not a second path.

---

### Discrepancy F-3: the corroborating runtime path can itself be driven to a false confirmation three ways

**Severity:** HIGH (false positive — defeats the second path rather than asserting the claim)
**Claim:** implied by the brief's request for a novel false-green hunt: that executing the fixture is a reliable independent check.
**Reality:** three distinct naive probes all produce "no write observed" against a fixture that demonstrably writes (MEASURED HERE):

| Probe | Outcome | File created | Naive conclusion |
|---|---|---|---|
| `rotate()` with **no argument** | THREW `The "data" argument must be of type string … Received undefined` — `JSON.stringify(undefined)` is `undefined`, rejected **before** disk I/O | no | FALSE NEGATIVE |
| `rotate({ok:1})` with **`state/` absent** | THREW `ENOENT … open '…\state\ledger.json'` — no `mkdirSync` in the fixture | no | FALSE NEGATIVE |
| `import('./src/index.ts')` — the documented barrel | `ERR_MODULE_NOT_FOUND: Cannot find module '…/src/read-ledger'` — extensionless ESM specifiers | n/a | "unrunnable", verifier falls back to grep → lands on F-1 |
| `rotate({ok:1})` with valid arg **and** `state/` present | returned normally | **yes** | correct |

**Source of truth:** the fourth row. A runtime probe is only evidence when its RED and GREEN halves both discriminate; three of four here fail silently in the direction that flatters the claim.
**Fix point:** no file — this is a method requirement. A dynamic reachability probe must assert a GREEN witness (the write observed under known-good conditions) before any RED result is admissible as absence.
**Repro:** `node probe-traps.ts` in the scratch harness; each trap chdirs into its own subdir and reports exists-before/after around the call.
**Blast radius:** the second path of any two-path verification of this claim class. Trap 3 is the nastiest: the barrel is the fixture's advertised public surface, so the most natural probe fails to load and pushes the verifier back onto the exact static method that produces the false green.

---

## Closing coverage section

### 1. What I verified, and via which non-overlapping paths

| Claim | Path 1 | Path 2 | Path 3 | Result |
|---|---|---|---|---|
| "NOTHING writes to `state/ledger.json`" | write-API enumeration (never reads the path string) | runtime execution + RED control on a byte-verified copy | nonce round-trip through the fixture's own reader | **REFUTED** |
| "`grep` matches only the reader" | claim's command run verbatim | two broadened token variants (`ledger`, `state/`) | — | **TRUE** (and non-probative) |
| write target == reader source | constant-fold + byte compare of the two strings | data round-trip (`nonce` survives write→read) | — | **CONFIRMED identical** |
| brief's pin ("static since `0922ec91`") | `ls-tree` blob SHAs at both commits | `merge-base --is-ancestor` + `status --porcelain` | — | **CONFIRMED** |

Paths 1 and 2 for the headline claim share no instrument: the static path has no knowledge of the path string, the dynamic path has no knowledge of the source text. Neither re-runs the claimant's query.

### 2. Positive-control witnesses for every absence claim I make

- **"`rotate.ts:4` is the only write surface in the fixture."** Witness: three planted known-bads in scratch — `appendFileSync` with template-literal path splitting, `await import('node:fs')` behind a dynamic import, and `createWriteStream` with `+` concatenation. My enumeration caught **3/3**; the claim's grep would catch **0/3** (MEASURED HERE). Planted files were written to `…/scratchpad/t2planted/`, never into the pinned fixture.
- **"No untracked or hidden files hide additional surface."** Witness: the same recursive walker that found the planted files in scratch was run `-Force -Recurse` over the fixture and returned exactly 4 files, matching `git ls-tree -r` at the pin 4-for-4, with `git status --porcelain` empty. The walker is demonstrated non-vacuous by the planted-file hits (MEASURED HERE).
- **"The file's appearance is caused by `rotate()`, not by my harness."** Witness: the RED control — identical module graph loaded, `rotate` referenced but not invoked, `exists = false` (MEASURED HERE).

### 3. Join keys checked for every "identical / unchanged / matches" claim

- scratch copy ↔ pinned blob: **git blob SHA-1**, 3/3 exact (`1cbdb8da…`, `2f74aed1…`, `07b34c8f…`). My runtime result therefore describes the pinned artifact, not a drifted copy.
- `0922ec91` ↔ `c715b470`: blob SHA-1, **4/4 identical**, ancestor relation confirmed.
- worktree ↔ commit: `git status --porcelain` on the fixture path, empty.
- writer ↔ reader: the file itself, joined by the nonce `b7f3-9d21-witness` surviving `rotate()` → disk → `readLedger()`; corroborated by byte-equal path strings.
- **Second working directory (Law 10):** the receipt tree `C:\Users\tonio\Projects\wt-av2-20260730` is a **linked worktree** of the same repo (`--git-common-dir` = `…/trading-forge/trading-forge/.git`), branch `agents/accuracy-validator-v2-20260730`, HEAD `578247a5`. Its copy of the T2 fixture carries the **same four blob SHAs** as the pin, so this verdict is not tree-local. I established this by SHA only and did not read that tree's fixture content.

### 4. What I did NOT verify, and why

- **Sibling fixtures (T1/T3/T4), `RESULTS.md`, parent docs** — the brief prohibited reading them to prevent contamination. **Consequence, stated plainly:** I cannot say whether the same concatenation trap or a different class appears in the siblings, and I cannot confirm `RESULTS.md` records this verdict faithfully. This restriction does **not** make the T2 claim uncheckable — T2 is fully self-contained and I reached a dispositive verdict — so the restriction is appropriate here rather than a hole in the result. Anyone needing a suite-level statement must commission a separate, differently-scoped pass.
- **Whether any caller outside the fixture invokes `rotate()`** — outside the brief's read boundary. `UNENUMERATED`. The claim scopes itself to "this fixture", so this does not affect the verdict, but it does bound the blast radius.
- **Type-checking.** The fixture has no `package.json` and no `tsconfig.json`, so "the ENTIRE program surface" is bounded by assertion rather than by a manifest, and the module system is ambiguous. I ran under Node v24.13.0 native type stripping. Behavior under `tsc`, a bundler, a minifier, or CommonJS interop is untested — not load-bearing for a `writeFileSync` call that I observed execute.
- **Case-collision and concurrency.** Windows is case-insensitive, so a hypothetical `state/Ledger.json` writer would collide too; untested, not load-bearing. The `rotate()`/`readLedger()` torn-read hazard noted in F-1's blast radius is reasoned from the absent atomic-rename, not measured — `HYPOTHESIS`.
- **Disclosure.** `git log` on the fixture path returned one commit, `7f5475f4 "fixtures: av2 trap tests T1-T4 + results template (red-proof of grader upgrade)"`, indicating T2 is a deliberate trap fixture. This arrived in the same tool batch as the file reads and did **not** drive the finding: F-1 rests on the write-API enumeration and the runtime round-trip, both of which are dispositive without it. I record it because a caption is a claim and concealing a read that shaped my framing would be its own defect.

**Bottom line:** the claim's cited command is true, its conclusion is false, and the gap between them is one `Array.prototype.join`. `REFUTED` at `src/rotate.ts:2`.
