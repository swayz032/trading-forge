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

function dependencyCandidates(packagePath, dependencyName) {
  const candidates = [];
  let current = packagePath;
  while (current) {
    candidates.push(`${current}/node_modules/${dependencyName}`);
    const nestedBoundary = current.lastIndexOf("/node_modules/");
    if (nestedBoundary === -1) break;
    current = current.slice(0, nestedBoundary);
  }
  candidates.push(`node_modules/${dependencyName}`);
  return [...new Set(candidates)];
}

export function findUnresolvedPackageDependencies(lockfile) {
  const packages = lockfile?.packages;
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) {
    throw new Error('package-lock.json must contain a "packages" object');
  }

  const unresolved = [];
  for (const [packagePath, metadata] of Object.entries(packages)) {
    if (!metadata || typeof metadata !== "object") continue;
    const declared = {
      ...(metadata.dependencies ?? {}),
      ...(metadata.optionalDependencies ?? {}),
    };
    for (const dependencyName of Object.keys(declared)) {
      const resolved = dependencyCandidates(packagePath, dependencyName).some(
        (candidate) => packages[candidate] && typeof packages[candidate] === "object",
      );
      if (!resolved) {
        unresolved.push({ packagePath: packagePath || "<root>", dependencyName });
      }
    }
  }
  return unresolved;
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
  const unresolved = findUnresolvedPackageDependencies(lockfile);
  if (unresolved.length > 0) {
    throw new Error(
      [
        "declared dependencies missing from the lockfile package graph:",
        ...unresolved.map(
          ({ packagePath, dependencyName }) => `  - ${packagePath} -> ${dependencyName}`,
        ),
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
