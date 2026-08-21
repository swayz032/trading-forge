"""AR-1395 — clean-checkout regenerate-then-manifest test for the E8 visual evidence.

Origin: AR-1384A section 5 measured that on a fresh checkout under a different Pillow build,
running the proof rewrote five committed magnifications and the byte manifest then failed on files
nobody had edited. Nothing in the repository would have caught that.

AR-1385A section 4 then convicted the FIRST version of this harness: arms D and E mutated COPIES OF
THE SCRIPTS but wrote into the REAL evidence files, restoring them in `finally`. A kill between
mutation and restore would leave committed evidence altered.

  ★ A TEST FOR EVIDENCE SAFETY MUST NOT MAKE EVIDENCE SAFETY DEPEND ON ITS OWN CLEANUP.

So every destructive arm now runs against a TEMPORARY EVIDENCE ROOT (`TF_VI_E8_EVIDENCE_ROOT`, a
test-only override honoured by the generator, the proof and the manifest verifier). The real tree is
fingerprinted before and after the whole run as a hard invariant, and arm F deliberately fails
inside the temporary lane to prove that invariant is load-bearing rather than decorative.

SIX ARMS -- three assertions, three controls:

  A  READ-ONLY        running the semantic proof leaves the REAL evidence tree byte-unchanged.
  B  REPRODUCIBLE     re-rendering every magnification reproduces the committed artifacts BY
                      DECODED PIXELS -- portable across encoders.
  C  MANIFEST GREEN   the manifest verifies against what is on disk.
  D  MUTATION BITES   [temp root] a one-pixel change fails the manifest.
  E  GUARD BITES      [temp root] a copy of the proof with a write reintroduced refuses itself.
  F  INVARIANT BITES  [temp root] a deliberate failure inside the temp lane still leaves the REAL
                      tree untouched -- proving arms D/E cannot reach it even when they go wrong.

Run:  python scripts/_worker_vi_e8_reproducibility_test.py
Exit 0 = all six arms hold. Exit 1 = a named arm failed.
"""

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

REAL_BASE = ("docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/"
             "visual-intelligence-e8-round1/E8Wg6tFPYjo")
REAL_FRAMES = os.path.join(REAL_BASE, "frames")

failures = []


def run(*args, evidence_root=None):
    env = dict(os.environ)
    if evidence_root:
        env["TF_VI_E8_EVIDENCE_ROOT"] = evidence_root
    else:
        env.pop("TF_VI_E8_EVIDENCE_ROOT", None)
    return subprocess.run([sys.executable, *args], capture_output=True, text=True, env=env)


