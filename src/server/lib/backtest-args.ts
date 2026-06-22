/**
 * backtest-args.ts — Pure helper for building Python backtester subprocess args.
 *
 * Extracted as a zero-import leaf module so tests can import it without
 * pulling in the full backtest-service.ts chain (which imports Express,
 * DB, and dozens of services).
 *
 * Wave hardening 2026-06-22 (G1a) — fixes the defect where --b15-battery was
 * NEVER passed to the Python subprocess, so backtests.b15_battery was always null
 * and the PAPER→DEPLOY_READY lifecycle gate's B15 check always short-circuited.
 */

/**
 * Build the CLI args array passed to the Python backtester subprocess.
 *
 * B15_BATTERY_ENABLED must match the lifecycle gate default in lifecycle-service.ts:
 *   `(process.env.B15_BATTERY_ENABLED ?? "false") === "true"`
 * Default is FALSE so the battery is advisory-only until explicitly opted in.
 * When the flag flips to true the producer (this function) and the consumer
 * (lifecycle B15 gate) both activate simultaneously — no silent mismatch.
 */
export function buildBacktestArgs(opts: {
  backtestId: string;
  mode: string;
  strategyClass?: string | null;
  b15BatteryEnabled?: boolean;
}): string[] {
  const args: string[] = [
    "--backtest-id", opts.backtestId,
    "--mode", opts.mode,
    ...(opts.strategyClass ? ["--strategy-class", opts.strategyClass] : []),
  ];
  // Wave hardening 2026-06-22 (G1a): conditionally pass --b15-battery so the
  // Python backtester actually runs SDR/PSI/RWS and emits the B15_BATTERY_JSON
  // sentinel. Previously the flag was NEVER passed, so backtests.b15_battery
  // was always null and the lifecycle gate's `if (latestBtForB15?.b15Battery)`
  // guard short-circuited on every run.
  const batteryOn = opts.b15BatteryEnabled ?? ((process.env.B15_BATTERY_ENABLED ?? "false") === "true");
  if (batteryOn) {
    args.push("--b15-battery");
  }
  return args;
}
