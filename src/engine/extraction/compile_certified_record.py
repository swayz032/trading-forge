"""SPINE-A — the thin production compile entry point. I/O ONLY, NO SEMANTICS.

Authority: AR-1121 (gpt-rulings `2f497e5f`) §4.A "Thin reachable Python compile
entry", refining AR-1119 §3.1. The authorized shape, verbatim:

    certified record -> canonical Python producer -> .spec.json

WHY THIS MODULE EXISTS — THE DEFECT IT REMOVES
----------------------------------------------
`[MEASURED at d8fa1958]` `produce_spec_artifact_from_record()` calls itself *"the
public production compile boundary"* in its own docstring, and:

  * every one of its callers lives under `src/engine/tests/` — **zero non-test callers**;
  * SYSTEM-INVENTORY reports `src/engine/extraction` as **0 WIRED / 269 BUILT-UNREACHABLE**,
    reason *"defining module is not reachable from any measured entry point"*.

So the canonical producer was a compile boundary that **nothing in production could
invoke**. AR-1118 measured the consequence: the live onboarding route is TypeScript
(`spec-onboarding-service.ts`) reading already-produced `*.spec.json` files, and it
spawns no Python at all. Adding the timeframe-role carrier to the producer without
this module would have added correct code to a path no artifact ever travels.

    ★★★★★ `A DOCSTRING CLAIMING A FUNCTION IS THE PRODUCTION BOUNDARY IS A CLAIM
       ABOUT INTENT. REACHABILITY IS A CLAIM ABOUT THE TREE, AND ONLY ONE OF THEM
       DECIDES WHETHER YOUR CODE RUNS.`

🛑 WHAT THIS MODULE MAY NOT DO — AR-1121 §4.A / AR-1119 §3.1
------------------------------------------------------------
It *"may do I/O and argument parsing"*. It may **NOT** duplicate semantic
classification, opening-range lowering, timeframe-role extraction, hashing, or source
evidence logic. Concretely, this file contains:

  * **no** `spec_hash` computation — the hash is `_spec_hash(spec_body)` inside the
    producer, and re-deriving it here would create a second authority for the
    certified identity;
  * **no** opening-range lowering or candidate fan-out — those ride on the returned
    `RecordCompileResult`, and re-deriving them is exactly the "second calculator"
    R-736 §5-1 settled against;
  * **no** timeframe inference of any kind — not `strategy.timeframe`, not
    "lowest timeframe", not a confidence-0.4 backfill (AR-1121 §4.B's forbidden list
    binds the producer side too);
  * **no** identity invention — see `--video` below.

    `THE ONLY WAY A WRAPPER STAYS A WRAPPER IS IF IT CANNOT ANSWER ANY QUESTION THE
     THING IT WRAPS IS THERE TO ANSWER.`

🛑 IDENTITY IS SUPPLIED AND VALIDATED, NEVER DERIVED (AR-1123 ORDER A2)
-----------------------------------------------------------------------
`--spec-id` and `--strategy-index` are REQUIRED and are never parsed out of the record
filename, even though the corpus convention is `<video>__s<index>.json` and doing so
would be convenient. The producer's own docstring pins the reason (R-776 §4): *"No
stub id, no video id and no duration appears in this function's logic — it reads the
record it is handed."* A wrapper that recovers identity from a filename re-introduces
precisely the inference the producer refuses, one layer up, where nothing audits it.

    `AN IDENTITY PARSED OUT OF A FILENAME IS A GUESS WEARING A PRIMARY KEY.`

**THE ARGUMENT IS THE CANONICAL SPEC STUB, NOT THE BARE SOURCE-VIDEO ID.** This was a
real defect in the first version of this file and GPT caught it before any real compile
(AR-1123 §2). The parameter was called `--video` and its help said *"the source video
id"* — but the canonical producer copies that argument straight into
`artifact["video"]`, and `[MEASURED]` every committed artifact carries the STRATEGY
STUB there (`-igpOZs8LsM__s0`), not a bare video id. Following the old help for sVkm
would have emitted `sVkmZklJDHI.spec.json` with `artifact.video == "sVkmZklJDHI"`,
silently minting a second identity convention at the exact boundary the portable
contract is keyed on. So this entry point now **REFUSES** a bare source-video id, and
**REFUSES** a stub whose `__sN` suffix disagrees with `--strategy-index`.

    ★★★★★ `AN ARGUMENT WHOSE NAME DESCRIBES A DIFFERENT OBJECT THAN ITS VALUE IS A
       DEFECT THAT ONLY FIRES ON THE FIRST REAL RUN — WHICH IS THE RUN THAT MATTERS.`

WHAT MAKES THIS AN ENTRY POINT — AND WHAT DOES **NOT**
-------------------------------------------------------
🛑 **NOT the `__main__` guard, whatever `system_inventory.py` advertises.** Rule **(c)**
of `discover_entry_points` claims to find *"Python modules with an
`if __name__ == \"__main__\"` block"*, but `[MEASURED, AR-1122 §3]` `refs` is built only
from `ast.Name` / `ast.Attribute` nodes and `"__main__"` is an `ast.Constant`, so the
rule has **never fired anywhere in this repo** (its reason string appears 0 times in the
generated inventory, while the other rules fire freely). Building this module on that
rule made the reachability proof FAIL: the module was added as three MORE unreachable
symbols while advertising itself as an entry point. GPT has since authorized a narrow
repair of rule (c) (AR-1123 §3).

✅ **The `package.json` declaration is the explicit operator command for this lane** —
rule **(a)**:

    "compile:certified-record": "python -m src.engine.extraction.compile_certified_record"

⚠️ **AND A CORRECTION I OWE, BECAUSE I PUBLISHED THE WRONG REASON ONCE ALREADY.** While
rule (c) was dead I measured that deleting this one line returned `src/engine/extraction`
to `0 WIRED / 272` and put the producer back in the unreachable table, and I reported
that flip as this module's achievement. **Once rule (c) was repaired (AR-1123 §3), I
re-ran the same ablation and it changes NOTHING** — the module stays `241 WIRED / 33`
and the producer stays reachable, because 81 other runnable modules became visible and
reach it too. **That flip was an artifact of a defective instrument, not a property of
this file.** Both the `__main__` guard and the package.json line are kept — GPT's §3
directs the package script stay as the explicit operator command for this lane — but
**neither is now the sole thing making the producer reachable.**

**WHAT IS STILL TRUE, MEASURED BY GREP AND NOT BY THE INVENTORY:** before this module,
`produce_spec_artifact_from_record` had **ZERO non-test callers** — every reference lived
under `src/engine/tests/`. This module is its **only** non-test caller. That is the real
defect this file closes, and it never depended on the broken rule.

    ★★★★★ `RE-RUN THE MEASUREMENT AFTER REPAIRING THE INSTRUMENT THAT PRODUCED IT.
       A NUMBER CARRIED ACROSS A FIX IS STALE EVEN WHEN THE WORDS AROUND IT ARE FRESH.`
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any, Dict

# THE CANONICAL PRODUCER. This import is the whole point of the module: it is the
# edge that makes `spec_producer` reachable from a measured entry point. The §4.A
# ablation proof deletes this call and requires the golden path to fail.
from src.engine.extraction.spec_producer import produce_spec_artifact_from_record

SPEC_ARTIFACT_SUFFIX = ".spec.json"

#: The canonical spec-stub shape: `<source_video_id>__s<strategy_index>`.
#: `[MEASURED]` this is what `artifact["video"]` holds in every committed artifact and
#: what every loader recovers by stripping `.spec.json`. The video-id half is
#: deliberately permissive (real ids contain `-` and `_`, e.g. `st5e-YJRfKc`); the
#: STRUCTURE is what is enforced, because the structure is what carries the identity.
SPEC_ID_RE = re.compile(r"^(?P<video>.+?)__s(?P<index>\d+)$")


class SpecIdentityError(ValueError):
    """The supplied `--spec-id` is not a canonical stub, or contradicts the index.

    A distinct type because this refusal is an IDENTITY refusal, not an I/O failure,
    and a caller that catches it must not confuse the two.
    """


def parse_spec_id(spec_id: str, strategy_index: int) -> str:
    """Validate the canonical spec stub against the strategy index. Never repair it.

    Refuses (AR-1123 §2 required red proofs 1 and 2):
      * a bare source-video id with no `__sN` suffix — that is the defect that would
        have minted `sVkmZklJDHI.spec.json`;
      * a stub whose `__sN` disagrees with `--strategy-index` — two answers to one
        question, and picking one silently is how the wrong strategy gets certified
        under the right name.

    Returns the spec id UNCHANGED on success. It does not normalise, pad or rewrite:
    the caller supplies the identity, the wrapper only agrees or refuses.
    """
    match = SPEC_ID_RE.match(spec_id or "")
    if match is None:
        raise SpecIdentityError(
            f"--spec-id {spec_id!r} is not a canonical spec stub. This entry point "
            "requires `<video_id>__s<strategy_index>` (e.g. 'sVkmZklJDHI__s0'), NOT a "
            "bare source-video id: the producer copies this value straight into "
            "artifact['video'], and every committed artifact carries the strategy stub "
            "there. Accepting a bare video id would mint a second identity convention "
            "at the portable contract's key."
        )
    declared = int(match.group("index"))
    if declared != strategy_index:
        raise SpecIdentityError(
            f"--spec-id {spec_id!r} declares strategy index {declared} but "
            f"--strategy-index is {strategy_index}. Refusing rather than choosing: a "
            "stub that disagrees with the index it is compiled at would publish one "
            "strategy's output under another strategy's identity."
        )
    return spec_id


def _load_record(path: str) -> Dict[str, Any]:
    """Read the certified record JSON. Fail closed and by name."""
    if not os.path.isfile(path):
        raise FileNotFoundError(
            f"certified record not found: {path!r}. This entry point compiles a "
            "record that already exists; it does not extract, certify or author one."
        )
    with open(path, "r", encoding="utf-8") as handle:
        record = json.load(handle)
    if not isinstance(record, dict):
        raise ValueError(
            f"{path!r}: a certified record must be a JSON object, got "
            f"{type(record).__name__}"
        )
    return record


def compile_record_to_artifact(
    record_path: str,
    *,
    spec_id: str,
    strategy_index: int = 0,
    out_dir: str,
) -> str:
    """Read a certified record, call the canonical producer, write the `.spec.json`.

    Returns the written artifact path.

    Every semantic decision in this function belongs to
    `produce_spec_artifact_from_record`. This function validates the supplied identity
    and chooses the filename, and nothing else.
    """
    # IDENTITY FIRST, BEFORE ANY WORK. A refusal must cost nothing and must happen
    # before an artifact exists on disk under a name we would then have to retract.
    spec_id = parse_spec_id(spec_id, strategy_index)

    record = _load_record(record_path)

    # ── THE CANONICAL PRODUCER. NOT A COPY, NOT A REIMPLEMENTATION. ──────────────
    # `video=` is the producer's parameter name; the value is the canonical SPEC STUB,
    # which is what it copies into artifact["video"].
    result = produce_spec_artifact_from_record(
        record,
        video=spec_id,
        strategy_index=strategy_index,
    )

    # The PORTABLE contract is the artifact alone (R-777 §4): the opening-range
    # lowering and the execution candidates ride on the envelope as in-process
    # state and are deliberately NOT serialized into the artifact. Writing them
    # here would put a typed lowering back inside the portable JSON — the exact
    # inconsistency `RecordCompileResult.__post_init__` exists to make
    # unconstructable.
    artifact = result.artifact

    # NAMING IS THE CORPUS CONVENTION, MEASURED — NOT INVENTED HERE.
    # `[MEASURED]` in every committed artifact the filename stem EQUALS
    # `artifact["video"]`, which is itself the STUB `<video_id>__s<index>`
    # (e.g. stem `-igpOZs8LsM__s0` / `artifact.video == '-igpOZs8LsM__s0'`).
    # So the stub is the whole name: appending `__s{strategy_index}` here would
    # emit `..._s0__s0.spec.json` and silently break every loader that recovers
    # the stub by stripping `.spec.json` (e.g. run_shakedown_wave1.py:96).
    #
    # AR-1123 §2 invariant, held by construction rather than by comment:
    #     filename stem == artifact["video"] == the validated canonical spec id.
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{spec_id}{SPEC_ARTIFACT_SUFFIX}")
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(artifact, handle, indent=2, sort_keys=True, ensure_ascii=False)
        handle.write("\n")

    return out_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="compile_certified_record",
        description=(
            "SPINE-A (AR-1121 §4.A): compile ONE certified record into its portable "
            ".spec.json via the canonical Python producer. I/O only — this wrapper "
            "makes no semantic decision."
        ),
    )
    parser.add_argument(
        "--record",
        required=True,
        help="Path to the certified extraction record JSON.",
    )
    parser.add_argument(
        "--spec-id",
        required=True,
        help=(
            "The CANONICAL SPEC STUB `<video_id>__s<strategy_index>` "
            "(e.g. 'sVkmZklJDHI__s0') — NOT a bare source-video id. This value becomes "
            "artifact['video'] and the filename stem. A bare video id, or a stub whose "
            "__sN disagrees with --strategy-index, is REFUSED. Never derived from the "
            "record filename: identity is supplied, then validated."
        ),
    )
    parser.add_argument(
        "--strategy-index",
        type=int,
        default=0,
        help="Which strategy within the record to compile (default 0).",
    )
    parser.add_argument(
        "--out-dir",
        required=True,
        help="Directory the <video>__s<index>.spec.json is written into.",
    )
    args = parser.parse_args(argv)

    try:
        out_path = compile_record_to_artifact(
            args.record,
            spec_id=args.spec_id,
            strategy_index=args.strategy_index,
            out_dir=args.out_dir,
        )
    except Exception as exc:  # fail closed, and say which layer refused
        sys.stderr.write(f"COMPILE REFUSED: {type(exc).__name__}: {exc}\n")
        return 1

    sys.stdout.write(f"{out_path}\n")
    return 0


# REQUIRED for `python -m` to execute this module — but NOT what makes it reachable to
# SYSTEM-INVENTORY. Rule (c) (`__main__` discovery) is dead code at the time of writing
# (AR-1122 §3, repair authorized in AR-1123 §3); the reachability edge is the
# `compile:certified-record` declaration in package.json. See the module docstring.
if __name__ == "__main__":
    raise SystemExit(main())
