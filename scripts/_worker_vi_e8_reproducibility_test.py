"""AR-1394 — clean-checkout regenerate-then-manifest test (AR-1384A sections 5 and 9.4).

AR-1384A measured the defect this test exists to catch: on a fresh detached checkout under a
different Pillow build, running the proof rewrote five committed magnifications and the byte
manifest then failed on files nobody had edited. The claim "byte-identical regeneration" was not
portable, and nothing in the repository would have detected that.

FIVE ARMS. All five must hold, and each is stated as what it discriminates:

  A  READ-ONLY        running the semantic proof leaves the evidence tree byte-unchanged.
                      Discriminates: a proof that mutates the evidence it proves.
  B  REPRODUCIBLE     re-rendering every magnification from committed frames reproduces the
                      committed artifacts BY DECODED PIXELS.
                      Discriminates: real content drift, portably -- independent of the encoder.
  C  MANIFEST GREEN   the manifest verifies against what is on disk.
                      Discriminates: an artifact changed without the manifest being regenerated.
  D  MUTATION BITES   an intentional single-pixel change fails the manifest.
                      Discriminates: a manifest that always passes. Without D, A-C are vacuous.

  E  GUARD BITES       a COPY of the proof with a write reintroduced must refuse itself.
                      Discriminates: a read-only guard that is broken. Arm A would still pass in
                      that case, for the unrelated reason that the script happens not to write.

Arms D and E are the controls: a checker that cannot fail proves nothing about the checks that
pass. Both run on COPIES and restore the original bytes afterwards.

Run:  python scripts/_worker_vi_e8_reproducibility_test.py
Exit 0 = all five arms hold. Exit 1 = a named arm failed.
"""

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

BASE = ("docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/"
        "visual-intelligence-e8-round1/E8Wg6tFPYjo")
FRAMES = os.path.join(BASE, "frames")
VICTIM = os.path.join(FRAMES, "zoom_vi2_post_16-28_target.png")

failures = []


def run(*args):
    return subprocess.run([sys.executable, *args], capture_output=True, text=True)


