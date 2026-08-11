from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PINE = ROOT / "pine" / "slumdawg_platform_parity_v0_21_3_restored_5m_map_decoupled_tp_probe.pine"
SOURCE = PINE.read_text(encoding="utf-8")


class PineV0213RestoredMapDecoupledTpContractTests(unittest.TestCase):
    def test_version_and_safety_lock(self):
        self.assertIn("v0.21.3 — RESTORED 5M MAP BRIDGE + DECOUPLED REACTION PROBE", SOURCE)
        self.assertIn("const bool LIVE_DECISION_SUPPORT_APPROVED = false", SOURCE)

    def test_restores_last_visually_proven_completed_day_week_bridge(self):
        self.assertIn('[dHighCurrent, dLowCurrent, dCloseTimeCurrent] = request.security(syminfo.tickerid, "D", [high, low, time_close]', SOURCE)
        self.assertIn('[dHighPrev, dLowPrev] = request.security(syminfo.tickerid, "D", [high[1], low[1]]', SOURCE)
        self.assertIn('[wHighCurrent, wLowCurrent, wCloseTimeCurrent] = request.security(syminfo.tickerid, "W", [high, low, time_close]', SOURCE)
        self.assertIn('[wHighPrev, wLowPrev] = request.security(syminfo.tickerid, "W", [high[1], low[1]]', SOURCE)
        self.assertIn("dailyCurrentCompletedNow", SOURCE)
        self.assertIn("weeklyCurrentCompletedNow", SOURCE)
        self.assertIn('plot(pdh, "PDH data", display = display.none)', SOURCE)
        self.assertIn('plot(pwh, "PWH data", display = display.none)', SOURCE)

    def test_restores_visually_proven_time_price_renderer(self):
        self.assertIn("xloc = xloc.bar_time", SOURCE)
        self.assertIn("line.set_xy1(id, time, price)", SOURCE)
        self.assertIn("line.set_xy2(id, time_close, price)", SOURCE)
        self.assertIn("line.set_extend(id, extend.both)", SOURCE)
        self.assertNotIn("xloc = xloc.bar_index", SOURCE)

    def test_long_reaction_probe_is_separate_from_full_zone_geometry(self):
        self.assertIn("float reactionProbeLong = math.max(open[i], close[i])", SOURCE)
        self.assertIn("float zLoLong = math.min(open[i], close[i])", SOURCE)
        self.assertIn("float zHiLong = high[i]", SOURCE)
        self.assertIn("f_reaction_down_strength(i, tpReactionConfirmBars, reactionProbeLong)", SOURCE)

    def test_short_reaction_probe_is_separate_from_full_zone_geometry(self):
        self.assertIn("float reactionProbeShort = math.min(open[i], close[i])", SOURCE)
        self.assertIn("float zLoShort = low[i]", SOURCE)
        self.assertIn("float zHiShort = math.max(open[i], close[i])", SOURCE)
        self.assertIn("f_reaction_up_strength(i, tpReactionConfirmBars, reactionProbeShort)", SOURCE)

    def test_no_threshold_was_lowered_to_force_a_target(self):
        self.assertIn('tpMinReactionDisplacementAtr = input.float(0.75', SOURCE)
        self.assertIn('tpMinTouches5 = input.int(2', SOURCE)

    def test_live_5m_rescan_and_first_shelf_numbering_remain(self):
        rescan = SOURCE.index("[l5live_1lo")
        numbering = SOURCE.index("[longTp1, longTp1Lo, longTp1Hi]")
        self.assertLess(rescan, numbering)
        self.assertIn("displayedLongEntry, displayedShortEntry, longFirstGap, shortFirstGap", SOURCE)

    def test_structural_and_live_ratchets_remain_locked(self):
        self.assertIn("autoLongCandidate > lockedLongEntry", SOURCE)
        self.assertIn("autoShortCandidate < lockedShortEntry", SOURCE)
        self.assertIn("side == 1 ? math.max(prior, candidate) : math.min(prior, candidate)", SOURCE)

    def test_platform_diagnostics_distinguish_data_zone_and_target_layers(self):
        self.assertIn('string mapDiag = "D:"', SOURCE)
        self.assertIn('" L5:" + (not na(l5live_1) ? "ZONE" : "NONE")', SOURCE)
        self.assertIn('" LTP:" + (longTp1Set ? "OK" : "EMPTY")', SOURCE)


if __name__ == "__main__":
    unittest.main()
