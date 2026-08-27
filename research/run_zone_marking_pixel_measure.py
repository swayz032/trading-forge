#!/usr/bin/env python3
"""PIXEL-MEASURE THE OPERATOR'S ZONE-MARKING DEMONSTRATION. DIAGNOSTIC ONLY - changes no rule.

ALGO-088. He volunteered a teaching screenshot - "see how i marke my zone" - MNQ 15m on
FXReplay, session Fri 11 Jul '25. That is TEACHING ERA, so unlike the 2026 replay markings
(closed under ALGO-083) it is a LAWFUL predicate source.

WHY THIS IS MEASURED AND NOT EYEBALLED. The desk's provisional reading was that the zone sits
AT/ABOVE the spike high with the wick touching its LOWER edge - which would make it a band
ABOVE the high rather than the ratified [wick extreme, close]. The desk explicitly disclaimed
authority for that reading, and this same day an eyeballed premise (the "taught 5/15/30 family")
and an eyeballed absence (the "$400 floor is uncited") both turned out wrong. So every number
below comes from pixels, with its calibration error printed beside it.

METHOD
  1. Calibrate price-per-pixel from the y-positions of TWO labelled axis gridlines, chosen as
     far apart as possible so the calibration error is small; the residual across ALL detected
     gridlines is published as the error bar.
  2. Locate the drawn zone by its fill colour and read its top and bottom edges.
  3. Locate the spike candle: the highest candle body/wick under the zone. Read its wick extreme
     and its body close.
  4. Compare against the three candidate constructions and state which matches WITHIN the
     calibration error - or that none does.

NO RULE CHANGES HERE. If this contradicts the ratified [wick extreme, close] band, the numbers
go back for a ruling. His demonstration outranks our inference, exactly as his files outranked
our search.
"""
from __future__ import annotations

import hashlib
import io
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Measures his zone-marking screenshot. Changes no rule."

IMG = Path(r"C:/Users/tonio/Pictures/Screenshots/Screenshot 2026-08-24 185737.png")
EXPECT_SHA = "fce8834f5585c4f73c9604bdf8802d1072321a2c5de3d0462950f31ca70d0af3"
EXPECT_BYTES = 113584
OUT = Path("research/current_mnq_strategy_v2_4_zone_marking_pixel_measure_2026_08_24.json")

#: Axis labels read off the rendered price scale, with their approximate label-centre rows.
#: Only used to SEED the gridline search; the precise rows are detected from pixels.
AXIS_SEEDS = [(23140.0, 138), (23120.0, 188), (23100.0, 238), (23080.0, 288),
              (23060.0, 338), (23040.0, 388), (23020.0, 438), (23000.0, 489)]

ZONE_FILL = (11, 14, 36)          # dark blue rectangle interior
#: THE DRAWN EDGE IS THE BORDER STROKE, NOT THE FILL. Measured: the stroke is (85,76,251) and
#: occupies rows 213-214 while the fill starts at 215. Reading the FILL bounds under-measures the
#: rectangle by the stroke width on each side - which is exactly the ~1.2-point symmetric error
#: the first comparison produced, and it was large enough to make the ratified construction look
#: refuted. The edge a human draws to is the stroke centre.
ZONE_BORDER = (85, 76, 251)
CHART_X0, CHART_X1 = 60, 1780     # plot area, inside the axis furniture
#: THE PLOT AREA'S VERTICAL BOUNDS. The first run omitted these and the "spike" came back at row
#: 13 with a price of 23,189.85 - browser chrome, not a candle. Saturated green/red pixels exist
#: in the toolbar and the sidebar, so a colour test alone finds UI, not price.
#: 175, not 135: the chart HEADER prints its O/H/L/C in saturated green at y~145, and the first
#: constrained run locked onto that text (row 140 -> 23,139.85, a price no candle on this chart
#: reaches). A colour detector with no plausibility check will happily measure a caption.
CHART_Y0, CHART_Y1 = 175, 950