def tree_fingerprint():
    h = hashlib.sha256()
    for name in sorted(os.listdir(FRAMES)):
        if not name.lower().endswith(".png"):
            continue
        h.update(name.encode())
        with open(os.path.join(FRAMES, name), "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
    return h.hexdigest()


print(f"Pillow {Image.__version__ if hasattr(Image, '__version__') else 'unknown'}")
print(f"Python {sys.version.split()[0]}")
print()

# ---- ARM A -------------------------------------------------------------------------------------
print("ARM A  READ-ONLY: the semantic proof must not touch the evidence tree")
before = tree_fingerprint()
r = run("scripts/_worker_vi_e8_final_frame_proof.py")
after = tree_fingerprint()
print(f"  proof exit {r.returncode}")
print(f"  fingerprint before {before[:16]}...  after {after[:16]}...")
if r.returncode != 0:
    print("  FAIL: the proof did not run cleanly")
    failures.append("A (proof exit)")
elif before != after:
    print("  FAIL: the proof MUTATED committed evidence")
    failures.append("A (mutation)")
else:
    print("  PASS: unchanged")

# ---- ARM B -------------------------------------------------------------------------------------
print("\nARM B  REPRODUCIBLE: re-render from committed frames, compare by decoded pixels")
r = run("scripts/_worker_vi_e8_generate_magnifications.py", "--check")
print("  " + "\n  ".join(l for l in r.stdout.strip().splitlines()[-3:]))
if r.returncode != 0:
    failures.append("B (pixel drift)")

# ---- ARM C -------------------------------------------------------------------------------------
print("\nARM C  MANIFEST GREEN: disk matches the manifest")
r = run("scripts/_worker_vi_e8_hash_manifest.py", "--verify")
print("  " + r.stdout.strip().splitlines()[-1])
if r.returncode != 0:
    failures.append("C (manifest)")

# ---- ARM D -------------------------------------------------------------------------------------
print("\nARM D  MUTATION BITES: a one-pixel change must fail the manifest")
with tempfile.TemporaryDirectory() as tmp:
    backup = os.path.join(tmp, "victim.png")
    shutil.copy2(VICTIM, backup)
    try:
        im = Image.open(VICTIM).convert("RGB")
        px = im.load()
        r_, g_, b_ = px[0, 0]
        px[0, 0] = ((r_ + 128) % 256, g_, b_)
        im.save(VICTIM)

        res = run("scripts/_worker_vi_e8_hash_manifest.py", "--verify")
        hit = [l for l in res.stdout.splitlines() if "PIXELS DIFFER" in l]
        print(f"  verify exit {res.returncode}")
        for l in hit:
            print("  " + l.strip())
        if res.returncode == 0 or not hit:
            print("  FAIL: the mutation did NOT bite -- the manifest is decoration")
            failures.append("D (mutation not caught)")
        else:
            print("  PASS: caught by PIXELS, which is the portable half")
    finally:
        shutil.copy2(backup, VICTIM)

restored = run("scripts/_worker_vi_e8_hash_manifest.py", "--verify")
print(f"  restored: verify exit {restored.returncode}")
if restored.returncode != 0:
    print("  FAIL: could not restore the original artifact bytes")
    failures.append("D (restore)")

# ---- ARM E -------------------------------------------------------------------------------------
# ARM A is computed by THIS file and is sound on its own. But the proof script also carries its own
# in-module read-only guard, and a guard that has never fired is not an instrument -- it could be
# broken while ARM A passes for the unrelated reason that the script happens not to write. So:
# reintroduce a write into a COPY of the proof and require that copy's guard to REFUSE.
print("\nARM E  THE PROOF'S OWN GUARD BITES: a copy that writes must refuse itself")
with tempfile.TemporaryDirectory() as tmp:
    src = open("scripts/_worker_vi_e8_final_frame_proof.py", encoding="utf-8").read()
    injected = src.replace(
        "# --- READ-ONLY GUARD (AR-1384A section 5) ---",
        "from PIL import Image as _I\n"
        "_p = os.path.join(FRAMES, 'zoom_vi2_post_16-28_axis.png')\n"
        "_im = _I.open(_p).convert('RGB'); _px = _im.load()\n"
        "_r, _g, _b = _px[0, 0]; _px[0, 0] = ((_r + 99) % 256, _g, _b); _im.save(_p)\n"
        "# --- READ-ONLY GUARD (AR-1384A section 5) ---",
        1)
    if injected == src:
        print("  FAIL: could not inject a write -- the guard anchor comment moved")
        failures.append("E (injection anchor)")
    else:
        victim2 = os.path.join(FRAMES, "zoom_vi2_post_16-28_axis.png")
        backup2 = os.path.join(tmp, "axis.png")
        shutil.copy2(victim2, backup2)
        mutant = os.path.join(tmp, "mutant_proof.py")
        open(mutant, "w", encoding="utf-8").write(injected)
        try:
            res = run(mutant)
            violated = "READ-ONLY VIOLATION" in (res.stdout + res.stderr)
            print(f"  mutant exit {res.returncode}, guard fired: {violated}")
            if res.returncode == 0 or not violated:
                print("  FAIL: a proof that wrote to committed evidence did NOT refuse itself")
                failures.append("E (guard did not bite)")
            else:
                print("  PASS: the guard refused a self-mutating proof")
        finally:
            shutil.copy2(backup2, victim2)

final = run("scripts/_worker_vi_e8_hash_manifest.py", "--verify")
print(f"  restored: verify exit {final.returncode}")
if final.returncode != 0:
    failures.append("E (restore)")

# ---- verdict -----------------------------------------------------------------------------------
print("\n" + "=" * 78)
if failures:
    print("REPRODUCIBILITY TEST FAILED: " + ", ".join(failures))
    sys.exit(1)
print("ALL FIVE ARMS HOLD.")
print("  PORTABLE claim: magnifications reproduce from committed frames BY DECODED PIXELS.")
print("  NOT claimed:    byte-identical PNG encoding across different Pillow/zlib builds.")
sys.exit(0)