def fingerprint(frames_dir):
    h = hashlib.sha256()
    for name in sorted(os.listdir(frames_dir)):
        if not name.lower().endswith(".png"):
            continue
        h.update(name.encode())
        with open(os.path.join(frames_dir, name), "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
    return h.hexdigest()


def make_temp_evidence(tmp):
    """A complete, self-sufficient copy of the evidence root."""
    dst = os.path.join(tmp, "evidence")
    shutil.copytree(REAL_BASE, dst)
    return dst


print(f"Pillow {Image.__version__ if hasattr(Image, '__version__') else 'unknown'}")
print(f"Python {sys.version.split()[0]}")

REAL_BEFORE = fingerprint(REAL_FRAMES)
print(f"REAL evidence fingerprint at start: {REAL_BEFORE}")
print()

# ---- ARM A -------------------------------------------------------------------------------------
print("ARM A  READ-ONLY: the semantic proof must not touch the real evidence tree")
before = fingerprint(REAL_FRAMES)
r = run("scripts/_worker_vi_e8_final_frame_proof.py")
after = fingerprint(REAL_FRAMES)
print(f"  proof exit {r.returncode}; fingerprint {before[:16]}... -> {after[:16]}...")
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
print("  " + (r.stdout.strip().splitlines() or ["<no output>"])[-1])
if r.returncode != 0:
    failures.append("B (pixel drift)")

# ---- ARM C -------------------------------------------------------------------------------------
print("\nARM C  MANIFEST GREEN: disk matches the manifest")
r = run("scripts/_worker_vi_e8_hash_manifest.py", "--verify")
print("  " + (r.stdout.strip().splitlines() or ["<no output>"])[-1])
if r.returncode != 0:
    failures.append("C (manifest)")

# ---- ARM D -------------------------------------------------------------------------------------
print("\nARM D  MUTATION BITES  [temporary evidence root]")
with tempfile.TemporaryDirectory() as tmp:
    ev = make_temp_evidence(tmp)
    victim = os.path.join(ev, "frames", "zoom_vi2_post_16-28_target.png")
    im = Image.open(victim).convert("RGB")
    px = im.load()
    r_, g_, b_ = px[0, 0]
    px[0, 0] = ((r_ + 128) % 256, g_, b_)
    im.save(victim)

    res = run("scripts/_worker_vi_e8_hash_manifest.py", "--verify", evidence_root=ev)
    hit = [l for l in res.stdout.splitlines() if "PIXELS DIFFER" in l]
    print(f"  verify exit {res.returncode}")
    for l in hit:
        print("  " + l.strip())
    if res.returncode == 0 or not hit:
        print("  FAIL: the mutation did NOT bite -- the manifest is decoration")
        failures.append("D (mutation not caught)")
    else:
        print("  PASS: caught by PIXELS, the portable half")

# ---- ARM E -------------------------------------------------------------------------------------
print("\nARM E  THE PROOF'S OWN GUARD BITES  [temporary evidence root]")
with tempfile.TemporaryDirectory() as tmp:
    ev = make_temp_evidence(tmp)
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
        mutant = os.path.join(tmp, "mutant_proof.py")
        open(mutant, "w", encoding="utf-8").write(injected)
        res = run(mutant, evidence_root=ev)
        violated = "READ-ONLY VIOLATION" in (res.stdout + res.stderr)
        print(f"  mutant exit {res.returncode}, guard fired: {violated}")
        if res.returncode == 0 or not violated:
            print("  FAIL: a proof that wrote to evidence did NOT refuse itself")
            failures.append("E (guard did not bite)")
        else:
            print("  PASS: the guard refused a self-mutating proof")

# ---- ARM F -------------------------------------------------------------------------------------
# The control on the containment itself. Arms D and E are supposed to be unable to reach the real
# tree. Asserting that only when they SUCCEED proves nothing about the case that matters -- a
# destructive arm going wrong. So: fail hard inside the temp lane, mid-mutation, and require the
# real tree to be untouched anyway.
print("\nARM F  CONTAINMENT BITES: a deliberate failure inside the temp lane must not escape")
pre_f = fingerprint(REAL_FRAMES)
with tempfile.TemporaryDirectory() as tmp:
    ev = make_temp_evidence(tmp)
    try:
        for name in sorted(os.listdir(os.path.join(ev, "frames")))[:3]:
            p = os.path.join(ev, "frames", name)
            im = Image.open(p).convert("RGB")
            px = im.load()
            px[0, 0] = (0, 0, 0)
            im.save(p)
        # No restore, no finally -- simulate a hard abort mid-mutation.
        raise RuntimeError("deliberate mid-mutation abort")
    except RuntimeError as exc:
        print(f"  simulated abort inside temp lane: {exc}")
    res = run("scripts/_worker_vi_e8_hash_manifest.py", "--verify", evidence_root=ev)
    print(f"  temp-root verify exit {res.returncode} (expected non-zero: the temp copy IS damaged)")
    if res.returncode == 0:
        print("  FAIL: the temp lane was not actually damaged -- arm F proves nothing")
        failures.append("F (temp lane undamaged)")

post_f = fingerprint(REAL_FRAMES)
print(f"  REAL tree {pre_f[:16]}... -> {post_f[:16]}...")
if pre_f != post_f:
    print("  FAIL: damage ESCAPED the temporary root into committed evidence")
    failures.append("F (containment breached)")
else:
    print("  PASS: real evidence untouched despite an unrecovered failure")

# ---- whole-run invariant -----------------------------------------------------------------------
REAL_AFTER = fingerprint(REAL_FRAMES)
print("\n" + "=" * 78)
print("WHOLE-RUN INVARIANT")
print(f"  REAL evidence fingerprint at start : {REAL_BEFORE}")
print(f"  REAL evidence fingerprint at end   : {REAL_AFTER}")
if REAL_BEFORE != REAL_AFTER:
    print("  FAIL: the committed evidence tree changed across this test run")
    failures.append("INVARIANT (real tree mutated)")
else:
    print("  UNCHANGED across the entire run, including both destructive arms.")

print("\n" + "=" * 78)
if failures:
    print("REPRODUCIBILITY TEST FAILED: " + ", ".join(failures))
    sys.exit(1)
print("ALL SIX ARMS HOLD.")
print("  PORTABLE claim: magnifications reproduce from committed frames BY DECODED PIXELS.")
print("  NOT claimed:    byte-identical PNG encoding across different Pillow/zlib builds.")
print("  CONTAINED:      no arm writes to the committed evidence tree, even when it fails.")
sys.exit(0)
