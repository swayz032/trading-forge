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
