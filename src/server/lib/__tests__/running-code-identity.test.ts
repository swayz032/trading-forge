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

  it("does not let a matching environment commit bypass dirty-state verification", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce("abc123\n")
      .mockReturnValueOnce(" M src/server/index.ts\n");

    expect(readRunningCodeIdentity("abc123", run)).toEqual({ commit: "abc123", dirty: true });
    expect(run).toHaveBeenNthCalledWith(1, "git", ["-c", "safe.directory=*", "rev-parse", "HEAD"]);
    expect(run).toHaveBeenNthCalledWith(2, "git", ["-c", "safe.directory=*", "status", "--porcelain"]);
  });

  it("fails closed when the environment commit disagrees with the checkout", () => {
    const run = vi.fn().mockReturnValueOnce("abc123\n").mockReturnValueOnce("");

    expect(readRunningCodeIdentity("claimed-sha", run)).toEqual({ commit: "abc123", dirty: true });
  });

  it("reports clean only when the environment commit matches a clean checkout", () => {
    const run = vi.fn().mockReturnValueOnce("abc123\n").mockReturnValueOnce("");

    expect(readRunningCodeIdentity("abc123", run)).toEqual({ commit: "abc123", dirty: false });
  });

  it("retains environment attribution but fails closed when Git is unavailable", () => {
    const run = vi.fn(() => {
      throw new Error("git unavailable");
    });

    expect(readRunningCodeIdentity("build-sha", run)).toEqual({ commit: "build-sha", dirty: true });
  });
});
