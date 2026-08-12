"""AR-1054 §3/§4 — the producer must speak the DECLARED staging vocabulary.

Two measured production defects, each RED before its repair:

A. `spec_producer._untaught_exit()` decides a stop/target is concrete by reading
   only `level` + `gestural`. **No declared schema emits `level`.** The default
   extraction schema
   `src/agents/kb/transcript-extractor-minimal-schema.json` declares:

     stop.required = ["anchor"]
     stop.anchor   = enum[... "fvg_low" ... "atr_multiple", null]
                     "anchor=null falls back to framework default"
     targets.items.required = ["priority", "type"]
     targets.items.r_multiple = number|null, 0.1..50
                     "R-multiple if speaker stated one"
     targets  = "Empty array if speaker doesn't say"

   So the schema itself states the untaught semantics; this module implements
   them rather than inventing rules. `level` is retained only for backward
   compatibility -- it is declared by NEITHER the minimal nor the legacy schema
   (the one 'level' substring in the minimal schema is inside the enum value
   `vp_level_proximity`).

B. `opening_range_lowering.lower_opening_range_definition()` does
   `classification.get("market_open_anchor")` after
   `record.get("instrument_classification") or {}`. The real extractor emits the
   STRING "futures_primary", so the producer raises AttributeError before it can
   mint any artifact.

FIXTURE AUTHORITY -- the stop/targets dicts below are copied VERBATIM from the
byte-stable forward extraction record:
    transcript sha256 df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc
    record     sha256 199d740b70b65f83ef3c4badb11af12cf405f741ef6e482701641f3ae11d1167
    (two independent extractor runs, byte-identical -- AR-1053)
"""
from __future__ import annotations

import pytest

from src.engine.extraction.spec_producer import _untaught_exit
from src.engine.opening_range_lowering import lower_opening_range_definition

# --------------------------------------------------------------------------- #
# The measured sVkm risk model, verbatim from the byte-stable record.
# --------------------------------------------------------------------------- #
SVKM_STOP = {
    "transcript_quote": (
        "we're just going to put it at the bottom of the fair value candle. Really simple. "
        "If this candle had a big wick, then you would also include the wick."
    ),
    "anchor": "fvg_low",
    "buffer_atr": None,
    "atr_multiplier": None,
    "rationale": "The stop is placed at the extremity (body plus wick) of the FVG candle to allow room for price breathing.",
}
SVKM_TARGETS = [
    {
        "transcript_quote": "the fixed target we're looking for is a risk-to-reward ratio of two.",
        "priority": 1,
        "type": "r_multiple",
        "r_multiple": 2,
        "rationale": "The strategy uses a fixed mechanical target based on a 2:1 risk-to-reward ratio.",
    }
]


def _svkm() -> dict:
    return {"name": "5m_range_fvg_entry_1m", "stop": dict(SVKM_STOP), "targets": [dict(SVKM_TARGETS[0])]}


# --------------------------------------------------------------------------- #
# REPAIR A — §3 controls
# --------------------------------------------------------------------------- #

def test_A1_svkm_taught_stop_and_2R_is_not_untaught():
    """THE RED. The teacher taught an FVG-candle stop AND a fixed 2R; the
    producer must not stamp `house-default (trader taught none)` on him."""
    assert _untaught_exit(_svkm()) is False


def test_A2_concrete_values_removed_is_untaught():
    """Negative control: strip the concrete locator and the R value -- the same
    shape, same keys, must go back to untaught."""
    s = _svkm()
    s["stop"]["anchor"] = None
    s["targets"][0]["r_multiple"] = None
    assert _untaught_exit(s) is True


def test_A3_explicit_gestural_marker_still_untaught():
    s = _svkm()
    s["gestural_exit"] = True
    assert _untaught_exit(s) is True


def test_A4_taught_stop_only_is_taught():
    s = _svkm()
    s["targets"] = []
    assert _untaught_exit(s) is False


