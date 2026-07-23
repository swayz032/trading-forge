import assert from "node:assert/strict";
import test from "node:test";

import {
  checkPackageLock,
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
