import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  checkPackageLock,
  findUnresolvedPackageDependencies,
  findVersionlessPackageEntries,
} from "../../check-package-lock-integrity.mjs";

test("accepts versioned packages and link entries", () => {
  const lockfile = {
    packages: {
      "": { version: "0.1.0" },
      "node_modules/example": { version: "1.2.3" },
      "node_modules/workspace-link": { link: true },
    },
  };

  assert.deepEqual(findVersionlessPackageEntries(lockfile), []);
  assert.equal(checkPackageLock(lockfile), 1);
});

test("rejects the malformed optional-dependency stub that breaks Linux npm ci", () => {
  const lockfile = {
    packages: {
      "": { version: "0.1.0" },
      "node_modules/minipass-fetch/node_modules/encoding": { optional: true },
    },
  };

  assert.deepEqual(findVersionlessPackageEntries(lockfile), [
    "node_modules/minipass-fetch/node_modules/encoding",
  ]);
  assert.throws(
    () => checkPackageLock(lockfile),
    /versionless non-link package entries/,
  );
});

test("rejects a declared optional dependency whose package metadata was stripped", () => {
  const lockfile = {
    packages: {
      "": { version: "0.1.0" },
      "node_modules/minipass-fetch": {
        version: "3.0.5",
        optionalDependencies: { encoding: "^0.1.13" },
      },
    },
  };

  assert.deepEqual(findUnresolvedPackageDependencies(lockfile), [
    {
      packagePath: "node_modules/minipass-fetch",
      dependencyName: "encoding",
    },
  ]);
  assert.throws(
    () => checkPackageLock(lockfile),
    /declared dependencies missing from the lockfile package graph/,
  );
});

test("accepts a dependency hoisted to the root package directory", () => {
  const lockfile = {
    packages: {
      "": { version: "0.1.0" },
      "node_modules/minipass-fetch": {
        version: "3.0.5",
        optionalDependencies: { encoding: "^0.1.13" },
      },
      "node_modules/encoding": { version: "0.1.13" },
    },
  };

  assert.deepEqual(findUnresolvedPackageDependencies(lockfile), []);
  assert.equal(checkPackageLock(lockfile), 2);
});

test("rejects empty versions and malformed package metadata", () => {
  const lockfile = {
    packages: {
      "": { version: "0.1.0" },
      "node_modules/empty": { version: "  " },
      "node_modules/null": null,
    },
  };

  assert.deepEqual(findVersionlessPackageEntries(lockfile), [
    "node_modules/empty",
    "node_modules/null",
  ]);
});

test("fails closed when the packages object is absent", () => {
  assert.throws(
    () => findVersionlessPackageEntries({}),
    /must contain a "packages" object/,
  );
});

test("every GitHub Actions npm ci is guarded by lockfile validation", () => {
  for (const workflowPath of [
    ".github/workflows/ci.yml",
    ".github/workflows/fast.yml",
  ]) {
    const lines = readFileSync(workflowPath, "utf8").split(/\r?\n/);
    const installLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /\bnpm ci\b/.test(line) && !/^\s*#/.test(line));

    assert.ok(installLines.length > 0, `${workflowPath} must run npm ci`);
    for (const { index } of installLines) {
      const precedingGuardWindow = lines.slice(Math.max(0, index - 12), index);
      assert.ok(
        precedingGuardWindow.some((line) =>
          line.includes("node scripts/check-package-lock-integrity.mjs"),
        ),
        `${workflowPath}:${index + 1} runs npm ci without a preceding lockfile guard`,
      );
    }
  }
});
