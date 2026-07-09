export type GateStatus = "pass" | "now" | "fail" | "wait";
export interface Gate { key: string; label: string; sub: string; status: GateStatus; }
export interface GateSignals {
  backtested: boolean; wfe_pass: boolean; frankenstein_pass: boolean; blackswan_pass: boolean;
  paper_done: boolean; shadow_pass: boolean; compliance_pass: boolean;
}
export interface JourneyInput { lifecycleState: string; signals: GateSignals; }

export const GATE_DEFS: Array<{ key: string; label: string; sub: string; signal: keyof GateSignals }> = [
  { key: "profitable",  label: "Profitable",  sub: "made money in testing",   signal: "backtested" },
  { key: "holds_up",    label: "Holds Up",    sub: "works on unseen data",    signal: "wfe_pass" },
  { key: "real_edge",   label: "Real Edge",   sub: "not just luck",           signal: "frankenstein_pass" },
  { key: "crash_proof", label: "Crash-Proof", sub: "survives a bad day",      signal: "blackswan_pass" },
  { key: "paper_trial", label: "Paper Trial", sub: "fake money",              signal: "paper_done" },
  { key: "live_match",  label: "Live Match",  sub: "live = the test",         signal: "shadow_pass" },
  { key: "rule_safe",   label: "Rule-Safe",   sub: "won't break firm rules",  signal: "compliance_pass" },
  { key: "live_money",  label: "Live Money",  sub: "on the menu",             signal: "compliance_pass" },
];

// Coarse journey from lifecycle stage alone — cleared = gates up to the stage
// frontier, the frontier gate = "now", beyond = "wait". Cheap (no per-strategy
// gate compute), used for the kitchen cook-off mini-lines. GRAVEYARD/DECLINING
// → the frontier gate shows "fail". GATE_DEFS order: profitable(0), holds_up(1),
// real_edge(2), crash_proof(3), paper_trial(4), live_match(5), rule_safe(6),
// live_money(7).
const STAGE_FRONTIER: Record<string, number> = {
  CANDIDATE: 0,        // proving profitability
  TESTING: 1,          // holds up on unseen data
  SHADOW: 4,           // shadow trial ≈ paper
  PAPER: 4,            // paper_trial = "now"
  DEPLOY_READY: 6,     // proving rule-safety
  PILOT: 7,            // live money, on the menu
  DEPLOYED: 7,         // live_money passed → all pass
  GRAVEYARD: 2,        // died mid-way — a real-edge fail is the classic tombstone
  DECLINING: 2,
};

export function coarseJourneyForStage(lifecycleState: string): Gate[] {
  const st = String(lifecycleState || "").toUpperCase();
  const frontier = STAGE_FRONTIER[st] ?? 0;
  const dead = st === "GRAVEYARD" || st === "DECLINING";
  return GATE_DEFS.map((d, i) => {
    let status: GateStatus;
    if (i < frontier) status = "pass";
    else if (i === frontier) status = dead ? "fail" : st === "DEPLOYED" ? "pass" : "now";
    else status = "wait";
    return { key: d.key, label: d.label, sub: d.sub, status };
  });
}

export function resolveGateJourney({ lifecycleState, signals }: JourneyInput): Gate[] {
  const dead = lifecycleState === "GRAVEYARD" || lifecycleState === "DECLINING";
  const deployed = lifecycleState === "DEPLOYED";
  let frontierAssigned = false;
  let failAssigned = false;
  return GATE_DEFS.map((d) => {
    const passed = d.key === "live_money" ? deployed : Boolean(signals[d.signal]);
    let status: GateStatus;
    if (passed) status = "pass";
    else if (dead && !failAssigned) { status = "fail"; failAssigned = true; }
    else if (!dead && !frontierAssigned) { status = "now"; frontierAssigned = true; }
    else status = "wait";
    return { key: d.key, label: d.label, sub: d.sub, status };
  });
}
