"""Source-level safety contracts for platform ports.

These tests are intentionally narrow. They do NOT compile Pine or prove runtime parity.
They prevent high-risk classification/safety semantics from silently drifting while the
real TradingView compile/runtime gate remains manual and evidence-backed.
"""
from pathlib import Path
import re
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]
PINE_PORT = REPO_ROOT / "indicator" / "pine" / "slumdawg_platform_parity_v0_1.pine"


class PinePortSafetyContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = PINE_PORT.read_text(encoding="utf-8")

    def test_port_is_explicit_pine_v6_indicator(self):
        self.assertIn("//@version=6", self.source)
        self.assertRegex(self.source, r"\bindicator\(")
        self.assertNotRegex(self.source, r"\bstrategy\(")

    def test_live_approval_is_hardcoded_false(self):
        self.assertRegex(
            self.source,
            r"const bool LIVE_DECISION_SUPPORT_APPROVED\s*=\s*false",
        )
        self.assertIn('const string BUILD_CLASSIFICATION = "PLATFORM_PARITY_ONLY"', self.source)

    def test_parity_engine_defaults_disabled(self):
        self.assertRegex(
            self.source,
            r'input\.bool\(false,\s*"Enable uncalibrated parity engine"',
        )

    def test_debug_alerts_are_labeled_non_actionable(self):
        alert_lines = [line for line in self.source.splitlines() if "alertcondition(" in line]
        self.assertGreaterEqual(len(alert_lines), 1)
        for line in alert_lines:
            self.assertIn("NON-ACTIONABLE", line)

    def test_forbidden_automatic_trendline_flip_semantic_is_absent(self):
        # The parity port accepts OVERALL direction as context input. It must not contain
        # a rule that infers overall/intraday direction from crossing a red trendline.
        lowered = self.source.lower()
        self.assertNotIn("trendline_cross", lowered)
        self.assertNotIn("red_line_cross", lowered)

    def test_prior_completed_daily_and_weekly_requests_are_present(self):
        self.assertIn('request.security(syminfo.tickerid, "D", high[1]', self.source)
        self.assertIn('request.security(syminfo.tickerid, "D", low[1]', self.source)
        self.assertIn('request.security(syminfo.tickerid, "W", high[1]', self.source)
        self.assertIn('request.security(syminfo.tickerid, "W", low[1]', self.source)
        self.assertGreaterEqual(self.source.count("lookahead = barmerge.lookahead_on"), 4)

    def test_required_fail_closed_reason_codes_are_source_locked(self):
        for code in (
            "WRONG_SYMBOL",
            "WRONG_EXECUTION_TIMEFRAME",
            "UNEXPECTED_TICK_GRID",
            "PROOF_LEVEL_NOT_SET",
            "OFF_TICK_GRID_PROOF",
            "LIVE_FEED_NOT_ATTESTED_REALTIME",
            "PARITY_ENGINE_DISABLED",
            "HISTORICAL_INTRABAR_ORDER_UNKNOWN",
        ):
            self.assertIn(code, self.source)

    def test_one_update_stage_chain_uses_mutually_exclusive_branches(self):
        # Source-level guard only: the three forward-stage blocks must be a single
        # if / else-if chain. Actual semantic parity is a separate runtime gate.
        normalized = re.sub(r"\s+", " ", self.source)
        pattern = (
            r"if recoilEligible and recoil >= maxRecoil .*?"
            r"else if stage == STAGE_WAIT_BREAK .*?"
            r"else if stage == STAGE_BREAK .*?"
            r"else if stage == STAGE_PUSH_1"
        )
        self.assertRegex(normalized, pattern)


if __name__ == "__main__":
    unittest.main()
