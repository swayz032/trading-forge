// src/server/lib/member-office-scope.ts — per-member Slumhouse office wall scoping.
//
// ONE shared Office page, DIFFERENT offices: each member lands only in THEIR own room
// (operator directive, OR-003 §1). This module is the single place that decides what a
// signed-in identity may see, so the answer cannot drift between routes.
//
// TWO HARD RULES, both enforced here rather than in the UI:
//   1. CARTER IS OPERATOR-ONLY (OR-003 §1-addendum). Members get no Carter tile, no Carter
//      chat, no Carter route — and must not reach ANY Carter surface by guessing a URL. The
//      UI hiding it is not enforcement; this is.
//   2. A member sees exactly their own room. Never another member's, never the aggregate.
//
// Fail-CLOSED throughout: an unknown role, a missing identity, or an unrecognised surface
// DENIES. A scoping bug that fails open is a privacy breach between family members.
export type OfficeRole = "operator" | "member";

/** Every addressable Office surface. Adding one here forces an explicit access decision. */
export const OFFICE_SURFACES = [
  "my_room",          // the member's own office
  "connect_card",     // floating broker-connect card (TEST MODE ONLY)
  "ready_checklist",
  "agent_heartbeat",
  "payout_tracker",
  "reporting_room",   // operator's Reporting Room (night reports)
  "approvals",        // deploy approvals
  "conveyor",
  "risk",
  "carter",           // OPERATOR ONLY — never member-reachable
  "all_members",      // the roster view
] as const;

export type OfficeSurface = (typeof OFFICE_SURFACES)[number];

/** Surfaces a member may reach at all. Everything absent from this set is operator-only. */
const MEMBER_ALLOWED: ReadonlySet<OfficeSurface> = new Set<OfficeSurface>([
  "my_room",
  "connect_card",
  "ready_checklist",
  "agent_heartbeat",
  "payout_tracker",
]);

/** Named explicitly so the ban is greppable and testable, not merely implied by absence. */
export const OPERATOR_ONLY_SURFACES: readonly OfficeSurface[] = [
  "carter",
  "reporting_room",
  "approvals",
  "conveyor",
  "risk",
  "all_members",
];

export interface ScopeRequest {
  role: OfficeRole | string | null | undefined;
  /** Discord identity of the caller. */
  viewerId: string | null | undefined;
  surface: OfficeSurface | string;
  /** Whose room is being requested; null for surfaces that aren't room-scoped. */
  targetMemberId?: string | null;
  /** True only once the member has cleared their PIN this session. */
  pinSatisfied?: boolean;
}

export interface ScopeDecision {
  allowed: boolean;
  reason: string;
}

const DENY = (reason: string): ScopeDecision => ({ allowed: false, reason });

export function evaluateOfficeScope(req: ScopeRequest): ScopeDecision {
  const { role, viewerId, surface, targetMemberId, pinSatisfied } = req ?? ({} as ScopeRequest);

  // Fail-closed on anything we don't recognise.
  if (role !== "operator" && role !== "member") return DENY("unknown_role");
  if (typeof viewerId !== "string" || viewerId.length === 0) return DENY("no_identity");
  if (!OFFICE_SURFACES.includes(surface as OfficeSurface)) return DENY("unknown_surface");

  const s = surface as OfficeSurface;

  // The operator sees everything. Carter included — and only here.
  if (role === "operator") return { allowed: true, reason: "operator" };

  // ── member ──
  if (!MEMBER_ALLOWED.has(s)) {
    // Carter gets its own reason string so a denial is unmistakable in the audit trail.
    return DENY(s === "carter" ? "carter_is_operator_only" : "operator_only_surface");
  }

  // Room-scoped surfaces: a member may only ever address their own room.
  if (targetMemberId != null && targetMemberId !== viewerId) return DENY("cross_member_denied");

  // The PIN is a second factor: required for the member's room and anything inside it.
  if (pinSatisfied !== true) return DENY("pin_required");

  return { allowed: true, reason: "member_own_room" };
}

/** Convenience for rendering: the surfaces this viewer may actually see. */
export function visibleSurfaces(
  role: OfficeRole | string | null | undefined,
  viewerId: string | null | undefined,
  pinSatisfied: boolean,
): OfficeSurface[] {
  return OFFICE_SURFACES.filter(
    (s) => evaluateOfficeScope({ role, viewerId, surface: s, targetMemberId: viewerId, pinSatisfied }).allowed,
  );
}
