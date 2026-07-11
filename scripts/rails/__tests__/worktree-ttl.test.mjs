import { describe, expect, it } from "vitest";

import {
  parseWorktreePorcelain,
  summarizeWorktrees,
} from "../worktree-ttl.cjs";

const DAY = 86_400_000;

describe("summarizeWorktrees", () => {
  it("lists only worktrees older than the TTL, oldest first", () => {
    const now = 100 * DAY;
    const result = summarizeWorktrees([
      { path: "repo", branch: "main", isMain: true, mtimeMs: now - 90 * DAY, uniqueCommits: 0 },
      { path: "wt-a", branch: "x", isMain: false, mtimeMs: now - DAY, uniqueCommits: 2 },
      { path: "wt-b", branch: "y", isMain: false, mtimeMs: now - 30 * DAY, uniqueCommits: 0 },
      { path: "wt-c", branch: "z", isMain: false, mtimeMs: now - 9 * DAY, uniqueCommits: 5 },
    ], now, 7);

    expect(result.stale.map((entry) => entry.path)).toEqual(["wt-b", "wt-c"]);
    expect(result.stale[1].uniqueCommits).toBe(5);
    expect(result.count).toBe(2);
  });

  it("does not mark the exact TTL boundary stale", () => {
    const now = 20 * DAY;
    const result = summarizeWorktrees([
      { path: "wt", branch: "x", isMain: false, mtimeMs: now - 7 * DAY, uniqueCommits: 0 },
    ], now, 7);

    expect(result.stale).toEqual([]);
  });

  it("reports unreadable activity or commit evidence separately", () => {
    const result = summarizeWorktrees([
      { path: "wt-a", branch: "x", isMain: false, mtimeMs: null, uniqueCommits: 1 },
      { path: "wt-b", branch: "y", isMain: false, mtimeMs: 0, uniqueCommits: null },
    ], 10 * DAY, 7);

    expect(result.unreadable.map((entry) => entry.path)).toEqual(["wt-a", "wt-b"]);
  });

  it("fails closed on an invalid TTL", () => {
    expect(() => summarizeWorktrees([], Date.now(), Number.NaN)).toThrow(
      "worktree_ttl_invalid",
    );
  });
});

describe("parseWorktreePorcelain", () => {
  it("parses branch and detached worktrees and marks the primary checkout", () => {
    const text = `worktree C:/repo
HEAD abc123
branch refs/heads/main

worktree C:/wt-one
HEAD def456
branch refs/heads/feature/one
locked reason here

worktree C:/wt-two
HEAD fed999
detached
`;

    expect(parseWorktreePorcelain(text)).toEqual([
      { path: "C:/repo", head: "abc123", branch: "main", isMain: true, locked: false },
      { path: "C:/wt-one", head: "def456", branch: "feature/one", isMain: false, locked: true },
      { path: "C:/wt-two", head: "fed999", branch: null, isMain: false, locked: false },
    ]);
  });
});
