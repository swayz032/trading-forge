"""AR-1393 — red-proof the E8 artifact hash manifest so it is an instrument, not decoration.

A manifest that has never been seen to FAIL is not evidence that anything is intact. This flips a
single hex digit of one recorded hash, runs the checker, and asserts it goes RED; then runs the
unmutated manifest and asserts it goes GREEN. Both arms are required -- a checker that always
fails discriminates nothing, and neither does one that always passes.
"""

import os
import subprocess
import sys

BASE = ("docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/"
        "visual-intelligence-e8-round1/E8Wg6tFPYjo")
MANIFEST = os.path.join(BASE, "artifact-manifest.sha256")
MUTANT = os.path.join(BASE, "_redproof.sha256")

TARGET = "16bcf948748143064bbbd467054a1a7fc2dc6b05a753bb9de1c477909bfa7d8b"  # vi2_00-16-28.png
FLIPPED = "06bcf948748143064bbbd467054a1a7fc2dc6b05a753bb9de1c477909bfa7d8b"


def check(manifest_name):
    r = subprocess.run(["sha256sum", "-c", manifest_name],
                       cwd=BASE, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


src = open(MANIFEST, encoding="utf-8").read()
assert TARGET in src, "target hash not present in manifest -- test is aimed at nothing"

print("POSITIVE CONTROL -- unmutated manifest must pass")
rc, out, _ = check("artifact-manifest.sha256")
ok_lines = [l for l in out.splitlines() if l.strip().endswith("OK")]
print(f"  exit {rc}, {len(ok_lines)} artifacts OK")
if rc != 0:
    sys.exit("CONTROL FAILED: the clean manifest does not pass; nothing below is interpretable")

print("\nNEGATIVE CONTROL -- one hex digit flipped, checker must go RED")
open(MUTANT, "w", encoding="utf-8", newline="\n").write(src.replace(TARGET, FLIPPED))
try:
    rc, out, err = check("_redproof.sha256")
    failed = [l for l in out.splitlines() if "FAILED" in l]
    print(f"  exit {rc}")
    for l in failed:
        print("  " + l)
    for l in err.splitlines():
        if "FAILED" in l:
            print("  " + l)
    if rc == 0 or not failed:
        sys.exit("RED-PROOF FAILED: a corrupted hash did not bite. The manifest is decoration.")
finally:
    os.remove(MUTANT)

print("\nBOTH ARMS DISCRIMINATE. The manifest is a live instrument.")
