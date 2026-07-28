"""
generate_session_windows_parity_fixture.py — regenerates the frozen TS-side
answers used by test_session_windows_parity.py.

WHY A FROZEN FIXTURE RATHER THAN CALLING NODE FROM THE TEST: a pytest that
shells out to `npx tsx` is unrunnable wherever Node is absent, and a test that
silently SKIPS is a non-biter. So the TS side is evaluated ONCE, here, by
importing the REAL `src/server/lib/killzone.ts` (never a reimplementation), and
the answers are committed. The test then runs pure-Python and always executes.

WHAT KEEPS THE FIXTURE HONEST: the sha256 of killzone.ts is recorded INTO the
fixture, and the test asserts it still matches the live file. If killzone.ts
changes, the test FAILS telling you to re-run this script — the fixture cannot
silently go stale and keep reporting parity against a file that no longer
exists in that form.

USAGE:  python src/engine/tests/generate_session_windows_parity_fixture.py
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[3]
KILLZONE_TS = REPO / "src" / "server" / "lib" / "killzone.ts"
FIXTURE = REPO / "src" / "engine" / "tests" / "fixtures" / "session_windows_parity.json"

sys.path.insert(0, str(REPO))
from src.engine import session_windows as sw  # noqa: E402

ET = ZoneInfo("America/New_York")
ZONES = ("london", "ny_am", "ny_pm", "silver_bullet", "macro_window")

# The fixture is DERIVED FROM THE WINDOW GRAMMAR, not collected from examples:
# every minute of four ET days -- an ordinary EST day, an ordinary EDT day, and
# BOTH DST transition days -- plus second-level probes either side of every
# declared boundary, which is where an off-by-one between two implementations of
# the same spec actually lives.
DAYS = ("2026-01-14", "2026-07-15", "2026-03-08", "2026-11-01")

DRIVER_TS = """
import { readFileSync, writeFileSync } from "node:fs";
async function main() {
  const { pathToFileURL } = await import("node:url");
  const kz = await import(pathToFileURL(process.argv[2]).href);
  const stamps = JSON.parse(readFileSync(process.argv[3], "utf-8"));
  const ZONES = ["london", "ny_am", "ny_pm", "silver_bullet", "macro_window"];
  const out = {};
  for (const s of stamps) {
    const d = new Date(s);
    out[s] = ZONES.map((z) => (kz.isInKillzone(d, z) ? "1" : "0")).join("");
  }
  writeFileSync(process.argv[4], JSON.stringify(out), "utf-8");
}
void main();
"""


def killzone_digest() -> str:
    """sha256 of killzone.ts with newlines NORMALISED.

    Hashing raw bytes would make the digest line-ending dependent: a checkout
    with core.autocrlf=true produces a different hash for a semantically
    identical file, firing the staleness guard with a misleading "killzone.ts
    has changed" message. A guard that cries wolf on a checkout setting trains
    people to regenerate reflexively, which is how a real change slips through.
    Must stay identical to the digest in test_session_windows_parity.py.
    """
    return hashlib.sha256(
        KILLZONE_TS.read_bytes().replace(b"\r\n", b"\n")
    ).hexdigest()


def boundary_minutes() -> list[int]:
    return sorted(
        {
            sw.LONDON_START_MIN, sw.LONDON_END_MIN,
            sw.NY_AM_START_MIN, sw.NY_AM_END_MIN,
            sw.NY_PM_START_MIN, sw.NY_PM_END_MIN,
            sw.SB_WINDOW_1_START, sw.SB_WINDOW_1_END,
            sw.SB_WINDOW_2_START, sw.SB_WINDOW_2_END,
            sw.SB_WINDOW_3_START, sw.SB_WINDOW_3_END,
            sw.MW_WINDOW_1_START, sw.MW_WINDOW_1_END,
            sw.MW_WINDOW_2_START, sw.MW_WINDOW_2_END,
            sw.MW_WINDOW_3_START, sw.MW_WINDOW_3_END,
        }
    )


def build_stamps() -> list[str]:
    stamps: list[str] = []
    for day in DAYS:
        base = datetime.fromisoformat(day + "T00:00:00").replace(tzinfo=ET)
        for minute in range(1440):
            stamps.append((base + timedelta(minutes=minute)).astimezone(UTC).isoformat())
        for edge in boundary_minutes():
            for offset in (-1, 0, 1):
                stamps.append(
                    (base + timedelta(minutes=edge, seconds=offset)).astimezone(UTC).isoformat()
                )
    return list(dict.fromkeys(stamps))


def main() -> int:
    stamps = build_stamps()
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "driver.ts").write_text(DRIVER_TS, encoding="utf-8")
        (tmp_path / "stamps.json").write_text(json.dumps(stamps), encoding="utf-8")
        result = subprocess.run(
            ["npx", "tsx", str(tmp_path / "driver.ts"), str(KILLZONE_TS),
             str(tmp_path / "stamps.json"), str(tmp_path / "out.json")],
            capture_output=True, text=True, shell=True, cwd=str(REPO),
        )
        if not (tmp_path / "out.json").exists():
            print("TS driver failed:", result.stdout, result.stderr, file=sys.stderr)
            return 1
        ts_answers = json.loads((tmp_path / "out.json").read_text(encoding="utf-8"))

    payload = {
        "_readme": (
            "TS-side answers from the REAL src/server/lib/killzone.ts. Regenerate with "
            "src/engine/tests/generate_session_windows_parity_fixture.py. Each value is a "
            "5-bit string over ZONES order."
        ),
        "zones": list(ZONES),
        "days": list(DAYS),
        "killzone_ts_sha256": killzone_digest(),
        "answers": ts_answers,
    }
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(payload, indent=0, sort_keys=True), encoding="utf-8")
    print(f"wrote {FIXTURE} — {len(ts_answers)} instants, "
          f"killzone.ts sha256={payload['killzone_ts_sha256'][:16]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
