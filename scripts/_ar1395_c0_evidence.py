"""AR-1395 Stage C0 evidence: what the compiler actually emits for an unresolved dependency.

Read-only. Prints the structured non-ready result and a determinism witness, so the report quotes
the artifact rather than a description of it.
"""
import json
import sys

sys.path.insert(0, ".")

from src.engine.extraction.source_graph_projection import ExternalDependencySpec  # noqa: E402
from src.engine.tests.test_external_dependency_projection import (  # noqa: E402
    FIXTURE_PATH,
    _run,
)

fx = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
dep = ExternalDependencySpec(**fx["external_dependency"])

a = _run(external_dependencies=(dep,))
b = _run(external_dependencies=(dep,))

print("=" * 78)
print("STRUCTURED NON-READY RESULT (the E8 calibration fixture)")
print("=" * 78)
print("grade             :", a["grade"])
print("compile_readiness :", a["compile_readiness"])
print("structured_blocker:")
print(json.dumps(a["structured_blocker"], indent=2))
print()
print("the dependency as the receipt carries it:")
d = a["external_dependencies"][0]
for k in ("dependency_id", "consumer_refs", "kind", "display_chart_timeframe",
          "decision_timeframe", "semantic_status", "access_status",
          "implementation_status", "contract_sha256"):
    print(f"  {k:<24} {d[k]}")
print()
print("SEMANTIC STATUS SURVIVES THE RED GRADE:", d["semantic_status"])
print("  -> RED means NOT READY TO EXECUTE, never 'the source was not understood'.")
print()
print("=" * 78)
print("DETERMINISM")
print("=" * 78)
print("two runs identical :", a == b)
print("contract hash      :", d["contract_sha256"])
print()
print("=" * 78)
print("LEGACY COMPATIBILITY (no declared dependency)")
print("=" * 78)
legacy = _run()
print("grade                       :", legacy["grade"])
print("external_dependencies key   :", "external_dependencies" in legacy)
print("compile_readiness key       :", "compile_readiness" in legacy)
print("structured_blocker key      :", "structured_blocker" in legacy)
print("  -> omit-when-empty: a spec declaring none serialises as it did before the field existed.")