def test_A5_taught_target_only_is_taught():
    s = _svkm()
    s["stop"] = {"anchor": None}
    assert _untaught_exit(s) is False


def test_A6_legacy_level_representation_unchanged():
    """Backward compatibility: a record carrying the older `level` form keeps
    its previous classification in both directions."""
    assert _untaught_exit({"stop": {"level": 4321.5}, "targets": []}) is False
    assert _untaught_exit({"stop": {"level": None}, "targets": [{"level": None}]}) is True
    assert _untaught_exit({"stop": {"level": 1.0, "gestural": True}, "targets": []}) is True


def test_A7_type_or_rationale_alone_is_NOT_concrete():
    """§3: do not treat `type` alone, rationale text alone, or any arbitrary
    non-empty dict as concrete. This is the mutation control -- it fails if the
    predicate is loosened to 'the dict is non-empty'."""
    assert _untaught_exit({"stop": {"anchor": None, "rationale": "somewhere sensible"},
                           "targets": [{"priority": 1, "type": "r_multiple"}]}) is True
    assert _untaught_exit({"stop": {"anchor": "   "}, "targets": []}) is True
    # out-of-band r_multiple is not a declared concrete value (schema: 0.1..50)
    assert _untaught_exit({"stop": {"anchor": None},
                           "targets": [{"priority": 1, "type": "r_multiple", "r_multiple": 0}]}) is True
    # a bool must never satisfy the numeric r_multiple test
    assert _untaught_exit({"stop": {"anchor": None},
                           "targets": [{"priority": 1, "type": "r_multiple", "r_multiple": True}]}) is True


def test_A8_every_declared_anchor_enum_value_counts_as_taught():
    """The schema's anchor enum is the declared vocabulary of concrete stops."""
    for anchor in (
        "sweep_wick_below_entry", "sweep_wick_above_entry", "ob_low", "ob_high",
        "fvg_low", "fvg_high", "swing_low_below_entry", "swing_high_above_entry",
        "displacement_candle_low", "displacement_candle_high", "swing_after_sfp",
        "atr_multiple",
    ):
        assert _untaught_exit({"stop": {"anchor": anchor}, "targets": []}) is False, anchor


# --------------------------------------------------------------------------- #
# REPAIR B — §4 controls
# --------------------------------------------------------------------------- #

def _record(classification):
    return {
        "instrument_classification": classification,
        "strategies": [{"name": "s", "entry_sequence": [], "confluences": []}],
    }


def _lower(classification):
    return lower_opening_range_definition(
        source_spec_id="sVkmZklJDHI",
        source_condition_id="WAIT_SESSION:opening range#0",
        record=_record(classification),
        positive_control="test: the locators detect a market_open_anchor when one is supplied as a dict",
    )


def test_B1_string_classification_does_not_crash():
    """THE RED. The real extractor emits the STRING 'futures_primary'."""
    result = _lower("futures_primary")
    assert result is not None


def test_B2_dict_classification_still_contributes_its_anchor():
    """Positive control: the existing dict path must be untouched. A dict whose
    anchor span carries a clock+timezone still supplies the session start."""
    dict_result = _lower({"market_open_anchor": "the 9:30 a.m. Eastern open"})
    none_result = _lower(None)
    assert dict_result is not None and none_result is not None
    # The dict form must not be silently degraded to the no-classification form.
    assert repr(dict_result) != repr(none_result)


def test_B3_different_classification_strings_manufacture_no_anchor():
    """§4: do NOT parse 'futures_primary' into a fake clock/session anchor.
    Two different strings must produce the SAME (anchor-free) outcome."""
    assert repr(_lower("futures_primary")) == repr(_lower("equities_primary"))
    assert repr(_lower("futures_primary")) == repr(_lower(None))


def test_B4_missing_source_facts_still_refuse_rather_than_guess():
    """A record that teaches no opening range must still yield the existing
    honest incomplete/refusal state -- never a fabricated definition."""
    result = _lower("futures_primary")
    assert getattr(result, "definition", None) is None


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
