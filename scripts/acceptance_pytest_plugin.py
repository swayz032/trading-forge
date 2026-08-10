"""ACCEPT-5 result feeder — captures node IDs FROM PYTEST ITSELF.

`ACCEPT5-INSTRUMENT-1` (R-790 §6). This is the campaign's committed replacement
for the per-seat ad-hoc extractors that produced a 49-member fabricated
regression against a clean commit (R-789 §6).

WHY A PLUGIN AND NOT A SUMMARY SCRAPE
    pytest's terminal summary is human prose. Every seat that re-authored a
    regex over it got a different answer, and one of those answers was wrong in
    a way that looked exactly like a regression. This plugin records
    `item.nodeid` at COLLECTION and `report.outcome` at EXECUTION, which are the
    objects pytest itself uses.

    `A GATE WITH NO COMMITTED INSTRUMENT IS NOT A GATE — IT IS A PROCEDURE EACH
     SEAT RE-AUTHORS.`

COLLECTION IS RECORDED SEPARATELY FROM EXECUTION ON PURPOSE
    A test that stops being COLLECTED disappears from every failure list and
    reads as `NEW = 0`. Collection presence is therefore its own recorded fact,
    not an inference from the failure set.

Usage:  pytest ... -p acceptance_pytest_plugin --acceptance-out=<path.json>
"""
from __future__ import annotations

import json
import os
import platform
import sys


def pytest_addoption(parser):
    parser.addoption(
        "--acceptance-out",
        action="store",
        default="acceptance-run.json",
        help="Path to write the ACCEPT-5 machine-readable run record.",
    )
    parser.addoption(
        "--acceptance-corrupt-feeder",
        action="store",
        default="",
        help=(
            "MUTATION ARM D ONLY. Deliberately corrupts this feeder's reported "
            "membership so the runner's independent self-check can be proven to "
            "bite. Never set this in a real acceptance run."
        ),
    )


class _AcceptanceRecorder:
    def __init__(self, config):
        self.config = config
        self.collected = []
        self.outcomes = {}
        self.executed = set()
        self.longrepr = {}

    # ---- collection -------------------------------------------------------
    def pytest_collection_modifyitems(self, session, config, items):
        self.collected = [item.nodeid for item in items]

    # ---- execution --------------------------------------------------------
    def pytest_runtest_logreport(self, report):
        nid = report.nodeid
        if report.when == "call" or (report.when == "setup" and report.outcome != "passed"):
            self.executed.add(nid)
            outcome = report.outcome
            if getattr(report, "wasxfail", None) is not None and outcome == "skipped":
                outcome = "xfailed"
            elif getattr(report, "wasxfail", None) is not None and outcome == "passed":
                outcome = "xpassed"
            prior = self.outcomes.get(nid)
            if prior in (None, "passed"):
                self.outcomes[nid] = outcome
            if outcome == "failed" and report.longrepr is not None:
                self.longrepr[nid] = str(report.longrepr)[:400]

    # ---- write ------------------------------------------------------------
    def pytest_sessionfinish(self, session, exitstatus):
        out = self.config.getoption("--acceptance-out")
        corrupt = self.config.getoption("--acceptance-corrupt-feeder")

        failures = sorted(n for n, o in self.outcomes.items() if o == "failed")
        skipped = sorted(n for n, o in self.outcomes.items() if o == "skipped")
        xfailed = sorted(n for n, o in self.outcomes.items() if o == "xfailed")
        xpassed = sorted(n for n, o in self.outcomes.items() if o == "xpassed")
        passed = sorted(n for n, o in self.outcomes.items() if o == "passed")
        collected = sorted(self.collected)

        record = {
            "instrument": "acceptance_pytest_plugin",
            "instrument_contract": "node IDs from pytest objects; never a summary scrape",
            "pytest_exitstatus": int(exitstatus),
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "cwd": os.getcwd(),
            "collected": collected,
            "n_collected": len(collected),
            "executed": sorted(self.executed),
            "n_executed": len(self.executed),
            "failures": failures,
            "n_failures": len(failures),
            "passed": passed,
            "n_passed": len(passed),
            "skipped": skipped,
            "n_skipped": len(skipped),
            "xfailed": xfailed,
            "n_xfailed": len(xfailed),
            "xpassed": xpassed,
            "n_xpassed": len(xpassed),
            "failure_reprs": self.longrepr,
            "feeder_corrupted": bool(corrupt),
        }

        # ---- MUTATION ARM D ------------------------------------------------
        # Deliberately misreport membership. The runner's INDEPENDENT second
        # feeder (junitxml) must catch the disagreement. This exists so the
        # self-check can be proven to bite rather than asserted to.
        if corrupt == "drop-a-failure" and record["failures"]:
            dropped = record["failures"][0]
            record["failures"] = record["failures"][1:]
            record["n_failures"] = len(record["failures"])
            record["_corruption"] = "dropped failure " + dropped
        elif corrupt == "invent-a-failure":
            record["failures"] = sorted(record["failures"] + ["tests/fabricated.py::test_ghost"])
            record["n_failures"] = len(record["failures"])
            record["_corruption"] = "invented a failure that pytest never reported"
        elif corrupt == "drop-a-collected" and record["collected"]:
            dropped = record["collected"][0]
            record["collected"] = record["collected"][1:]
            record["n_collected"] = len(record["collected"])
            record["_corruption"] = "dropped collected " + dropped

        with open(out, "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2, sort_keys=True)


def pytest_configure(config):
    config.pluginmanager.register(_AcceptanceRecorder(config), "acceptance-recorder")
