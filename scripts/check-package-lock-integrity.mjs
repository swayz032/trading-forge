#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function findVersionlessPackageEntries(lockfile) {
  const packages = lockfile?.packages;
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) {
    throw new Error('package-lock.json must contain a "packages" object');
  }

  const invalid = [];
  for (const [packagePath, metadata] of Object.entries(packages)) {
    if (packagePath === "" || metadata?.link === true) continue;
    if (
      !metadata ||
      typeof metadata !== "object" ||
      typeof metadata.version !== "string" ||
      metadata.version.trim() === ""
    ) {
      invalid.push(packagePath);
    }
  }
  return invalid;
}

export function checkPackageLock(lockfile) {
  const invalid = findVersionlessPackageEntries(lockfile);
  if (invalid.length > 0) {
    throw new Error(
      [
        "versionless non-link package entries:",
        ...invalid.map((packagePath) => `  - ${packagePath}`),
      ].join("\n"),
    );
  }
  return Object.entries(lockfile.packages).filter(
    ([packagePath, metadata]) => packagePath !== "" && metadata?.link !== true,
  ).length;
}

function main() {
  const lockPath = resolve(process.cwd(), process.argv[2] ?? "package-lock.json");
  try {
    const lockfile = JSON.parse(readFileSync(lockPath, "utf8"));
    const checked = checkPackageLock(lockfile);
    console.log(`package-lock integrity PASS: ${checked} package entries checked`);
  } catch (error) {
    console.error(`package-lock integrity FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