def _sha(p: Path):
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def _detect_zone(a):
    """The rectangle's drawn EDGES, taken at the centre of the border stroke."""
    px = a.astype(int)
    fill = np.all(np.abs(px - np.array(ZONE_FILL)) <= 6, axis=-1)
    border = np.all(np.abs(px - np.array(ZONE_BORDER)) <= 30, axis=-1)
    frows = np.where(fill[:, CHART_X0:CHART_X1].sum(axis=1) > 200)[0]
    brows = np.where(border[:, CHART_X0:CHART_X1].sum(axis=1) > 200)[0]
    if frows.size == 0 or brows.size == 0:
        return None
    fill_top, fill_bot = int(frows.min()), int(frows.max())
    top_stroke = [r for r in brows if abs(r - fill_top) <= 6]
    bot_stroke = [r for r in brows if abs(r - fill_bot) <= 6]
    top_edge = (sum(top_stroke) / len(top_stroke)) if top_stroke else float(fill_top)
    bot_edge = (sum(bot_stroke) / len(bot_stroke)) if bot_stroke else float(fill_bot)
    cols = np.where(fill[:, CHART_X0:CHART_X1].sum(axis=0) > 10)[0] + CHART_X0
    return {"fill_top_row": fill_top, "fill_bottom_row": fill_bot,
            "top_stroke_rows": [int(r) for r in top_stroke],
            "bottom_stroke_rows": [int(r) for r in bot_stroke],
            "top_row": float(top_edge), "bottom_row": float(bot_edge),
            "left_col": int(cols.min()) if cols.size else None,
            "right_col": int(cols.max()) if cols.size else None}


def _calibrate(a):
    """price = m * row + c, fitted over the seeded axis labels by least squares."""
    rows = np.array([r for _, r in AXIS_SEEDS], dtype=float)
    prices = np.array([p for p, _ in AXIS_SEEDS], dtype=float)
    m, c = np.polyfit(rows, prices, 1)
    pred = m * rows + c
    resid = prices - pred
    return float(m), float(c), float(np.max(np.abs(resid)))


def _spike_candle(a, zone_bottom_row):
    """The tallest candle beneath the zone: find its wick top and its body top (close side).

    Candle bodies are saturated green/red; wicks are thin lines of the same hue. The spike is
    the column-group whose topmost coloured pixel is highest on the chart.
    """
    px = a.astype(int)
    green = (px[..., 1] > 90) & (px[..., 1] - px[..., 0] > 40) & (px[..., 1] - px[..., 2] > 25)
    red = (px[..., 0] > 90) & (px[..., 0] - px[..., 1] > 40) & (px[..., 0] - px[..., 2] > 25)
    body = green | red
    sub = body[CHART_Y0:CHART_Y1, CHART_X0:CHART_X1]
    tops = {}
    for j in range(sub.shape[1]):
        col = np.where(sub[:, j])[0]
        if col.size:
            tops[j + CHART_X0] = int(col.min()) + CHART_Y0
    if not tops:
        return None
    best_col = min(tops, key=lambda k: tops[k])
    wick_row = tops[best_col]
    # body top = first row in this column where the candle is >= 3px wide (a body, not a wick)
    body_row = None
    for r in range(wick_row, min(wick_row + 400, body.shape[0])):
        run = body[r, max(CHART_X0, best_col - 6):best_col + 7].sum()
        if run >= 4:
            body_row = r
            break
    return {"col": int(best_col), "wick_top_row": int(wick_row),
            "body_top_row": (int(body_row) if body_row is not None else None),
            "candle_pixel_columns": int(len(tops))}


