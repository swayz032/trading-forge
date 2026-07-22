"""compile_fidelity.py — LEG A (Tooth-1 proper): compile-fidelity forensics detector.

Frozen pre-registration:
`docs/designs/survivor-forensics-preregistration-2026-07-19.md` (sha256 7fe3995b…, R-070),
§1 LEG A + §0 (load-bearing default) + §6a (unbound == unenforced, never neutral absence).

WHAT THIS DOES. Given a compiled SpecArtifact (the `.spec.json` body produced by
`extraction/spec_producer.py:produce_spec_artifact`), Leg A emits a PER-CONDITION VERDICT
TABLE over the six sub-checks (i)-(vi) of §1-A and returns a CATEGORICAL PASS/BLOCK:

  (i)   type-family assignment is a recognized family (+ confidence recorded); the SEMANTIC
        half ("matches the taught semantics") is a Phase-2 fresh-reader countersign row.
  (ii)  every LOAD-BEARING condition (§0 default: every taught condition is load-bearing
        unless a written per-condition disposition says otherwise) is CONCRETELY BOUND —
        `approximation=False` — CATEGORICALLY, no threshold. The flag is RE-DERIVED from the
        live binding code path (`compile_binding_plan`), NEVER trusted from the spec record
        (§4's m4 false-flag exists because a mislabeled flag is how this leg gets gamed).
        Per §6a an UNBOUND taught condition (`bindable=False`) is an UNENFORCED condition and
        FAILS (ii) — it is never a neutral absence.
  (iii) polarity/direction: NO automated structural check exists here — polarity is verified
        WHOLLY by the Phase-2 fresh-reader "polarity" countersign row (§1-B Phase 2).
  (iv)  house-default exit carries its provenance stamp — an unstamped house value is a FAIL
        (R-038 pin (b) / R-039 §5(c)); taught-param-verbatim is a Phase-2 countersign row.
  (v)   no silent drops: every taught condition present; a condition marked non-load-bearing
        WITHOUT a disposition is a FAIL (§0 classification audit / §4 m7); a certificate
        condition with no corresponding spec condition is a silent drop (§4 m2).
  (vi)  provenance chain unbroken: spec_hash recomputes over the spec body AND a certificate
        is supplied that links to the same extraction (§4 m6). Missing certificate → BLOCK
        (fail-closed), never skip.

TWO PHASES (§1-B honored for the spec-vs-taught countersign):
  Phase 1 — `run_leg_a_phase1()` seals a deterministic per-condition table (content-hashed).
            The automated checks (i-structural, ii, iv, v, vi) are decided here.
  Phase 2 — `countersign_phase2()` accepts an INDEPENDENT fresh reader's countersignatures
            for the SEMANTIC rows (typing, polarity, drops/dispositions) and fail-closes when
            any required countersignature is absent or dissents. THIS MODULE NEVER AUTHORS THE
            COUNTERSIGNATURES — fresh eyes are the whole point (shared-blind-spot risk).

FAIL-CLOSED (§3): any leg that cannot run — missing artifact, missing spec, empty binding,
missing certificate, absent countersignature — is a BLOCK, never a skip. No `assert` is used
as a gate; refusals return an explicit BLOCK verdict. A CLI wrapper exits 2 on BLOCK.

PURE: no market data, no wall-clock, no randomness — `compile_binding_plan` is a static
binding compiler, so this runs in a data-less measurement worktree.
"""

from __future__ import annotations

import bisect
import hashlib
import json
import sys
import unicodedata
from dataclasses import dataclass

# Single-source-of-truth import (two-path law: reuse the producer's own constant/function
# rather than retyping the string, so a rename over there cannot silently drift this gate).
from src.engine.extraction.spec_producer import _HOUSE_DEFAULT_EXIT, _spec_hash
from src.engine.spec_family_bindings import (
    FAMILY_META,
    BindingPlan,
    ConditionBinding,
    compile_binding_plan,
)

# Mirror of the exit_source literal spec_producer.py:580 stamps alongside _HOUSE_DEFAULT_EXIT.
# Independently duplicated with citation — the same zero-import-surface convention the compiler
# uses for FVG_PRIMITIVE_NAME et al. If spec_producer changes this literal, the paired test
# test_house_exit_source_constant_matches_producer fails loudly.
HOUSE_EXIT_SOURCE: str = "framework_overlay_style_c"

PASS = "PASS"
BLOCK = "BLOCK"

# (vi) provenance shape-guard: a certificate is provenance, and a leg with zero provenance must
# NOT certify clean. A certificate must be a dict carrying at minimum the extraction LINK
# (`video`) and the condition ledger (`conditions`) the (v) drop-audit reconciles against.
# `{}` and any non-dict are the founding fail-open fixtures — both BLOCK with a named reason.
REQUIRED_CERT_KEYS: tuple[str, ...] = ("video", "conditions")

# (v) drop-audit anchor SPECIFICITY floor. A groundable transcript quote is a multi-token
# PHRASE, not a bare character/word — and it must be matched on TOKEN BOUNDARIES, never as an
# arbitrary substring (the pre-existing weakness the validity gate now leans on: a one-char
# anchor 'a' substring-matched essentially every spec text). MEASURED floor: the shortest
# legitimate anchor in the honest corpus is 2 tokens / 16 chars ("spine completion"); every
# real corpus taught-text is >= 4 tokens / 22 chars. So 2 tokens sits AT the honest-corpus
# minimum — it accepts every legitimate anchor and rejects single chars, single words, and
# punctuation. A sub-threshold anchor is a fabricated/meaningless anchor -> fail-closed (v) drop.
MIN_ANCHOR_TOKENS: int = 2

