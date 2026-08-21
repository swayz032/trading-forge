"""AR-1395: full `src/engine/tests/` sweep, capturing pytest's OWN exit code and failure list.

Why a script instead of a shell pipeline: `pytest ... 2>&1 | tail -4` reports the exit code of
`tail`, not of pytest. A first attempt did exactly that and returned "exit code 0" while pytest had
actually errored out on an unrecognised argument. AN EXIT CODE FROM THE WRONG PROCESS IS A FALSE
GREEN, and it is one of the cheapest ones to ship.

`-rf --tb=no` so the run yields the failing NODE IDS rather than thousands of traceback lines --
the question this answers is "which tests fail, and are any of them in a file this packet touched?",
not "what does each traceback say".
"""
import subprocess
import sys

TOUCHED = (
    "test_external_dependency_projection.py",
    "test_source_graph_projection.py",
    "test_svkm_v2_1_compile.py",
    "test_svkm_v2_1_golden_runtime_witness.py",
)

cmd = [sys.executable, "-m", "pytest", "src/engine/tests/", "-q", "-rf", "--tb=no",
       "-p", "no:cacheprovider", "--continue-on-collection-errors"]
print("command:", " ".join(cmd), flush=True)

r = subprocess.run(cmd, capture_output=True, text=True)
out = r.stdout + r.stderr

print("PYTEST EXIT CODE:", r.returncode, flush=True)

fails = [l.strip() for l in out.splitlines()
         if l.startswith(("FAILED", "ERROR")) and "::" in l]
print(f"\nFAILING/ERRORING NODES: {len(fails)}")

mine = [f for f in fails if any(t in f for t in TOUCHED)]
others = [f for f in fails if f not in mine]

print(f"\n--- IN FILES THIS PACKET TOUCHED: {len(mine)} ---")
for f in mine:
    print("  ", f[:160])

print(f"\n--- IN FILES THIS PACKET DID NOT TOUCH: {len(others)} ---")
seen_files = {}
for f in others:
    fname = f.split("::")[0].split("/")[-1].split("\\")[-1]
    seen_files.setdefault(fname, 0)
    seen_files[fname] += 1
for fname, n in sorted(seen_files.items(), key=lambda kv: -kv[1]):
    print(f"   {n:4d}  {fname}")

print("\n--- tail of run ---")
tail = [line for line in out.splitlines() if line.strip()][-8:]
print("\n".join(tail))
print("\nVERDICT:", "GREEN" if r.returncode == 0 else f"NOT GREEN (exit {r.returncode})")
