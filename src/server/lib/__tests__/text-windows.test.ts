import { describe, it, expect } from "vitest";
import { toWindows } from "../text-windows.js";

describe("toWindows — punctuation-less transcript handling", () => {
  it("keeps normal sentences intact", () => {
    expect(toWindows("First sentence. Second sentence!")).toEqual(["First sentence.", "Second sentence!"]);
  });

  it("chops a long run-on (no punctuation) into multiple windows", () => {
    const runon = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" "); // ~900 chars, no punctuation
    const w = toWindows(runon, 240, 60);
    expect(w.length).toBeGreaterThan(1);
    expect(w.every((x) => x.length <= 240 + 60 + 10)).toBe(true); // bounded by maxChars + overlap tail
  });

  it("empty/whitespace → []", () => {
    expect(toWindows("")).toEqual([]);
    expect(toWindows("   ")).toEqual([]);
  });
});
