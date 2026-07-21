# GRADE CHARTER — leg-5 S3 capability probe, NOT-SAFE closure (`5778ab4c`)

**Dispatched by:** OPS-campaign ADVISOR (OR-090), 2026-07-20.
**You are:** a fresh-context independent grader. You did NOT write this code, and — critically — **you do NOT trust the author's tests.** One of the defects being closed (MAJOR-4) was a test that passed green having tested nothing. So for every claim below you **construct your OWN adversarial input and execute it**; a passing author-test is not evidence. Band ceiling 7 (pre-live). Secrets in your report: NAMES ONLY, never values, and if you plant a canary secret, use an obviously-fake one.

## Context

The ops-experience agent built a Python+DuckDB S3 "capability probe" — a cold-recovery gate answering *"can this box actually read the data lake?"* (exit 0=PASS / 3=FAIL / 2=UNKNOWN). An independent grade returned **BAND 6 / NOT-SAFE** with 5 MAJORs; the agent closed them in commit **`5778ab4c`** — UNREVIEWED. The headline defect: the probe's `SELECT 1 FROM read_parquet(?)` projected zero columns, so DuckDB answered from parquet **footer metadata without fetching data** → it returned PASS on an object whose data body was zeroed (a *decorative green at the capability layer*, the exact disease the probe exists to detect). The fix claims `SELECT *` now forces column decode.

## Where

- Worktree `C:\Users\tonio\Projects\wt-ops-experience-20260719`, grade AT `5778ab4c` (confirm HEAD; do NOT reset the agent's tree — use a scratch checkout if you must run mutating steps). The agent is holding read-only (collision bar).
- The probe (Python) + its Node driver + tests are the leg-5 unit. Locate them from `git show 5778ab4c --stat` and `git diff 95bd4fca..5778ab4c`.

## The 5 closures — each verified by YOUR OWN executed adversarial input

1. **★ #1 footer-vs-data (was CRITICAL — a PASS on unreadable data).** Construct a parquet with a **valid footer but zeroed/absent data body** yourself (do not reuse the agent's fixture). Run the fixed probe against it. **It MUST NOT return PASS** (FAIL expected). Then confirm a genuinely-good object still PASSes, AND a legitimately **empty (0-row) valid** parquet PASSes (MINOR-2 — an empty lake state is not a failure). If any of these three is wrong, the fix is not closed.
2. **MAJOR-1 exit-code collision.** The old `FAIL=1` collided with Python's uncaught-traceback exit 1, so a probe *crash* reported "lake unreachable" (FAIL). Force the probe to crash (e.g. an uncaught exception before the verdict) and confirm the driver maps it to **UNKNOWN, not FAIL**, and that an unrecognised exit code cannot masquerade as a verdict (allowlist). FAIL should now be 3.
3. **MAJOR-2 driver secret-scrub.** The *driver* (not just the probe) once emitted the raw stderr tail. Drive a failure whose stderr contains a planted fake presigned-URL-with-signature and confirm the driver reports only **whether stderr existed + a byte count**, never the text. Trace every output path (verdict JSON, logs, exception objects, spawn error).
4. **MAJOR-4 the vacuous leak test.** The original leak test passed on Windows only *incidentally* (`spawnSync` injects `USERPROFILE`; POSIX does not inject `HOME`, so `INSTALL httpfs` failed → UNKNOWN → the assertion passed having tested nothing). Confirm the fixed test **requires `reason === "read_failed"`** (i.e. a read actually occurred) and that `HOME`/`USERPROFILE` are set explicitly so the leak path executes on **Linux/POSIX**, not just Windows. If you can, run it under a POSIX shell.
5. **MAJOR-5 no-SET guard defeated by indirection.** The old guard was a literal grep beaten by `con.execute(f"SET {k}='{v}'")`. Confirm the fixed guard asserts the credential **key names appear nowhere in executable code** (catches the indirection variable) AND the secret value is never read — and that the guard strips docstrings/comments so prose *describing* the banned pattern isn't matched as the pattern. Try to defeat it with a fresh indirection you invent.

## Also confirm (do not let these be lost)

- The probe mirrors the ENGINE (`src/engine/data_loader.py`) path: **credentials via env-var auto-read, NOT interpolated into SQL** (only `AWS_REGION` SET, sanitized); one `LIMIT 1` read; `httpfs` + `read_parquet`. This matters because DuckDB parser errors echo SQL verbatim — "no creds in SQL" is a real protection.
- Regression floor, independently re-run with a **discriminating** tsc control (the author's earlier tsc was a stub false-green — assert 0 × "not the tsc command" AND that a planted `const x:number='nope'` is REPORTED): tsc 0, `test:scripts` (report actual count), lint clean.
- Scope note: a capability probe proves *one row is reachable+decodable*, not full-object integrity — do not fault it for not detecting single-column partial corruption; DO fault it if a whole-body-zeroed object PASSes.

## Verdict

Per MAJOR: closed / not-closed, with the adversarial input you ran. Overall band + SAFE-TO-LAND / NOT-SAFE. Note explicitly: the probe has **zero callers today** (wiring is leg-2's job) — grade it as safe-to-LAND, separate from safe-to-WIRE. `file:line` for every finding.