# The semantic sub-checks a FRESH READER must countersign in Phase 2 (§1-B Phase 2):
# (i) typing, (iii) polarity, (v) drops/dispositions incl. §0 non-LB dispositions.
COUNTERSIGN_ROWS: tuple[str, ...] = ("typing", "polarity", "drops")


@dataclass(frozen=True)
class CheckResult:
    """One (check-code -> pass/fail + reason) cell of the per-condition verdict table."""

    code: str
    passed: bool
    reason: str


@dataclass
class ConditionVerdict:
    condition_id: str
    type: str
    role: str
    load_bearing: bool
    ii_applicable: bool
    checks: list[CheckResult]
    row_verdict: str  # PASS | BLOCK
    fail_codes: list[str]
    countersign_required: bool

    def to_dict(self) -> dict:
        return {
            "condition_id": self.condition_id,
            "type": self.type,
            "role": self.role,
            "load_bearing": self.load_bearing,
            "ii_applicable": self.ii_applicable,
            "checks": [{"code": c.code, "passed": c.passed, "reason": c.reason} for c in self.checks],
            "row_verdict": self.row_verdict,
            "fail_codes": self.fail_codes,
            "countersign_required": self.countersign_required,
        }


@dataclass
class Phase1Seal:
    spec_hash: str
    rows: list[ConditionVerdict]
    leg_level_failures: list[CheckResult]
    automated_verdict: str  # PASS | BLOCK
    checks_failed: set[str]  # union of every failing check code (row + leg level)
    countersign_required_ids: list[str]
    seal_hash: str

    def to_dict(self) -> dict:
        return {
            "spec_hash": self.spec_hash,
            "rows": [r.to_dict() for r in self.rows],
            "leg_level_failures": [
                {"code": c.code, "passed": c.passed, "reason": c.reason} for c in self.leg_level_failures
            ],
            "automated_verdict": self.automated_verdict,
            "checks_failed": sorted(self.checks_failed),
            "countersign_required_ids": self.countersign_required_ids,
            "seal_hash": self.seal_hash,
        }


@dataclass
class Phase2Result:
    countersign_complete: bool
    countersign_clean: bool
    verdict: str  # PASS | BLOCK
    reasons: list[str]


