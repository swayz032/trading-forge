#!/usr/bin/env node
/**
 * Self-healing tower launcher — institutional-grade boot resilience.
 *
 * WHY: On this box `node_modules` is intermittently incomplete at restart time
 * (concurrent worktree/npm activity in a second session can transiently prune
 * shared packages — see memory reference_tower_restart_dep_wipe_trap). When NSSM
 * respawned `tsx src/server/index.ts` directly and a dep like `dotenv`/`drizzle-orm`
 * was missing, the process crashed on its very first import → NSSM throttled →
 * the service stuck in `Paused` → full outage requiring an elevated resume.
 *
 * WHAT: NSSM runs THIS file with plain `node` (no third-party deps needed to
 * start). It verifies the critical deps, runs `npm install` to self-heal if any
 * are missing, then launches the real tower via tsx as a supervised child and
 * forwards signals/exit codes so the existing HMAC self-restart flow is preserved.
 *
 * ACTIVATE (one-time, elevated): repoint the NSSM service to this launcher —
 *   & "C:\Users\tonio\bin\nssm\nssm.exe" set TradingForgeAPI AppParameters ^
 *       "C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\tower-boot.mjs"
 *   Restart-Service TradingForgeAPI
 * (Application stays C:\Program Files\nodejs\node.exe.)
 */
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
// tsx first — without it the launcher cannot start the TS tower at all.
const CRITICAL = ["tsx", "dotenv", "drizzle-orm", "postgres", "express", "pino", "zod"];
const MAX_INSTALL_MS = 10 * 60 * 1000;

const log = (m) => console.log(`[tower-boot ${new Date().toISOString()}] ${m}`);
const missingDeps = () => CRITICAL.filter((d) => !existsSync(join(ROOT, "node_modules", d)));

function selfHeal() {
  let missing = missingDeps();
  if (missing.length === 0) {
    log(`all ${CRITICAL.length} critical deps present`);
    return true;
  }
  log(`MISSING deps: ${missing.join(", ")} — running npm install (self-heal)`);
  // Resolve npm robustly for the LocalSystem service account (PATH may differ):
  // invoke npm-cli.js with the same node binary running this launcher.
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const useCli = existsSync(npmCli);
  const cmd = useCli ? process.execPath : "npm";
  const args = useCli
    ? [npmCli, "install", "--no-audit", "--no-fund"]
    : ["install", "--no-audit", "--no-fund"];
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: !useCli, timeout: MAX_INSTALL_MS });
  if (r.status !== 0) {
    log(`npm install exited ${r.status ?? "null"} (signal ${r.signal ?? "none"}) — aborting boot so NSSM retries`);
    return false;
  }
  missing = missingDeps();
  if (missing.length) {
    log(`STILL missing after install: ${missing.join(", ")} — aborting boot`);
    return false;
  }
  log("deps healed OK");
  return true;
}

if (!selfHeal()) process.exit(1); // NSSM AppRestartDelay will retry the heal

log("launching tower via tsx…");
const tsxCli = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const child = spawn(process.execPath, [tsxCli, join(ROOT, "src", "server", "index.ts")], {
  cwd: ROOT,
  stdio: "inherit",
});

const forward = (sig) => { try { child.kill(sig); } catch { /* child already gone */ } };
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
  process.on(sig, () => { log(`received ${sig} — forwarding to tower`); forward(sig); });
}
child.on("exit", (code, signal) => {
  log(`tower exited (code=${code ?? "null"} signal=${signal ?? "none"}) — launcher exiting so NSSM respawns`);
  process.exit(code == null ? 1 : code);
});
child.on("error", (err) => {
  log(`failed to spawn tower: ${err?.message ?? err}`);
  process.exit(1);
});
