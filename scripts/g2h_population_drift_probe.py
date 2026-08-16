"""AR-1243 §10.1 — governed-population drift attribution probe. READ-ONLY.

Dumps the governed canonical regression population and its manifest drift at ONE pin,
so two pins can be compared member-by-member AND by order.

It imports the REPOSITORY's own derivation (`_regression_population`), its own manifest
reader (`_read_manifest`) and its own comparator (`_manifest_mismatch`) out of the
committed guard module. It deliberately reimplements NONE of them: a probe that
exercises a different comparator than the guard proves nothing about the guard
(`test_flag_off_parameterized_refusal._manifest_mismatch` docstring, same law).

This probe NEVER writes the manifest. Regeneration is forbidden without a member-by-member
disposition (R-715 §5.3 / F-2, and the manifest header itself).

usage: python scripts/g2h_population_drift_probe.py <repo_root> <pin_label> <out_json>
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__)
        return 2

    repo_root = Path(sys.argv[1]).resolve()
    pin_label = sys.argv[2]
    out_path = Path(sys.argv[3])

    sys.path.insert(0, str(repo_root))

    mod_path = repo_root / "src" / "engine" / "tests" / "test_flag_off_parameterized_refusal.py"
    spec = importlib.util.spec_from_file_location("_pop_probe", mod_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load the guard module at {mod_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    derived = mod._regression_population(mod._SCAN_ROOT, mod._CLOSURE_TARGETS)
    manifest = mod._read_manifest()

    out = {
        "pin": pin_label,
        "repo_root": str(repo_root),
        "scan_root": str(mod._SCAN_ROOT),
        "closure_targets": list(mod._CLOSURE_TARGETS),
        "derived_count": len(derived),
        "manifest_count": len(manifest),
        "manifest_only": [m for m in manifest if m not in derived],
        "derived_only": [d for d in derived if d not in manifest],
        "mismatch": mod._manifest_mismatch(derived, manifest),
        "derived_full": derived,
        "manifest_full": manifest,
    }
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(
        f"{pin_label}: derived={len(derived)} manifest={len(manifest)} "
        f"derived_only={len(out['derived_only'])} manifest_only={len(out['manifest_only'])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
