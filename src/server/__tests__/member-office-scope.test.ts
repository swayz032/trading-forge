// src/server/__tests__/member-office-scope.test.ts — per-member wall scoping (Tier-2 item 6).
// The two hard rules under test: Carter is operator-only BY ROUTE (not by UI hiding), and a
// member reaches exactly their own room. Both fail-closed — a scoping bug that fails open is a
// privacy breach between family members, so every unknown input must DENY.
import { describe, it, expect } from "vitest";
import {
  OFFICE_SURFACES,
  OPERATOR_ONLY_SURFACES,
  evaluateOfficeScope,
  visibleSurfaces,
  type OfficeSurface,
} from "../lib/member-office-scope.js";

const member = (surface: OfficeSurface, over: Record<string, unknown> = {}) =>
  evaluateOfficeScope({ role: "member", viewerId: "m1", surface, targetMemberId: "m1", pinSatisfied: true, ...over });

describe("Carter is operator-only BY ROUTE", () => {
  it("denies a member Carter even with a valid PIN and their own identity", () => {
    const d = member("carter");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("carter_is_operator_only");
  });

  it("denies Carter to a member no matter how the request is shaped", () => {
    for (const over of [
      { targetMemberId: null },
      { targetMemberId: "m1" },
      { pinSatisfied: true },
      { viewerId: "operator" },      // a member role claiming an operator-ish id
    ]) {
      expect(member("carter", over).allowed).toBe(false);
    }
  });

  it("allows the operator Carter", () => {
    expect(evaluateOfficeScope({ role: "operator", viewerId: "op", surface: "carter" }).allowed).toBe(true);
  });
});

describe("members reach exactly their own room", () => {
  it("allows a member their own room and the surfaces inside it", () => {
    for (const s of ["my_room", "connect_card", "ready_checklist", "agent_heartbeat", "payout_tracker"] as OfficeSurface[]) {
      expect(member(s).allowed).toBe(true);
    }
  });

  it("DENIES a member another member's room (cross-member is the privacy breach)", () => {
    const d = member("my_room", { targetMemberId: "m2" });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("cross_member_denied");
  });

  it("denies every operator-only surface to a member", () => {
    for (const s of OPERATOR_ONLY_SURFACES) {
      expect(member(s).allowed).toBe(false);
    }
  });
});

describe("PIN is a real second factor", () => {
  it("denies the member's own room until the PIN is satisfied", () => {
    expect(member("my_room", { pinSatisfied: false }).reason).toBe("pin_required");
    expect(member("my_room", { pinSatisfied: undefined }).reason).toBe("pin_required");
    // Explicitly: only boolean true counts. A truthy string must not pass.
    expect(member("my_room", { pinSatisfied: "yes" }).allowed).toBe(false);
  });

  it("does not let a missing PIN leak operator surfaces either", () => {
    expect(member("carter", { pinSatisfied: false }).allowed).toBe(false);
  });
});

describe("fail-closed on anything unrecognised", () => {
  it("denies unknown roles, identities and surfaces", () => {
    expect(evaluateOfficeScope({ role: "admin", viewerId: "x", surface: "my_room" }).reason).toBe("unknown_role");
    expect(evaluateOfficeScope({ role: null, viewerId: "x", surface: "my_room" }).reason).toBe("unknown_role");
    expect(evaluateOfficeScope({ role: "member", viewerId: "", surface: "my_room" }).reason).toBe("no_identity");
    expect(evaluateOfficeScope({ role: "member", viewerId: null, surface: "my_room" }).reason).toBe("no_identity");
    expect(member("nope" as OfficeSurface).reason).toBe("unknown_surface");
  });

  it("denies on an empty/garbage request rather than throwing", () => {
    // @ts-expect-error deliberate hostile input
    expect(evaluateOfficeScope({}).allowed).toBe(false);
    // @ts-expect-error deliberate hostile input
    expect(evaluateOfficeScope(undefined).allowed).toBe(false);
  });
});

describe("visibleSurfaces", () => {
  it("gives a PIN-cleared member exactly their five room surfaces — and never Carter", () => {
    const v = visibleSurfaces("member", "m1", true);
    expect(v.sort()).toEqual(["agent_heartbeat", "connect_card", "my_room", "payout_tracker", "ready_checklist"]);
    expect(v).not.toContain("carter");
  });

  it("gives a member nothing before the PIN", () => {
    expect(visibleSurfaces("member", "m1", false)).toEqual([]);
  });

  it("gives the operator every surface", () => {
    expect(visibleSurfaces("operator", "op", true).sort()).toEqual([...OFFICE_SURFACES].sort());
  });
});

// Guard against a future surface being added without an access decision being made for it.
describe("surface coverage", () => {
  it("every surface is either member-allowed or explicitly operator-only", () => {
    const memberAllowed = visibleSurfaces("member", "m1", true);
    const unclassified = OFFICE_SURFACES.filter(
      (s) => !memberAllowed.includes(s) && !OPERATOR_ONLY_SURFACES.includes(s),
    );
    expect(unclassified).toEqual([]);
  });
});
