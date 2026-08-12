"""R3-5 item C — the two result feeders are not independent measurements, and the
instrument must not claim they are.

THE TRACE, TO THE IMPLEMENTATION BOUNDARY
    `scripts/acceptance_pytest_plugin.py` and pytest's builtin junitxml are two
    separate implementations. They are NOT two separate measurement paths:

      - both are pytest plugins registered in the SAME pytest process
      - both subscribe to the SAME hook, `pytest_runtest_logreport`
      - both serialize at the SAME point, `pytest_sessionfinish`

    So they are two SINKS on ONE report stream. Their agreement is evidence about
    SERIALIZATION and AGGREGATION -- that one sink did not corrupt or drop what it
    was handed -- and evidence about nothing else.

WHAT THE CROSS-CHECK CANNOT SEE
    Any fault UPSTREAM of both. If the run never happens, both artifacts go stale
    for the same reason and agree perfectly (that is F-R2-1, already measured: "one
    path read twice, not two paths"). If reports are suppressed before the hook
    fires, neither recorder ever learns the node existed.

      `BOTH SIDES OF A CHECK FROM THE SAME LAYER ⇒ AGREEMENT IS NOT EVIDENCE.`

WHY THE REPAIR IS WORDING, NOT A THIRD IMPLEMENTATION
    AR-1027 §4C is explicit: do not manufacture independence by adding a second
    implementation merely to satisfy the word. The architecture is sound for what
    it actually does; only the claim about it was too broad. So this test pins the
    corrected semantics and the structural facts they rest on.

    A reassurance broader than its evidence is the one failure a reader cannot
    catch, because it looks exactly like a stronger guarantee.
"""

import importlib.util
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUNNER = REPO / "scripts" / "acceptance_runner.py"
PLUGIN = REPO / "scripts" / "acceptance_pytest_plugin.py"


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_both_recorders_subscribe_to_the_same_pytest_hook():
    """The structural fact the honest wording rests on."""
    from _pytest.junitxml import LogXML

    plugin = _load(PLUGIN, "acceptance_plugin_under_test")
    recorder = plugin._AcceptanceRecorder

    for cls, label in ((recorder, "acceptance plugin"), (LogXML, "pytest junitxml")):
        assert hasattr(cls, "pytest_runtest_logreport"), (
            "{} does not consume pytest_runtest_logreport; the shared-stream trace "
            "this claim rests on is stale and must be re-derived".format(label)
        )
        assert hasattr(cls, "pytest_sessionfinish"), (
            "{} does not write at pytest_sessionfinish".format(label)
        )


def test_runner_states_the_cross_check_scope_honestly():
    """The scope string must name what the cross-check does NOT cover."""
    runner = _load(RUNNER, "acceptance_runner_under_test")
    scope = runner.FEEDER_CROSS_CHECK_SCOPE

    assert "NOT execution" in scope, (
        "the scope string does not say what the cross-check excludes: {!r}".format(scope)
    )
    for token in ("one pytest report stream", "pytest_runtest_logreport"):
        assert token.lower() in scope.lower(), (
            "the scope string does not name the shared path ({!r} missing)".format(token)
        )


def test_no_unqualified_independence_claim_survives_in_the_runner():
    """The discriminating control: the overclaim must be gone, not merely softened.

    Scans LIVE code only -- lines beginning with `#` are excluded, because the
    record of why the phrase was wrong necessarily quotes the phrase. A detector
    that cannot tell a live claim from a historical note is not a claim detector,
    and this one convicted itself on exactly that before being tightened.
    """
    live = [
        line for line in RUNNER.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("#")
    ]
    assert live, "read no source lines -- the control would pass vacuously"

    for overclaim in ("independent feeder", "INDEPENDENT second feeder",
                      "independent second feeder"):
        hits = [ln.strip() for ln in live if overclaim in ln]
        assert not hits, (
            "the runner still claims {!r} in live code. The two recorders share a "
            "process, a hook and a write point, so that phrase promises a property "
            "the architecture does not have.\n  {}".format(overclaim, "\n  ".join(hits))
        )