@dataclass
class LegAResult:
    verdict: str  # PASS | BLOCK
    seal: Phase1Seal
    phase2: Phase2Result | None
    checks_failed: set[str]
    summary: str

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "checks_failed": sorted(self.checks_failed),
            "summary": self.summary,
            "seal": self.seal.to_dict(),
            "phase2": (
                None
                if self.phase2 is None
                else {
                    "countersign_complete": self.phase2.countersign_complete,
                    "countersign_clean": self.phase2.countersign_clean,
                    "verdict": self.phase2.verdict,
                    "reasons": self.phase2.reasons,
                }
            ),
        }


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _norm(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


# --------------------------------------------------------------------------- #
# Unicode `Default_Ignorable_Code_Point` — the PROPERTY that DEFINES "invisible/ignorable".
# --------------------------------------------------------------------------- #
# `_has_visible_content` (below) must reject any string that carries no INK. The residual R-275
# warned of is that `str.isprintable()` is True for two invisible sub-classes that are NOT
# category C*/Z*: variation selectors (U+FE00–FE0F, U+E0100–E01EF; category Mn) and Hangul
# fillers (U+115F, U+1160, U+3164, U+FFA0; category Lo). Extending a char deny-list would re-open
# on the NEXT such codepoint. Instead we close on the Unicode PROPERTY that DEFINES the whole
# invisible class: `Default_Ignorable_Code_Point`. It is the canonical membership test — it
# already contains ZWSP/ZWNJ/ZWJ (U+200B–200D), BOM (U+FEFF), word-joiner (U+2060), invisible
# math operators (U+2061–2064), soft hyphen (U+00AD), the variation selectors, the Hangul
# fillers, and every FUTURE default-ignorable codepoint the standard adds. Membership is decided
# by the property, not a remembered char list.
#
# IMPLEMENTATION CHOICE (spec option #2, stdlib-only). The cleanest test would be the `regex`
# module's `\p{Default_Ignorable_Code_Point}`, but `regex` is NOT a declared dependency of this
# project (absent from requirements/pyproject) and this is fail-closed INSTRUMENT code that must
# run on a freshly-booted, minimally-provisioned box. A runtime `import regex` that succeeds in a
# rich dev venv but fails on the tower is exactly the cold-boot trap to avoid. So the ranges below
# are MATERIALIZED as a stable module constant — but SOURCED authoritatively, not hand-typed:
# they were generated by enumerating `\p{Default_Ignorable_Code_Point}` over the whole codespace
# via `regex` 2026.5.9 (Unicode 15.1) → 17 ranges / 4174 codepoints. The predicate stays
# property-DEFINITIONAL (it tests the property's exact extent); only its materialization is baked.
# Default_Ignorable is one of the most stable derived properties, so a frozen table is safe.
_DEFAULT_IGNORABLE_RANGES: tuple[tuple[int, int], ...] = (
    (0x00AD, 0x00AD),      # SOFT HYPHEN (Cf)
    (0x034F, 0x034F),      # COMBINING GRAPHEME JOINER (Mn)
    (0x061C, 0x061C),      # ARABIC LETTER MARK (Cf)
    (0x115F, 0x1160),      # HANGUL CHOSEONG/JUNGSEONG FILLER (Lo) — render as nothing
    (0x17B4, 0x17B5),      # KHMER VOWEL INHERENT AQ/AA (Mn)
    (0x180B, 0x180F),      # MONGOLIAN FREE VARIATION SELECTORS + VOWEL SEP (Mn/Cf)
    (0x200B, 0x200F),      # ZWSP/ZWNJ/ZWJ, LRM/RLM (Cf) — zero-width + bidi marks
    (0x202A, 0x202E),      # LRE/RLE/PDF/LRO/RLO bidi format controls (Cf)
    (0x2060, 0x206F),      # WORD-JOINER, FUNCTION-APP, INVISIBLE times/sep/plus (U+2064), etc. (Cf)
    (0x3164, 0x3164),      # HANGUL FILLER (Lo)
    (0xFE00, 0xFE0F),      # VARIATION SELECTOR-1..16 (Mn) — isprintable() True, render nothing
    (0xFEFF, 0xFEFF),      # ZERO WIDTH NO-BREAK SPACE / BOM (Cf)
    (0xFFA0, 0xFFA0),      # HALFWIDTH HANGUL FILLER (Lo)
    (0xFFF0, 0xFFF8),      # unassigned-but-default-ignorable (Cn)
    (0x1BCA0, 0x1BCA3),    # SHORTHAND FORMAT CONTROLS (Cf)
    (0x1D173, 0x1D17A),    # MUSICAL SYMBOL BEGIN/END format controls (Cf)
    (0xE0000, 0xE0FFF),    # TAGS + VARIATION SELECTOR SUPPLEMENT (U+E0100–E01EF) + reserved
)
# Flattened sorted starts for O(log n) membership via bisect. (17 ranges — the whole property.)
_DI_STARTS: tuple[int, ...] = tuple(a for a, _ in _DEFAULT_IGNORABLE_RANGES)


def _is_default_ignorable(cp: int) -> bool:
    """True iff codepoint `cp` has the Unicode `Default_Ignorable_Code_Point` property (per the
    baked, regex-sourced extent above). Definitional membership test, not a char blacklist."""
    i = bisect.bisect_right(_DI_STARTS, cp) - 1
    if i < 0:
        return False
    lo, hi = _DEFAULT_IGNORABLE_RANGES[i]
    return lo <= cp <= hi


def _has_visible_content(value: object) -> bool:
    """CATEGORICAL presence predicate for a string field: True iff `value` is a str carrying at
    least one VISIBLE, meaningful character — a POSITIVE content requirement (mirrors
    MIN_ANCHOR_TOKENS' 'require content, never blacklist chars'), NOT an enumerated deny-list of
    known-bad code points (which re-opens on the next invisible codepoint).

    A character counts as truly-visible iff ALL of the following hold — each clause removes one
    face of "renders as nothing", and together they close the WHOLE invisible class DEFINITIONALLY
    (by Unicode property/category, never by a remembered char list):
      * `str.isprintable()` is True — rejects every Unicode 'Other' (Cc, Cf, Cs, Co, Cn) and
        'Separator' (Zs, Zl, Zp) EXCEPT the one printable ASCII space; this alone kills the Cf/Cc/Z
        zero-width/format/whitespace classes (ZWSP, BOM, word-joiner, NBSP, ideographic space, …).
      * `not ch.isspace()` — removes that lingering printable ASCII space (and, redundantly, the
        rest of whitespace), so a whitespace-only string is absent.
      * NOT `Default_Ignorable_Code_Point` — THE Unicode property that DEFINES "invisible/
        ignorable". This is the R-275 residual close: variation selectors (U+FE00–FE0F, U+E0100…;
        category Mn) and Hangul fillers (U+115F/U+1160/U+3164/U+FFA0; category Lo) are `isprintable`
        True yet render as nothing — they are default-ignorable, so they are rejected here, along
        with every FUTURE default-ignorable codepoint. Closing on the PROPERTY (not the 4 named
        residuals) is what ends the whack-a-mole: the next invisible codepoint the standard adds is
        already covered because it will carry this property.
      * NOT a lone combining/enclosing mark — `unicodedata.combining(ch) != 0` OR category in
        {Mn, Me}. A LONE combining mark (e.g. U+0301 acute) or enclosing mark (e.g. U+20DD, whose
        combining class is 0) renders nothing on its own. This rejects a string that is ONLY
        combining marks WITHOUT over-rejecting a legitimate base+accent sequence: in "e"+U+0301 the
        base 'e' is itself truly-visible and satisfies the predicate on its own.

    A non-str (None, a missing field, or any non-string value) carries no visible string content
    and is False — fail-closed: an absent/malformed field is NOT a present disposition, anchor,
    provenance link, or reader identity. The bytes it would `str()` to are never treated as
    provenance."""
    if not isinstance(value, str):
        return False
    for ch in value:
        if not ch.isprintable():
            continue
        if ch.isspace():
            continue
        if _is_default_ignorable(ord(ch)):
            continue
        if unicodedata.combining(ch) != 0 or unicodedata.category(ch) in ("Mn", "Me"):
            continue
        return True
    return False


def _spec_body(artifact: dict) -> dict | None:
    if not isinstance(artifact, dict):
        return None
    spec = artifact.get("spec", artifact)
    return spec if isinstance(spec, dict) else None


def _taught_conditions(spec: dict) -> list[dict]:
    """Every taught condition the compiled spec carries: entry conditions + invalidations.
    Order-stable; each is a dict with id/type/object/role and optional load_bearing/
    non_lb_disposition/approximation (the last three may be absent — §0: no field => LB)."""
    out: list[dict] = []
    for c in spec.get("entry_conditions") or []:
        if isinstance(c, dict):
            out.append(c)
    for c in spec.get("invalidations") or []:
        if isinstance(c, dict):
            out.append(c)
    return out


def _binding_index(plan: BindingPlan) -> dict[str, ConditionBinding]:
    idx: dict[str, ConditionBinding] = {}
    for b in list(plan.bindings) + list(plan.invalidation_bindings):
        idx[b.condition_id] = b
    return idx


# --------------------------------------------------------------------------- #
# PHASE 1 — seal the per-condition verdict table (automated checks)
# --------------------------------------------------------------------------- #
def run_leg_a_phase1(
    artifact: dict,
    *,
    certificate: dict | None = None,
) -> Phase1Seal:
    """Seal the per-condition compile-fidelity table. Fail-closed: a structural inability to
    run (no artifact, no spec, no conditions, empty binding) is a BLOCK, recorded as a
    leg-level failure — never an exception-as-pass and never a skip."""
    leg_failures: list[CheckResult] = []
    rows: list[ConditionVerdict] = []
    checks_failed: set[str] = set()

    spec = _spec_body(artifact)
    if spec is None:
        leg_failures.append(CheckResult("input", False, "no spec body on artifact (fail-closed BLOCK)"))
        return _finish_phase1("", rows, leg_failures, {"input"})

    conditions = _taught_conditions(spec)
    if not conditions:
        leg_failures.append(CheckResult("input", False, "spec carries zero taught conditions (fail-closed BLOCK)"))
        return _finish_phase1(str(artifact.get("spec_hash", "")), rows, leg_failures, {"input"})

    # LIVE binding — the authority for (ii). ALWAYS re-derived fresh from the live code path,
    # NEVER accepted from a caller: a caller-injected plan would be an ungated bypass of the
    # very re-derivation (ii) exists to enforce (R-260 deliverable #3 — the parameter is
    # removed entirely). A compiler crash is a fail-closed BLOCK, not a raise.
    try:
        binding_plan = compile_binding_plan(spec)
    except Exception as exc:  # noqa: BLE001
        leg_failures.append(CheckResult("ii", False, f"binding compile raised: {exc!r} (fail-closed BLOCK)"))
        return _finish_phase1(str(artifact.get("spec_hash", "")), rows, leg_failures, {"ii"})
    bindings = _binding_index(binding_plan)

    # (vi) provenance chain — leg level.
    for cr in _check_provenance_chain(artifact, spec, certificate):
        if not cr.passed:
            checks_failed.add(cr.code)
            leg_failures.append(cr)

    # per-condition rows
    for cond in conditions:
        row = _verdict_for_condition(cond, bindings)
        rows.append(row)
        checks_failed.update(row.fail_codes)

    return _finish_phase1(str(artifact.get("spec_hash", "")), rows, leg_failures, checks_failed)


def _finish_phase1(
    spec_hash: str,
    rows: list[ConditionVerdict],
    leg_failures: list[CheckResult],
    checks_failed: set[str],
) -> Phase1Seal:
    automated = BLOCK if checks_failed else PASS
    countersign_ids = [r.condition_id for r in rows if r.countersign_required]
    table = {
        "spec_hash": spec_hash,
        "rows": [r.to_dict() for r in rows],
        "leg_level_failures": [
            {"code": c.code, "passed": c.passed, "reason": c.reason} for c in leg_failures
        ],
        "automated_verdict": automated,
    }
    canonical = json.dumps(table, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    seal_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return Phase1Seal(
        spec_hash=spec_hash,
        rows=rows,
        leg_level_failures=leg_failures,
        automated_verdict=automated,
        checks_failed=checks_failed,
        countersign_required_ids=countersign_ids,
        seal_hash=seal_hash,
    )


def _verdict_for_condition(cond: dict, bindings: dict[str, ConditionBinding]) -> ConditionVerdict:
    cid = str(cond.get("id", ""))
    ctype = str(cond.get("type", ""))
    role = str(cond.get("role", ""))
    checks: list[CheckResult] = []

    # §0 load-bearing determination. DEFAULT True; non-LB requires a written disposition.
    lb_field = cond.get("load_bearing", True)
    load_bearing = bool(lb_field) if lb_field is not None else True
    disposition = cond.get("non_lb_disposition")

    binding = bindings.get(cid)

    # (i) type-family — structural half: recognized family + confidence recorded.
    if ctype in FAMILY_META:
        checks.append(CheckResult("i", True, f"family {ctype} recognized"))
    else:
        checks.append(CheckResult("i", False, f"family {ctype!r} not in FAMILY_META"))
    if not _has_visible_content(cond.get("type_confidence")):
        checks.append(CheckResult("i_conf", False, "type_confidence not recorded (absent/blank/invisible)"))
    else:
        checks.append(CheckResult("i_conf", True, f"confidence={cond.get('type_confidence')}"))

    # §0 classification audit (rides Leg A(v) / §4 m7): non-LB WITHOUT a disposition is a FAIL.
    # "Present" is CATEGORICAL — a disposition counts only if it carries >=1 VISIBLE character
    # (`_has_visible_content`). A blank/whitespace-only disposition is semantically NO disposition,
    # AND so is a zero-width / Unicode-format-only one (U+200B/FEFF/2060/00AD/…): `str.strip()`
    # removes only isspace() chars, so a truthy-but-invisible "​" would otherwise satisfy the
    # presence check while being invisible to BOTH this gate AND the Phase-2 fresh reader — a
    # two-guard bypass worse than a visible ".". The visible-content predicate rejects the whole
    # invisible class by Unicode category, not a char deny-list.
    if not load_bearing and not _has_visible_content(disposition):
        checks.append(CheckResult("v_nonlb", False, "marked non-load-bearing WITHOUT a disposition (§0/m7)"))
    elif not load_bearing:
        checks.append(CheckResult("v_nonlb", True, "non-LB with disposition (Phase-2 countersign owed)"))

    # (m4) FALSE-FLAG: a stored per-condition approximation label that disagrees with the LIVE
    # binding. (ii) itself always uses the live value; this row additionally CONVICTS a lie.
    if binding is not None and "approximation" in cond:
        claimed = bool(cond.get("approximation"))
        live = bool(binding.approximation)
        if claimed != live:
            checks.append(
                CheckResult(
                    "m4_false_flag",
                    False,
                    f"record claims approximation={claimed} but live binding is {live} (false-flag)",
                )
            )
        else:
            checks.append(CheckResult("m4_false_flag", True, "stored label matches live binding"))

    # (ii) concretely bound — categorical, over LOAD-BEARING conditions only.
    ii_applicable = load_bearing and not _is_provenance_only(ctype, binding)
    if ii_applicable:
        checks.append(_check_concretely_bound(cid, binding))
    else:
        why = "non-load-bearing (dispositioned)" if not load_bearing else "provenance-only (never executed)"
        checks.append(CheckResult("ii", True, f"(ii) not applicable — {why}; audited elsewhere"))

    # (iv) house-default exit provenance — only meaningful on the exit overlay, handled at leg
    # level via _check_provenance_chain's overlay pass; per-condition (iv) verbatim-param is a
    # Phase-2 countersign row (recorded via countersign_required below).

    fail_codes = [c.code for c in checks if not c.passed]
    # A condition owes a fresh-reader countersign for its SEMANTIC rows (typing/polarity/drops)
    # whenever its automated rows did not already hard-fail it out — the semantic read is what
    # closes the shared-blind-spot risk (§1-B Phase 2).
    countersign_required = True
    row_verdict = BLOCK if fail_codes else PASS
    return ConditionVerdict(
        condition_id=cid,
        type=ctype,
        role=role,
        load_bearing=load_bearing,
        ii_applicable=ii_applicable,
        checks=checks,
        row_verdict=row_verdict,
        fail_codes=fail_codes,
        countersign_required=countersign_required,
    )


def _is_provenance_only(ctype: str, binding: ConditionBinding | None) -> bool:
    """EXIT_HINT is provenance-only (executed=False by family) — recorded, never gated, so (ii)
    does not apply. Anything else that is non-executed is NOT given this pass (fail-closed)."""
    if ctype == "EXIT_HINT":
        return True
    meta = FAMILY_META.get(ctype)
    if meta is not None and getattr(meta, "executed", True) is False:
        return True
    return False


def _honest_approximation(binding: ConditionBinding) -> bool:
    """The (ii) approximation truth, anchored to the ENFORCED HONEST accounting and INDEPENDENT
    of the production flag (R-260 §1). With TF_FAMILY_META_ENFORCED OFF (the default),
    `binding.approximation` carries `effective_approximation()` = the LEGACY convenience label —
    which for ENABLE_ENTRY/ENTER/INVALIDATE is `False` while the honest value is `True` (the
    FAMILY_META comments call the legacy value a fidelity lie). A gate that guards fidelity must
    read the honest value, never the router's convenience. The read is flag-independent and
    does NOT flip any flag. Unknown family (not in FAMILY_META) → fall back to the binding's own
    flag (the row's (i) check already fails an unrecognized family, so it blocks regardless)."""
    meta = FAMILY_META.get(binding.type)
    if meta is None:
        return bool(binding.approximation)
    return meta.enforced_honest_approximation()


def _check_concretely_bound(cid: str, binding: ConditionBinding | None) -> CheckResult:
    """(ii) categorical: a load-bearing condition PASSES iff it is bindable AND executed AND
    its HONEST enforced approximation is False — bindable/executed re-derived from the live
    binding; approximation anchored to the enforced honest accounting (R-260 §1), never the
    flag-gated convenience label. §6a: bindable=False is an UNENFORCED taught condition, a FAIL,
    never a neutral absence."""
    if binding is None:
        return CheckResult("ii", False, f"no live binding for condition {cid!r} (unenforced; §6a)")
    if not binding.bindable:
        return CheckResult("ii", False, f"unbound taught condition ({binding.reason or 'no primitive'}); §6a unenforced")
    if not binding.executed:
        return CheckResult("ii", False, "bound but not executed in production (fidelity gap)")
    if _honest_approximation(binding):
        return CheckResult("ii", False, f"bound to an approximation (proxy/pass-through, honest accounting): {binding.primitive!r}")
    return CheckResult("ii", True, f"concretely bound honest approximation=False -> {binding.primitive!r}")


def _cert_key_invalid(cert: dict, key: str) -> bool:
    """A required provenance key is INVALID — as absent as missing — when it is missing, None,
    an empty/whitespace string, or an empty/incomplete collection. Key PRESENCE is not enough:
    a present-but-null key carries zero provenance and must never certify clean (the residual
    behind the original F-2's fail-open class). Validity per key:
      - `video`      : a non-empty (non-whitespace) extraction link.
      - `conditions` : a NON-EMPTY list in which EVERY entry is a dict carrying a non-empty
                       `quote_anchor` — the field the (v) drop-audit reconciles against. None,
                       [], a non-list, or a list with ANY anchorless/blank entry is a
                       provenance-incomplete ledger (fail-closed BLOCK).
    (Two choices STATED. (1) `conditions` validity keys on `quote_anchor` because that anchor is
    the ONLY provenance the drop-audit can reconcile a spec condition against; a ledger with no
    reconcilable anchor is provenance in name only. (2) The per-entry test is `all`, NOT `any`
    (the A2 fix): an aggregate 'some entry has an anchor' let anchorless entries ride one valid
    anchor. A genuinely-legitimate anchorless taught condition is routed through the §0
    DISPOSITION lane — NOT through a gate taught to accept a missing anchor, which would re-open
    the hole. Measured: no honest condition is anchorless, so the strict `all` forces nothing.)"""
    if key not in cert:
        return True
    val = cert[key]
    if val is None:
        return True
    if key == "video":
        # Visible-content presence (same categorical predicate as the m7 disposition gate): a
        # zero-width / format-only video link (e.g. a lone U+200B) survives `str.strip()` and would
        # certify as a valid extraction link while being semantically empty — reject the whole
        # invisible class, not just isspace() whitespace.
        return not _has_visible_content(val)
    if key == "conditions":
        if not isinstance(val, list) or not val:
            return True
        # Each entry's quote_anchor must carry VISIBLE content — a zero-width/format-only anchor is
        # no anchor. (Net-caught downstream by the MIN_ANCHOR_TOKENS floor too, but the validity
        # layer must not itself launder an invisible anchor into a "well-formed" ledger; closing it
        # here keeps the class shut if that floor is ever refactored.)
        return not all(isinstance(c, dict) and _has_visible_content(c.get("quote_anchor", "")) for c in val)
    return False


def _check_provenance_chain(artifact: dict, spec: dict, certificate: dict | None) -> list[CheckResult]:
    """(vi) spec_hash ↔ certificate ↔ extraction, plus (iv) house-default exit stamp and (v)
    certificate-drop audit — the leg-level checks."""
    out: list[CheckResult] = []

    # (vi.a) spec_hash recomputes over the spec body.
    stored = str(artifact.get("spec_hash", ""))
    recomputed = _spec_hash(spec)
    if not stored:
        out.append(CheckResult("vi", False, "spec_hash absent (broken chain; fail-closed)"))
    elif stored != recomputed:
        out.append(CheckResult("vi", False, f"spec_hash mismatch stored={stored[:12]} recomputed={recomputed[:12]} (m6)"))
    else:
        out.append(CheckResult("vi", True, f"spec_hash verifies ({stored[:12]})"))

    # (vi.b) certificate supplied, WELL-FORMED (present AND valid — not merely a key with a
    # null/empty value), and linked to the same extraction. Missing, non-dict, or any required
    # provenance key missing-OR-null => BLOCK (fail-closed; a `{}`, non-dict, or null-valued
    # certificate is zero provenance and must never certify clean).
    if certificate is None:
        out.append(CheckResult("vi_cert", False, "no certificate supplied (fail-closed BLOCK)"))
    elif not isinstance(certificate, dict):
        out.append(CheckResult("vi_cert", False, f"certificate is not a dict (type {type(certificate).__name__}); fail-closed BLOCK"))
    elif [k for k in REQUIRED_CERT_KEYS if _cert_key_invalid(certificate, k)]:
        invalid = [k for k in REQUIRED_CERT_KEYS if _cert_key_invalid(certificate, k)]
        out.append(CheckResult("vi_cert", False, f"certificate has missing/null/empty required provenance key(s) {invalid}; fail-closed BLOCK"))
    else:
        # (m6) fail-CLOSED cross-link: PASS only when linkage is AFFIRMATIVELY verified — both
        # ids present AND equal after `_norm`. Any unverifiable state BLOCKs. `cert_video` is
        # already guaranteed present/non-blank (it passed _cert_key_invalid above), so the only
        # unverifiable case is an ABSENT/blank artifact video: a certificate naming a DIFFERENT
        # (or any) extraction while the artifact's own provenance is missing is UNLINKABLE and
        # must never reconcile clean (the old guard fail-OPENed here — it fired only when BOTH
        # were present). MEASURED: no honest corpus artifact carries a null/blank video, so this
        # strict gate forces nothing on honest inputs.
        art_video = artifact.get("video")
        cert_video = certificate.get("video")
        # Presence is CATEGORICAL: a zero-width / format-only artifact video is as absent/blank as
        # None (it normalizes to "" here → the honest "unverifiable" BLOCK branch below), never a
        # spuriously-"present" link that would only be caught as a confusing "mismatch". cert_video
        # is already guaranteed visible upstream (it passed _cert_key_invalid).
        art_norm = _norm(str(art_video)) if _has_visible_content(art_video) else ""
        cert_norm = _norm(str(cert_video)) if _has_visible_content(cert_video) else ""
        if art_norm and cert_norm and art_norm == cert_norm:
            out.append(CheckResult("vi_cert", True, "certificate linked to extraction"))
        elif not art_norm:
            out.append(CheckResult("vi_cert", False, "artifact video absent/blank — certificate linkage unverifiable; fail-closed BLOCK (m6)"))
        else:
            out.append(CheckResult("vi_cert", False, f"certificate video {cert_video!r} != artifact video {art_video!r} (m6)"))

        # (v) certificate-drop audit: every certificate condition should map to a spec condition.
        out.extend(_check_no_certificate_drops(spec, certificate))

    # (iv) house-default exit provenance stamp.
    out.append(_check_house_exit_stamp(spec))
    return out


def _token_boundary_contains(anchor: str, text: str) -> bool:
    """TOKEN-BOUNDARY containment (both operands already `_norm`'d = lowercased, single-spaced):
    the anchor is a whole-token subsequence of `text`, or `text` is a whole-token subsequence of
    the anchor. Space-padding is what makes it token-boundary: a bare fragment (e.g. 'a') can no
    longer match INSIDE a token ('wait'), only as a standalone token run."""
    a = f" {anchor} "
    t = f" {text} "
    return a in t or t in a


def _max_bipartite_matching(edges: list[list[int]], n_right: int) -> int:
    """Kuhn's augmenting-path maximum bipartite matching. `edges[i]` = the right-node indices
    left-node i (a certificate entry) may claim; a right node (a taught spec condition) is
    claimed by AT MOST ONE left node. Returns the matching size. Sizes here are a handful of
    conditions, so the O(V·E) simplicity is fine."""
    match_right = [-1] * n_right

    def augment(u: int, seen: list[bool]) -> bool:
        for v in edges[u]:
            if not seen[v]:
                seen[v] = True
                if match_right[v] == -1 or augment(match_right[v], seen):
                    match_right[v] = u
                    return True
        return False

    size = 0
    for u in range(len(edges)):
        if augment(u, [False] * n_right):
            size += 1
    return size


def _check_no_certificate_drops(spec: dict, certificate: dict) -> list[CheckResult]:
    """(v) 1:1 RECONCILIATION (bijection), the A3 redesign. The old audit asked only "does this
    anchor appear SOMEWHERE in a flattened pool" — no distinctness, so m2 was launderable: drop
    a taught condition and refill its certificate slot with a DUPLICATE of a kept condition's
    anchor and every entry still 'mapped'. Now each certificate entry must claim a DISTINCT
    taught condition (maximum matching): a duplicated/reused anchor cannot cover two slots, an
    unmatched certificate entry is unreconciled provenance, and an unmatched taught condition is
    the silent drop (m2) — un-launderable."""
    if not isinstance(certificate, dict):
        return []
    cert_conditions = certificate.get("conditions") or []
    if not isinstance(cert_conditions, list) or not cert_conditions:
        return []  # nothing to reconcile against; (v) drop-audit is vacuously satisfied
    out: list[CheckResult] = []

    # Certificate anchors (validity is gated upstream at vi_cert; stay defensive). A sub-threshold
    # anchor is a fabricated/meaningless anchor → fail-closed (v) drop, before matching.
    cert_anchors: list[str] = []
    for cc in cert_conditions:
        if not isinstance(cc, dict):
            continue
        anchor = _norm(str(cc.get("quote_anchor", "")))
        if not anchor:
            continue
        if len(anchor.split()) < MIN_ANCHOR_TOKENS:
            out.append(CheckResult("v", False, f"certificate condition {anchor[:40]!r} below minimum anchor specificity ({MIN_ANCHOR_TOKENS}+ tokens); fabricated/meaningless anchor (m2)"))
            continue
        cert_anchors.append(anchor)
    if out:
        return out  # fabricated anchors already convict; the 1:1 matching is moot

    # Per-condition texts (object + evidence) — NOT a flattened pool, so an anchor is scored
    # against ITS candidate conditions, one at a time.
    taught = _taught_conditions(spec)
    cond_texts: list[list[str]] = []
    for c in taught:
        texts = [_norm(str(c.get("object", ""))), _norm(str(c.get("evidence", "")))]
        cond_texts.append([t for t in texts if t])

    # Edges: certificate entry i → taught condition j if the anchor token-matches any of j's
    # texts. An anchor that ambiguously matches several conditions keeps edges to all of them —
    # the matching resolves the ambiguity by assigning it to whichever leaves a 1:1 possible; it
    # is only fatal when it breaks the bijection (a shared quote grounding two DISTINCT present
    # conditions, each claimed once, is legitimate — and MEASURED absent in the honest corpus).
    edges = [
        [j for j, texts in enumerate(cond_texts) if any(_token_boundary_contains(anchor, t) for t in texts)]
        for anchor in cert_anchors
    ]
    matched = _max_bipartite_matching(edges, len(taught))
    n_cert, n_taught = len(cert_anchors), len(taught)

    # R-282 COUPLING INVARIANT: this 1:1 distinctness (matched == n_taught) is JOINTLY
    # LOAD-BEARING with spec_producer._anchor_grounds' token-boundary stamp. The producer
    # can still stamp a spurious cross-edge, but only onto an already-object-matched
    # condition; a genuinely dropped condition gets zero edges and it is THIS distinctness
    # that convicts it. Weaken this back toward a flattened-pool membership test and the
    # producer stamp launders a drop again even with the token-boundary upstream — do not
    # relax either half without re-hardening the other.
    if n_cert != n_taught:
        out.append(CheckResult("v", False, f"certificate cardinality {n_cert} != taught-condition count {n_taught}; provenance ledger is not 1:1 (m2)"))
    if matched < n_cert:
        out.append(CheckResult("v", False, f"{n_cert - matched} certificate entr{'y' if n_cert - matched == 1 else 'ies'} do not reconcile to a DISTINCT taught condition (duplicated/laundered anchor; m2)"))
    if matched < n_taught:
        out.append(CheckResult("v", False, f"{n_taught - matched} taught condition(s) have no matching certificate entry (silent drop; m2)"))
    if not out:
        out.append(CheckResult("v", True, "certificate reconciles 1:1 with taught conditions (bijection)"))
    return out


def _check_house_exit_stamp(spec: dict) -> CheckResult:
    """(iv) A house-default exit MUST carry its provenance stamp. If a framework_overlay exit is
    present, both the exit phrase and its exit_source must be the stamped house-default values;
    a present-but-unstamped house exit is a FAIL (§4 m5). No overlay => taught exit (or none);
    taught-param verbatim is a Phase-2 countersign concern, not failed here."""
    overlay = spec.get("framework_overlay")
    if not isinstance(overlay, dict):
        return CheckResult("iv", True, "no house-default exit overlay (taught exit or none)")
    exit_val = overlay.get("exit")
    src = overlay.get("exit_source")
    house_signalled = exit_val is not None or src is not None
    if not house_signalled:
        return CheckResult("iv", True, "empty overlay")
    if exit_val == _HOUSE_DEFAULT_EXIT and src == HOUSE_EXIT_SOURCE:
        return CheckResult("iv", True, "house-default exit carries provenance stamp")
    return CheckResult(
        "iv",
        False,
        f"house-default exit missing/wrong provenance stamp: exit={exit_val!r} source={src!r} (m5)",
    )


# --------------------------------------------------------------------------- #
# PHASE 2 — fresh-reader countersign (fail-closed; this module never authors it)
# --------------------------------------------------------------------------- #
def countersign_phase2(seal: Phase1Seal, countersignatures: dict[str, dict] | None) -> Phase2Result:
    """Accept an INDEPENDENT fresh reader's countersignatures for the semantic rows and
    fail-close when any required countersignature is absent or dissents.

    Each countersignature is `{condition_id: {"reader_id": str, "reader_vintage": str,
    "typing": bool, "polarity": bool, "drops": bool}}` — supplied by the fresh reader, NEVER
    fabricated here. A missing reader_id, a missing row, or any False row => BLOCK."""
    reasons: list[str] = []
    if not seal.countersign_required_ids:
        return Phase2Result(True, True, PASS, ["no rows required countersign"])
    if not countersignatures:
        return Phase2Result(False, False, BLOCK, ["no countersignatures supplied (fail-closed BLOCK)"])
    if not isinstance(countersignatures, dict):
        # A malformed (non-dict) countersignatures object is a fail-closed BLOCK, never an
        # uncaught AttributeError — a crash is not a fail-closed refusal.
        return Phase2Result(
            False, False, BLOCK,
            [f"countersignatures is not a dict (type {type(countersignatures).__name__}); fail-closed BLOCK"],
        )

    complete = True
    clean = True
    for cid in seal.countersign_required_ids:
        cs = countersignatures.get(cid)
        if not isinstance(cs, dict):
            complete = False
            reasons.append(f"{cid}: no countersignature (fail-closed)")
            continue
        if not _has_visible_content(cs.get("reader_id")):
            # Reader identity presence is CATEGORICAL — a zero-width / format-only (or
            # whitespace-only) reader_id is no identity and must not satisfy completeness, or an
            # invisible "reader" would clear the fresh-reader countersign the whole leg leans on.
            complete = False
            reasons.append(f"{cid}: countersignature missing reader_id")
        for rowname in COUNTERSIGN_ROWS:
            if rowname not in cs:
                complete = False
                reasons.append(f"{cid}: countersignature missing row {rowname!r}")
            elif cs.get(rowname) is not True:
                clean = False
                reasons.append(f"{cid}: fresh reader DISSENTS on {rowname}")
    verdict = PASS if (complete and clean) else BLOCK
    if verdict == PASS:
        reasons.append("all required rows countersigned and agree")
    return Phase2Result(complete, clean, verdict, reasons)


# --------------------------------------------------------------------------- #
# ORCHESTRATION
# --------------------------------------------------------------------------- #
def run_leg_a(
    artifact: dict,
    *,
    certificate: dict | None = None,
    countersignatures: dict[str, dict] | None = None,
) -> LegAResult:
    """Full Leg A: Phase-1 seal, then (only if the automated checks pass) the Phase-2 fresh-
    reader countersign. Categorical PASS iff Phase-1 automated PASS AND Phase-2 countersign
    complete+clean. Fail-closed everywhere else."""
    seal = run_leg_a_phase1(artifact, certificate=certificate)
    checks_failed = set(seal.checks_failed)

    if seal.automated_verdict == BLOCK:
        # No need to countersign a spec the automated leg already blocks.
        return LegAResult(
            verdict=BLOCK,
            seal=seal,
            phase2=None,
            checks_failed=checks_failed,
            summary=f"BLOCK (automated Leg A): failing checks {sorted(checks_failed)}",
        )

    phase2 = countersign_phase2(seal, countersignatures)
    if phase2.verdict == BLOCK:
        checks_failed.add("countersign")
        return LegAResult(
            verdict=BLOCK,
            seal=seal,
            phase2=phase2,
            checks_failed=checks_failed,
            summary=f"BLOCK (Phase-2 countersign): {phase2.reasons}",
        )
    return LegAResult(
        verdict=PASS,
        seal=seal,
        phase2=phase2,
        checks_failed=checks_failed,
        summary="PASS — all six checks pass and the fresh-reader countersign agrees (ROBUST-SURVIVOR compile leg)",
    )


def _cli(argv: list[str]) -> int:
    """Thin CLI: `python -m src.engine.forensics.compile_fidelity <artifact.spec.json>`.
    Guard refusal / BLOCK exits 2 (never asserts). Certificate/countersign are not wired on the
    CLI — so a lone artifact BLOCKs fail-closed on (vi), which is the honest inert result."""
    if not argv:
        print("usage: compile_fidelity <artifact.spec.json>", file=sys.stderr)
        return 2
    with open(argv[0], encoding="utf-8") as fh:
        artifact = json.load(fh)
    result = run_leg_a(artifact)
    print(json.dumps(result.to_dict(), indent=2))
    return 0 if result.verdict == PASS else 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_cli(sys.argv[1:]))