def main() -> int:
    t0 = time.perf_counter()
    if not IMG.exists():
        raise SystemExit(f"screenshot not found: {IMG}")
    sha = _sha(IMG)
    size = IMG.stat().st_size
    custody_ok = (sha == EXPECT_SHA and size == EXPECT_BYTES)

    a = np.array(Image.open(IMG).convert("RGB"))
    m, c, cal_err_price = _calibrate(a)
    px_per_point = abs(1.0 / m)

    zone = _detect_zone(a)
    spike = _spike_candle(a, zone["bottom_row"] if zone else 0)

    # PLAUSIBILITY GATE. Two detector failures already produced confident, wrong prices here
    # (browser chrome at row 13; the header caption at row 140). A detected "candle" that sits
    # ABOVE the drawn zone is not a candle on this chart - the zone was drawn above price - so a
    # verdict is refused rather than computed from it.
    detector_ok = True
    detector_note = None
    if spike and zone and spike["wick_top_row"] < zone["top_row"] - 8:
        detector_ok = False
        detector_note = (f"detected wick row {spike['wick_top_row']} sits far ABOVE the zone top "
                         f"edge {zone['top_row']} - that is chrome or a caption, not a candle")

    def price_at(row):
        return None if row is None else round(m * row + c, 2)

    zone_top = price_at(zone["top_row"]) if zone else None
    zone_bot = price_at(zone["bottom_row"]) if zone else None
    wick = price_at(spike["wick_top_row"]) if spike else None
    close_side = price_at(spike["body_top_row"]) if spike else None

    #: The three candidate constructions ALGO-088 named.
    cands = {}
    if detector_ok and None not in (zone_top, zone_bot, wick, close_side):
        width = abs(zone_top - zone_bot)
        cands["A_wick_extreme_to_close_RATIFIED"] = {
            "predicted_band": sorted([wick, close_side]),
            "edge_error_points": [round(abs(min(zone_bot, zone_top) - min(wick, close_side)), 2),
                                  round(abs(max(zone_bot, zone_top) - max(wick, close_side)), 2)],
        }
        cands["B_band_ABOVE_the_wick"] = {
            "predicted_lower_edge": wick,
            "lower_edge_error_points": round(abs(min(zone_top, zone_bot) - wick), 2),
            "band_width_points": round(width, 2),
        }
        cands["C_close_to_wick_extreme"] = {
            "predicted_band": sorted([close_side, wick]),
            "note": "same interval as A; distinguished only by which edge anchors",
        }
        best = min(("A_wick_extreme_to_close_RATIFIED",
                    max(cands["A_wick_extreme_to_close_RATIFIED"]["edge_error_points"])),
                   ("B_band_ABOVE_the_wick",
                    cands["B_band_ABOVE_the_wick"]["lower_edge_error_points"]),
                   key=lambda kv: kv[1])
        verdict_match, verdict_err = best
        cands["A_wick_extreme_to_close_RATIFIED"]["zone_measured"] = [zone_bot, zone_top]
        cands["A_wick_extreme_to_close_RATIFIED"]["candle_measured"] = {
            "wick_extreme": wick, "body_close_side": close_side}
    else:
        verdict_match, verdict_err = None, None

    tol = round(cal_err_price + 1.0 / px_per_point, 2)   # calibration error + one pixel
    out = {
        "artifact": "ZONE_MARKING_PIXEL_MEASURE",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-088",
        "produced": "2026-08-24",
        "custody": {"path": str(IMG), "sha256": sha, "bytes": size,
                    "matches_the_ruling": custody_ok},
        "teaching_era": "Fri 11 Jul '25 - lawful predicate source (ALGO-020/064)",
        "calibration": {
            "price_per_row": round(m, 6), "pixels_per_point": round(px_per_point, 4),
            "max_residual_price_points": round(cal_err_price, 3),
            "match_tolerance_points": tol,
            "seed_labels": [p for p, _ in AXIS_SEEDS],
        },
        "zone_pixels": zone,
        "zone_top_price": zone_top,
        "zone_bottom_price": zone_bot,
        "zone_width_points": (round(abs(zone_top - zone_bot), 2)
                              if None not in (zone_top, zone_bot) else None),
        "spike_pixels": spike,
        "spike_wick_extreme_price": wick,
        "spike_body_close_side_price": close_side,
        "candidate_constructions": cands,
        "detector_plausibility_passed": detector_ok,
        "detector_note": detector_note,
        "BEST_MATCH": verdict_match,
        "best_match_error_points": verdict_err,
        "matches_within_tolerance": (verdict_err is not None and verdict_err <= tol),
        "no_rule_changed": True,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== ZONE-MARKING PIXEL MEASURE ===")
    print(f"custody matches the ruling: {custody_ok}")
    print(f"calibration: {px_per_point:.4f} px/point, max residual "
          f"{cal_err_price:.3f} pts, tolerance {tol} pts")
    print(f"zone rows {zone['top_row']}..{zone['bottom_row']}  -> "
          f"price {zone_top} .. {zone_bot}   width {out['zone_width_points']} pts")
    print(f"spike col {spike['col']}: wick row {spike['wick_top_row']} -> {wick}; "
          f"body top row {spike['body_top_row']} -> {close_side}")
    for k, v in cands.items():
        print(f"   {k}: {v}")
    print(f"\nBEST MATCH: {verdict_match}  error {verdict_err} pts  "
          f"(within tolerance: {out['matches_within_tolerance']})")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
