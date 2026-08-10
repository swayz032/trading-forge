import unittest
from pathlib import Path


PINE = Path("indicator/pine/slumdawg_platform_parity_v0_17_auto_direction_entry_state_robust_tp.pine")


class PineV017AutoDirectionEntryTpContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = PINE.read_text(encoding="utf-8")

    def test_big_direction_and_plan_default_to_auto(self):
        self.assertIn('directionMode = input.string("AUTO"', self.src)
        self.assertIn('planMode = input.string("AUTO"', self.src)
        self.assertIn('request.security(syminfo.tickerid, "D", f_structure_dir()', self.src)
        self.assertIn('request.security(syminfo.tickerid, "240", f_structure_dir()', self.src)
        self.assertIn('request.security(syminfo.tickerid, "60", f_structure_dir()', self.src)
        self.assertIn('weightedDirectionScore = dDir * 2 + h4Dir * 3 + h1Dir', self.src)

    def test_current_move_is_automatic_15m_structural_leg(self):
        self.assertIn('request.security(syminfo.tickerid, "15", f_current_leg_dir()', self.src)
        self.assertIn('currentMoveDir = m15LegDir != 0 ? m15LegDir : m15StructDir', self.src)
        self.assertIn('autoPlanDir = currentMoveDir != 0 ? currentMoveDir : bigDir', self.src)
        self.assertIn('UP PULLBACK', self.src)
        self.assertIn('DOWN PULLBACK', self.src)

    def test_entry_close_arms_reference_but_does_not_immediately_ready(self):
        self.assertIn('barstate.isconfirmed and close > longEntry', self.src)
        self.assertIn('barstate.isconfirmed and close < shortEntry', self.src)
        self.assertIn('entryStage := "WAIT_BREAK"', self.src)
        self.assertIn('entryStage := "BREAK"', self.src)
        self.assertIn('entryStage := "PUSH_1"', self.src)
        self.assertIn('entryStage := "ENTRY_READY"', self.src)
        proof_section = self.src.split('if entryStage == "WAIT_PROOF"', 1)[1].split('else if entryStage == "WAIT_BREAK"', 1)[0]
        self.assertNotIn('ENTRY_READY', proof_section)

    def test_failed_candle_rolls_reference_and_recoil_resets(self):
        self.assertIn('REFERENCE ROLLED', self.src)
        self.assertIn('referencePrice := armedSide == 1 ? high : low', self.src)
        self.assertIn('RECOIL RESET', self.src)
        self.assertIn('proofChanged', self.src)
        self.assertIn('CONTEXT RESET', self.src)

    def test_active_yellow_line_moves_to_reference_after_proof(self):
        self.assertIn('displayedLongEntry = armedSide == 1', self.src)
        self.assertIn('displayedShortEntry = armedSide == -1', self.src)
        self.assertIn('displayedLongEntry, "🟢 LONG - ENTRY ZONE"', self.src)
        self.assertIn('displayedShortEntry, "🔴 SHORT - ENTRY ZONE"', self.src)

    def test_tp_uses_both_high_and_low_reaction_points(self):
        self.assertIn('bool localLow =', self.src)
        self.assertIn('bool localHigh =', self.src)
        self.assertIn('array.push(zoneLos, zLo)', self.src)
        self.assertIn('TP_LOOKBACK_BARS = 320', self.src)
        self.assertIn('TP_MAX_REACTIONS = 48', self.src)

    def test_tp_is_inside_cluster_not_on_edge(self):
        self.assertIn('tpPenetrationFraction', self.src)
        self.assertIn('l1Lo + (l1Hi - l1Lo) * tpPenetrationFraction', self.src)
        self.assertIn('s1Hi - (s1Hi - s1Lo) * tpPenetrationFraction', self.src)
        self.assertNotIn('shortTp1Set ? f_round_up_tick(shortTp1Hi)', self.src)
        self.assertNotIn('longTp1Set ? f_round_down_tick(longTp1Lo)', self.src)

    def test_tp2_and_tp3_are_separate_clusters(self):
        self.assertIn('f_pick_short_cluster(zoneLos, zoneHis, na(s1Lo) ? shortBoundary : s1Lo, zoneGap', self.src)
        self.assertIn('f_pick_long_cluster(zoneLos, zoneHis, na(l1Hi) ? longBoundary : l1Hi, zoneGap', self.src)
        self.assertIn('🎯 TAKE PROFIT ZONE 2', self.src)
        self.assertIn('🎯 TAKE PROFIT ZONE 3', self.src)
        self.assertIn(' / TP2 ', self.src)

    def test_panel_keeps_branding_and_no_manual_not_set_default(self):
        self.assertIn('🤖 SLUMDAWG TRADERS', self.src)
        self.assertIn('📈 UP', self.src)
        self.assertIn('📉 DOWN', self.src)
        self.assertIn('✅ ENTRY READY', self.src)
        self.assertIn('AUTO DIR + ENTRY STATE + CLUSTER TP', self.src)
        self.assertIn('LIVE_DECISION_SUPPORT_APPROVED = false', self.src)


if __name__ == "__main__":
    unittest.main()
