#!/usr/bin/env python3
"""Ruling-3 (2026-07-15): mid-run HARD-CAP enforcement for EVERY metered OpenAI path.
Before each metered call, project cumulative spend + this call's estimate against the ticket
USD cap; if it would breach, RAISE (stop the run) instead of firing. Swept across the class:
any metered runner imports guard_or_raise and calls it before every create()."""
class CapBreach(Exception): pass

class MeteredCapGuard:
    def __init__(self, ticket_usd: float, blend_usd_per_mtok: float = 2.5):
        self.cap = float(ticket_usd); self.blend = blend_usd_per_mtok
        self.spent_usd = 0.0; self.spent_tok = 0
    def project_next(self, est_tokens: int) -> float:
        return self.spent_usd + est_tokens * self.blend / 1e6
    def guard_or_raise(self, est_tokens: int):
        proj = self.project_next(est_tokens)
        if proj > self.cap:
            raise CapBreach(f"HARD-CAP: projected ${proj:.3f} > ticket ${self.cap:.2f} "
                            f"(spent ${self.spent_usd:.3f}, next ~{est_tokens}tok). STOPPING mid-run.")
    def record(self, actual_tokens: int):
        self.spent_tok += actual_tokens
        self.spent_usd += actual_tokens * self.blend / 1e6
