#!/usr/bin/env python3
"""Corpus-level False-Discovery-Rate report (Roadmap Band D, item D2 + D4).

PURPOSE
-------
The per-strategy gate battery (CPCV, PBO<15%, full-Bailey DSR, WFE>=0.70, B14
ci_high, B15, BIF) tells you whether ONE strategy is trustworthy. It cannot
tell you whether "12 of 200 passed" is a statistically honest population-level
claim. This script answers that question:

    - Reads the current strategy population's latest completed backtests.
    - Runs the pure D2 math in src/engine/statistics/corpus_fdr.py
      (Benjamini-Hochberg FDR, HLZ-style Sharpe haircut, per-family grouping,
      expected-false-discoveries against the null-calibration noise floor).
    - Extends every strategy's verdict row with whatever regime-stratified
      performance data actually exists (D4) — and NAMES the gap where the
      institutional 5-class regime breakdown does not exist, rather than
      fabricating one.
    - Writes a Markdown + JSON report to docs/corpus-fdr-reports/.

This script owns ALL the I/O (DB reads, calibration-report file read, report
file writes). The math it calls (src/engine/statistics/corpus_fdr.py) is
100% pure — no I/O, no clock, deterministic given the same inputs. That
separation is what makes the report replayable: re-running this script
against an unchanged DB snapshot + unchanged calibration report always
produces a byte-identical statistical verdict.

USAGE
-----
    # Standard run (reads DATABASE_URL, writes docs/corpus-fdr-reports/):
    python scripts/corpus-fdr-report.py

    # Point at a specific calibration report (defaults to
    # null_calibration_report.json in cwd, the null_gate_calibration.py default):
    python scripts/corpus-fdr-report.py --calibration-report null_calibration_report.json

    # Override the population-size used for the E[FD] noise-floor projection
    # (defaults to the number of strategies actually found with a completed
    # backtest — override when you want to project against the FULL planned
    # corpus size, e.g. 200, even though only 40 have backtests so far):
    python scripts/corpus-fdr-report.py --population-size 200

    # Research-triage vs promotion-relevant FDR levels (defaults 0.10 / 0.05
    # per docs/corpus-fdr-standard.md):
    python scripts/corpus-fdr-report.py --q-research 0.10 --q-promotion 0.05

OUTPUTS
-------
    docs/corpus-fdr-reports/<ISO-date>-corpus-fdr-report.json  — full machine-readable report
    docs/corpus-fdr-reports/<ISO-date>-corpus-fdr-report.md    — human-readable summary + tables
    (also prints the plain-English headline + noise-floor note to stdout)

GATE_VERDICT SOURCE (documented simplification — see docs/corpus-fdr-standard.md):
    A strategy's "did it pass the battery" signal is read from
    `backtests.tier` (already computed by the existing lifecycle/scoring
    pipeline): tier IN ('TIER_1','TIER_2','TIER_3') => passed_all_gates;
    tier IS NULL OR tier = 'REJECTED' => failed. This script does NOT
    re-derive gate logic — it consumes the existing tier classification
    read-only, exactly per the "consume existing interfaces read-only"
    constraint. The corpus-level report is a STATISTICAL LENS on top of
    that existing classification, not a second gate-decision authority.

EDUCATOR-FAMILY PROXY (documented gap — see docs/corpus-fdr-standard.md):
    There is no `educators` or `channels` table anywhere in the schema —
    no channel_id, no creator identity is persisted. The best available
    per-source grouping key is the EARLIEST `strategy_pending_mentions.source_url`
    for the bucket that graduated into each strategy (i.e. the specific
    source video/article, not necessarily every video from the same
    creator). This is a genuine coordination finding, not a design choice:
    a real `content_sources`/`educators` table with a channel_id would be
    the correct long-term fix and is out of scope for this Band-D pass
    (D2/D4 are statistics-layer work, not schema work).

ADVISORY LABEL: this report is ADVISORY ONLY. It does not gate promotion,
does not mutate any strategy's lifecycle_state, and writes ONLY to
docs/corpus-fdr-reports/ (file-only output). Per CLAUDE.md, classical gate
authority (lifecycle-service.ts) is never superseded by a corpus-level
statistical lens.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s corpus-fdr-report: %(message)s")
logger = logging.getLogger("corpus_fdr_report")

# Ensure repo root is importable when invoked as `python scripts/corpus-fdr-report.py`
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from src.engine.statistics.corpus_fdr import build_corpus_report  # noqa: E402

# ─── DB loader (psycopg2, same fail-soft pattern as gate_block_analyzer.py) ────

def load_strategy_population(
    db_connection_string: str | None = None,
) -> list[dict]:
    """Load the latest completed backtest per strategy, plus its best-available
    educator-family proxy (earliest bucket mention source_url).

    Falls back to [] (never raises) when:
      - DATABASE_URL is unset
      - psycopg2 is unavailable
      - the query fails for any reason

    Each returned dict matches the `build_corpus_report()` per-strategy contract:
        {
          "strategy_id": str, "educator_id": str | None,
          "gate_verdict": "passed_all_gates" | "failed",
          "battery_output": {"pbo_overall_p_value": float|None,
                              "wf_metadata": {"dsr": float|None,
                                               "dsr_pass": bool|None,
                                               "dsr_unavailable": bool}},
          "observed_sharpe": float | None,
          "mrp_regime_breakdown": dict | None,
        }
    """
    conn_str = db_connection_string or os.environ.get("DATABASE_URL", "")
    if not conn_str:
        logger.warning("DATABASE_URL not set; returning empty strategy population")
        return []

    try:
        import psycopg2  # type: ignore[import]
        import psycopg2.extras  # type: ignore[import]
    except ImportError:
        logger.warning("psycopg2 not available; returning empty strategy population")
        return []

    query = """
        WITH latest_backtest AS (
            SELECT DISTINCT ON (strategy_id)
                strategy_id, id AS backtest_id, tier, sharpe_ratio,
                walk_forward_results, mrp_regime_breakdown, created_at
            FROM backtests
            WHERE status = 'completed'
            ORDER BY strategy_id, created_at DESC
        ),
        earliest_mention AS (
            SELECT DISTINCT ON (spb.graduated_strategy_id)
                spb.graduated_strategy_id AS strategy_id,
                spm.source_url
            FROM strategy_pending_buckets spb
            JOIN strategy_pending_mentions spm ON spm.bucket_id = spb.id
            WHERE spb.graduated_strategy_id IS NOT NULL
            ORDER BY spb.graduated_strategy_id, spm.created_at ASC
        )
        SELECT
            s.id::text AS strategy_id,
            lb.tier,
            lb.sharpe_ratio::float AS sharpe_ratio,
            lb.walk_forward_results,
            lb.mrp_regime_breakdown,
            em.source_url AS educator_proxy_source_url
        FROM strategies s
        JOIN latest_backtest lb ON lb.strategy_id = s.id
        LEFT JOIN earliest_mention em ON em.strategy_id = s.id
        ORDER BY s.id;
    """

    try:
        conn = psycopg2.connect(conn_str)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(query)
        rows = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as exc:  # noqa: BLE001 — fail-soft by design, mirrors gate_block_analyzer.py
        logger.warning("DB query failed: %s", exc)
        return []

    records: list[dict] = []
    for row in rows:
        tier = row.get("tier")
        gate_verdict = "passed_all_gates" if tier in ("TIER_1", "TIER_2", "TIER_3") else "failed"

        wfr = row.get("walk_forward_results") or {}
        # walk_forward_results is stored as JSONB; psycopg2 returns it already
        # decoded to a dict (or None) — defend against string-encoded legacy rows.
        if isinstance(wfr, str):
            try:
                wfr = json.loads(wfr)
            except (json.JSONDecodeError, TypeError):
                wfr = {}

        mrp_breakdown = row.get("mrp_regime_breakdown")
        if isinstance(mrp_breakdown, str):
            try:
                mrp_breakdown = json.loads(mrp_breakdown)
            except (json.JSONDecodeError, TypeError):
                mrp_breakdown = None

        records.append({
            "strategy_id": row.get("strategy_id"),
            "educator_id": row.get("educator_proxy_source_url"),
            "gate_verdict": gate_verdict,
            "battery_output": {
                "pbo_overall_p_value": wfr.get("pbo_overall_p_value"),
                "wf_metadata": wfr.get("wf_metadata") or {},
            },
            "observed_sharpe": row.get("sharpe_ratio"),
            "mrp_regime_breakdown": mrp_breakdown,
        })

    logger.info("loaded %d strategies with a completed backtest", len(records))
    return records


def load_calibration_report(path: str) -> dict | None:
    """Load null_calibration_report.json. Returns None (not an error) if absent —
    corpus_fdr.expected_false_discoveries() has an explicit loud path for this."""
    p = Path(path)
    if not p.exists():
        logger.warning(
            "calibration report not found at %s — E[FD] will report "
            "NOISE FLOOR NOT YET MEASURED (this is the correct, honest behavior, "
            "not an error to suppress).",
            path,
        )
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("failed to parse calibration report at %s: %s — treating as unmeasured", path, exc)
        return None


# ─── Markdown rendering (pure formatting — no math) ───────────────────────────

def render_markdown(report: dict, generated_at_iso: str) -> str:
    lines: list[str] = []
    lines.append("# Corpus-Level False-Discovery-Rate Report")
    lines.append("")
    lines.append(f"**Generated:** {generated_at_iso}")
    lines.append("**Status:** ADVISORY ONLY — does not gate promotion, does not mutate lifecycle_state.")
    lines.append("")
    lines.append("## Plain-English Summary")
    lines.append("")
    lines.append(f"> {report['headline']}")
    lines.append(">")
    efd = report["expected_false_discoveries"]
    if efd.get("measured"):
        lines.append(
            f"> Out of {report['corpus_size']} strategies evaluated, "
            f"{report['n_gate_passed']} passed the per-strategy gate battery. "
            f"Given the measured battery false-pass rate of {efd['false_pass_rate']:.1%} "
            f"(from {efd.get('n_calibration_nulls', '?')} null-strategy calibration runs), "
            f"we'd expect about {efd['expected_false_discoveries']:.1f} passes BY CHANCE ALONE "
            f"even if every strategy in this corpus had zero real edge "
            f"(up to {efd['expected_false_discoveries_upper']:.1f} at the 95% CI upper bound). "
            f"Of the {report['n_gate_passed']} that passed, {report['n_bh_significant_at_q_promotion']} "
            f"are statistically distinguishable from that chance floor at the "
            f"q={report['q_promotion']:.2f} promotion-relevant FDR level."
        )
    else:
        lines.append(f"> {efd['message']}")
    lines.append("")

    lines.append("## Corpus Overview")
    lines.append("")
    lines.append(f"- Corpus size (strategies with a completed backtest): **{report['corpus_size']}**")
    lines.append(f"- Strategies with a usable p-value: **{report['n_with_pvalue']}**"
                  f" ({report['n_missing_pvalue']} excluded — no pbo_overall_p_value or usable DSR test statistic)")
    lines.append(f"- Gate-battery passes (tier != REJECTED, per backtests.tier): **{report['n_gate_passed']}**")
    lines.append(f"- BH-significant at q_promotion={report['q_promotion']:.2f}: "
                  f"**{report['n_bh_significant_at_q_promotion']}**")
    lines.append(f"- Excess over chance: **{report['excess_over_chance']}**"
                  + ("" if report["excess_over_chance"] is not None else f"  ({report['excess_note']})"))
    lines.append("")

    lines.append("## Expected False Discoveries")
    lines.append("")
    if efd.get("measured"):
        lines.append(f"- Measured full-battery false-pass rate: **{efd['false_pass_rate']:.1%}** "
                      f"(gate_battery_version={efd.get('gate_battery_version')})")
        lines.append(f"- E[FD] point estimate: **{efd['expected_false_discoveries']:.2f}**")
        lines.append(f"- E[FD] at 95% CI upper bound: **{efd['expected_false_discoveries_upper']:.2f}**")
    else:
        lines.append(f"- **{efd['message']}**")
    lines.append("")

    lines.append("## Per-Educator-Family Table")
    lines.append("")
    lines.append("| educator_id (source-video proxy) | n strategies | n with p-value | "
                  f"BH-rejected @ q_promotion={report['q_promotion']:.2f} |")
    lines.append("|---|---|---|---|")
    fam = report["fdr_promotion"]["per_family"]
    for _key, f in sorted(fam.items(), key=lambda kv: (-kv[1]["n_strategies"], str(kv[0]))):
        label = f["educator_id"] if f["educator_id"] else "(unresolved / no source)"
        lines.append(f"| {label} | {f['n_strategies']} | {f['n_with_pvalue']} | {f['bh']['num_rejected']} |")
    lines.append("")

    lines.append("## Per-Strategy Verdicts")
    lines.append("")
    lines.append("| strategy_id | gate_verdict | p_value | p_source | "
                  f"BH-sig @ q={report['q_promotion']:.2f} | corpus_verdict | haircut_sharpe |")
    lines.append("|---|---|---|---|---|---|---|")
    for row in report["per_strategy"]:
        p = f"{row['p_value']:.4f}" if row["p_value"] is not None else "—"
        bh_sig = row["bh_significant_at_q_promotion"]
        bh_sig_str = "—" if bh_sig is None else ("YES" if bh_sig else "no")
        haircut = row["sharpe_haircut"]
        haircut_str = f"{haircut['haircut_sharpe']:.2f}" if haircut else "—"
        lines.append(
            f"| {row['strategy_id']} | {row['gate_verdict']} | {p} | {row['p_value_source']} | "
            f"{bh_sig_str} | {row['corpus_verdict']} | {haircut_str} |"
        )
    lines.append("")

    lines.append("## Regime-Attribution Gap (D4)")
    lines.append("")
    if report["per_strategy"]:
        gap_note = report["per_strategy"][0]["regime_breakdown"]["institutional_5class_gap"]
        lines.append(f"> {gap_note}")
    lines.append("")

    lines.append("---")
    lines.append("*See docs/corpus-fdr-standard.md for the decision rules governing q-levels, "
                  "the floor-relative-then-FDR composition rule, and the standing requirement "
                  "that population-level claims cite this report rather than raw pass counts.*")
    return "\n".join(lines)


# ─── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Corpus-level FDR report (Band D, D2+D4)")
    parser.add_argument("--calibration-report", default="null_calibration_report.json",
                         help="Path to null_calibration_report.json (default: ./null_calibration_report.json)")
    parser.add_argument("--population-size", type=int, default=None,
                         help="Override population size for E[FD] projection (default: corpus_size found)")
    parser.add_argument("--q-research", type=float, default=None,
                         help="Research-triage FDR level (default: env CORPUS_FDR_Q_RESEARCH or 0.10)")
    parser.add_argument("--q-promotion", type=float, default=None,
                         help="Promotion-relevant FDR level (default: env CORPUS_FDR_Q_PROMOTION or 0.05)")
    parser.add_argument("--output-dir", default="docs/corpus-fdr-reports",
                         help="Output directory (default: docs/corpus-fdr-reports)")
    args = parser.parse_args()

    records = load_strategy_population()
    calibration = load_calibration_report(args.calibration_report)

    population_size = args.population_size if args.population_size is not None else len(records)

    report = build_corpus_report(
        records,
        calibration_report=calibration,
        q_research=args.q_research,
        q_promotion=args.q_promotion,
    )
    # E[FD] inside build_corpus_report() used corpus_size == len(records); if the
    # operator wants to project against a larger PLANNED corpus (e.g. 200 when
    # only 40 have backtests so far), recompute E[FD] against population_size
    # and surface both so the report never silently swaps the denominator.
    if population_size != len(records):
        from src.engine.statistics.corpus_fdr import expected_false_discoveries
        report["expected_false_discoveries_at_planned_population"] = expected_false_discoveries(
            population_size, calibration
        )

    generated_at = datetime.now(UTC).isoformat()
    date_stamp = datetime.now(UTC).strftime("%Y-%m-%d")

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    json_path = out_dir / f"{date_stamp}-corpus-fdr-report.json"
    md_path = out_dir / f"{date_stamp}-corpus-fdr-report.md"

    payload = {"generated_at": generated_at, **report}
    json_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8", newline="\n")
    md_path.write_text(render_markdown(report, generated_at), encoding="utf-8")

    print(f"\nCorpus FDR report written to {json_path} and {md_path}")
    print(f"\n{report['headline']}\n")
    efd = report["expected_false_discoveries"]
    if not efd.get("measured"):
        print(efd["message"])


if __name__ == "__main__":
    main()
