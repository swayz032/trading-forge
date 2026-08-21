"""AR-1395: name the failing tests in the early part of the engine suite, and attribute them.

The full `src/engine/tests/` sweep is KILLED partway (exit -1, no summary), so it yields F marks
with no node ids. This runs the alphabetically-first files in small batches so each batch completes
and reports its own failures by name -- then attributes each to "touched by this packet" or not.
"""
import os
import subprocess
import sys

TESTS = "src/engine/tests"
TOUCHED = (
    "test_external_dependency_projection.py",
    "test_source_graph_projection.py",
    "test_svkm_v2_1_compile.py",
    "test_svkm_v2_1_golden_runtime_witness.py",
)

files = sorted(f for f in os.listdir(TESTS) if f.startswith("test_") and f.endswith(".py"))
BATCH = 6
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 24

all_fail = []
for i in range(0, min(LIMIT, len(files)), BATCH):
    batch = files[i:i + BATCH]
    cmd = [sys.executable, "-m", "pytest", "-q", "-rf", "--tb=no", "-p", "no:cacheprovider",
           *[os.path.join(TESTS, f) for f in batch]]
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = r.stdout + r.stderr
    fails = [l.strip() for l in out.splitlines()
             if l.startswith(("FAILED", "ERROR")) and "::" in l]
    summary = [l for l in out.splitlines() if " passed" in l or " failed" in l or " error" in l]
    print(f"[{i:3d}-{i + len(batch) - 1:3d}] exit={r.returncode} "
          f"{summary[-1].strip() if summary else '(no summary)'}", flush=True)
    all_fail.extend(fails)

print(f"\nTOTAL FAILING/ERRORING NODES IN THIS RANGE: {len(all_fail)}")
mine = [f for f in all_fail if any(t in f for t in TOUCHED)]
print(f"\nIN FILES THIS PACKET TOUCHED: {len(mine)}")
for f in mine:
    print("  ", f[:170])
print(f"\nIN FILES THIS PACKET DID NOT TOUCH: {len(all_fail) - len(mine)}")
for f in all_fail:
    if f not in mine:
        print("  ", f[:170])
