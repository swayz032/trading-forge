"""ALGO-096 §5 guard diff: approved-entry membership BEFORE vs AFTER, BY KEY.

Compares by MEMBERSHIP, never by count (a count that matches can hide an equal-sized swap).
Reports per session: added keys, removed keys, target moves on surviving keys, whether the
session was SILENCED (had approvals, now has none), and whether its FIRST approval moved
EARLIER — which §5.4 makes a failing condition on a convicted day for a Route A approval.

Reads no PnL, outcome, winner/loser or clean-edge field: the capture carries none.
"""
import json, sys, io

CONVICTED = {"2026-03-23", "2026-03-24", "2026-03-31", "2026-04-06", "2026-04-09"}
CONTROL = "2026-04-14"
HIS_CLOCK = {
    "2026-03-23": "11:21", "2026-03-24": "09:32", "2026-03-31": "09:49",
    "2026-04-06": "10:04", "2026-04-09": "11:35", "2026-04-14": "09:36",
}


def load(p):
    d = json.load(io.open(p, encoding="utf-8"))
    d.pop("__arm_pin__", None)
    return d


def keyset(rows):
    return {tuple(r["key"]): r for r in rows}


def first_time(rows):
    ts = sorted(str(r["key"][1]) for r in rows)
    return ts[0] if ts else None


def main():
    before, after, pin = load(sys.argv[1]), load(sys.argv[2]), sys.argv[3]
    print(f"=== APPROVED-ENTRY MEMBERSHIP, BEFORE vs AFTER  (arm pin {pin}) ===")
    tb = sum(len(v) for v in before.values())
    ta = sum(len(v) for v in after.values())
    print(f"TOTAL fully-approved entries: {tb} -> {ta}\n")

    silenced, earlier, added_all, removed_all, retargeted_all = [], [], [], [], []
    for s in sorted(set(before) | set(after)):
        B, A = keyset(before.get(s, [])), keyset(after.get(s, []))
        add, rem = sorted(set(A) - set(B)), sorted(set(B) - set(A))
        kept = set(A) & set(B)
        moved = [k for k in sorted(kept)
                 if B[k]["target"] != A[k]["target"]]
        fb, fa = first_time(before.get(s, [])), first_time(after.get(s, []))
        flag = ""
        if len(B) > 0 and len(A) == 0:
            silenced.append(s); flag += "  *** SILENCED ***"
        if fb and fa and fa < fb:
            earlier.append((s, fb, fa)); flag += "  *** FIRST APPROVAL EARLIER ***"
        mark = " [CONVICTED]" if s in CONVICTED else (" [CONTROL]" if s == CONTROL else "")
        if add or rem or moved or flag:
            print(f"{s}{mark}: {len(B)} -> {len(A)}   his clock {HIS_CLOCK.get(s,'-')}{flag}")
            print(f"    first approval: {fb} -> {fa}")
            for k in add:
                print(f"    + ADDED   {k}   target {A[k]['target']} {A[k]['target_kind']}")
            for k in rem:
                print(f"    - REMOVED {k}   target {B[k]['target']} {B[k]['target_kind']}")
            for k in moved:
                print(f"    ~ TARGET  {k}   {B[k]['target']} -> {A[k]['target']}")
        else:
            print(f"{s}{mark}: {len(B)} -> {len(A)}   IDENTICAL BY KEY AND TARGET")
        added_all += [(s,) + k for k in add]
        removed_all += [(s,) + k for k in rem]
        retargeted_all += [(s,) + k for k in moved]

    print("\n=== PRE-REGISTERED LINES (§5) ===")
    print(f"(2) SESSIONS SILENCED: {len(silenced)}  {silenced if silenced else '- ZERO, as required'}")
    print(f"    FIRST APPROVAL MOVED EARLIER: {len(earlier)}  {earlier if earlier else '- none'}")
    print(f"    additions {len(added_all)} | removals {len(removed_all)} | target moves {len(retargeted_all)}")
    for s, *k in added_all:
        t = "  <-- CONVICTED DAY" if s in CONVICTED else ""
        print(f"    ADDED: {s} {k}{t}")
    for s, *k in removed_all:
        print(f"    REMOVED: {s} {k}")


if __name__ == "__main__":
    main()
