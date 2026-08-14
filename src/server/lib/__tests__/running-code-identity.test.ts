import { describe, expect, it, vi } from "vitest";
import { readRunningCodeIdentity } from "../running-code-identity.js";

describe("readRunningCodeIdentity", () => {
  it("uses a command-local safe.directory override so Windows services can identify the checkout", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce("abc123\n")
      .mockReturnValueOnce(" M src/server/index.ts\n");

    expect(readRunningCodeIdentity(undefined, run)).toEqual({ commit: "abc123", dirty: true });
    expect(run).toHaveBeenNthCalledWith(1, "git", ["-c", "safe.directory=*", "rev-parse", "HEAD"]);
    expect(run).toHaveBeenNthCalledWith(2, "git", ["-c", "safe.directory=*", "status", "--porcelain"]);
  });

  it("fails closed when code identity cannot be read", () => {
    const run = vi.fn(() => {
      throw new Error("git unavailable");
    });

    expect(readRunningCodeIdentity(undefined, run)).toEqual({ commit: "unknown", dirty: true });
  });
});
