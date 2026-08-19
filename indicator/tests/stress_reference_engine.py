"""Standalone deterministic stress runner.

Run from repository root:
    python -m indicator.tests.stress_reference_engine

No third-party packages required.
"""
import math
import random
import time

from indicator.reference.momentum_engine import (
    MomentumConfig,
    MomentumEngine,
    Side,
    TickEvent,
)

CFG = MomentumConfig(min_break=1.0, min_push=1.0, max_recoil=0.75, max_push_seconds=60.0)


def main():
    rng = random.Random(20260809)
    cases = 250_000
    failures = 0
    entries = 0
    recoils = 0

    start = time.perf_counter()
    for case in range(cases):
        side = Side.SHORT if case % 2 == 0 else Side.LONG
        e = MomentumEngine(side, CFG)
        e.arm_reference(100.0, 0, "MNQ")
        price = 100.0
        bar = 0

        for event_id in range(1, rng.randint(8, 45)):
            if event_id > 1 and rng.random() < 0.025:
                bar += 1
            step = rng.gauss(0, 0.7)
            if rng.random() < 0.02:
                step += rng.gauss(0, 4.0)
            price = max(1.0, price + step)
            out = e.on_tick(TickEvent(bar, event_id, event_id + bar * 300, price))
            if out == "RECOIL_RESET":
                recoils += 1

        if e.entry_count:
            entries += 1

        for idx, tr in enumerate(e.transitions):
            if tr.code != "ENTRY_READY":
                continue
            prior = [
                x for x in e.transitions[:idx]
                if x.bar_id == tr.bar_id and x.code in {"BREAK", "PUSH_1"}
            ]
            codes = [x.code for x in prior]
            if "BREAK" not in codes or "PUSH_1" not in codes:
                failures += 1
                break
            break_id = max(x.event_id for x in prior if x.code == "BREAK")
            push_id = max(x.event_id for x in prior if x.code == "PUSH_1")
            if not (break_id < push_id < tr.event_id):
                failures += 1
                break

    elapsed = time.perf_counter() - start

    e = MomentumEngine(Side.SHORT, CFG)
    e.arm_reference(20_000.0, 0, "MNQ")
    price = 20_000.0
    updates = 1_000_000
    load_start = time.perf_counter()
    for i in range(1, updates + 1):
        price += math.sin(i * 0.013) * 0.05
        e.on_tick(TickEvent((i - 1) // 6000, i, i * 0.05, price))
    load_elapsed = time.perf_counter() - load_start

    print(f"randomized_cases={cases}")
    print(f"entry_paths={entries}")
    print(f"recoil_resets={recoils}")
    print(f"invariant_failures={failures}")
    print(f"randomized_elapsed_seconds={elapsed:.3f}")
    print(f"load_updates={updates}")
    print(f"load_updates_per_second={updates / load_elapsed:,.0f}")

    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
