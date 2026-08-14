import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const script = path.resolve(import.meta.dirname, "..", "register-api-liveness-watchdog-task.ps1");

function findPowerShell() {
  return ["powershell", "pwsh"].find((candidate) => {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"], { windowsHide: true });
    return !probe.error && probe.status === 0;
  });
}

const powerShell = process.platform === "win32" ? findPowerShell() : null;
const windowsTest = powerShell ? test : test.skip;

windowsTest("watchdog registration descriptor is a five-minute LocalSystem observer", () => {
  const output = execFileSync(
    powerShell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Describe"],
    { encoding: "utf8", timeout: 30_000, windowsHide: true },
  );
  const descriptor = JSON.parse(output);

  assert.equal(descriptor.taskName, "TF-ApiLivenessWatchdog");
  assert.equal(descriptor.intervalMinutes, 5);
  assert.equal(descriptor.userId, "SYSTEM");
  assert.equal(descriptor.runLevel, "Highest");
  assert.match(descriptor.installedScriptPath, /[\\/]bin[\\/]watchdogs[\\/]api-liveness-watchdog\.ps1$/i);
  assert.match(descriptor.arguments, /-NoProfile -ExecutionPolicy Bypass -File/);
});
