/**
 * GET /slumhouse/api/anam-greeting — personalised greeting + Q&A material for the Anam
 * persona, assembled from RECEIPTS THAT ALREADY EXIST (charter Tier-2 item 7).
 *
 * ★ READ-ONLY CONSUMER. This route performs SELECTs only. It creates no critique, grades
 * nothing, and writes nothing — it renders receipts the trade-critique service already
 * produced. If it ever needs to compute a judgement, that is a different lane's work.
 *
 * ★★ PRIVACY IS THE HARD PART, NOT THE GREETING. One Office page, different offices: a member
 * must see THEIR room and never another member's, never the aggregate (member-office-scope.ts).
 * Trade critiques are keyed by `account_id`; a signed-in identity is a Discord user id. The
 * bridge is `slumhouse_users.broker_account_id`, which the schema documents as "null until the
 * operator manually maps each friend."
 *
 * So the scoping rule is FAIL-CLOSED and it is the load-bearing line in this file:
 *   • no row, or `broker_account_id IS NULL`  → ZERO trade receipts. A generic welcome.
 *   • mapped                                   → only rows WHERE account_id = that id.
 * There is deliberately no "otherwise show recent activity" branch. An unmapped member seeing
 * the aggregate would be a privacy breach between family members, and a greeting is exactly the
 * kind of friendly surface where such a leak would look like a feature.
 *
 * Carter is operator-only and is not reachable from here — this route exposes no Carter surface.
 */
import { Router, type Response } from "express";
import { requireSlumhouseUser, type SlumhouseRequest } from "../../../lib/slumhouse/require-session.js";
import { logger } from "../../../lib/logger.js";

/** How many recent critiques the greeting may draw on. Small on purpose — a greeting, not a report. */
const RECENT_LIMIT = 5;

/**
 * The plain-English block the trade-critique service writes into
 * `trade_critique.plain_english_summary`. Shape mirrors `PlainEnglishSummary` in
 * trade-critique-service.ts — read from the producer rather than guessed.
 */
interface PlainEnglishBlock {
  grade?: string;
  one_liner?: string;
  what_went_right?: string;
  what_to_watch?: string;
  action_needed?: string;
}

export interface AnamGreetingResponse {
  /** One sentence the persona can open with. Always present. */
  greeting: string;
  /** Plain-English lines drawn from existing receipts. Empty when unmapped — never a fallback. */
  talkingPoints: string[];
  /** Why there is no trade content, when there is none. Null when receipts were found. */
  emptyReason: "not_mapped" | "no_critiques_yet" | null;
  receiptCount: number;
}

/**
 * Injectable readers. The privacy rule is the one property in this file that must never
 * regress, so it is testable WITHOUT a database — a rule that can only be checked against live
 * postgres is a rule that stops being checked.
 */
export interface GreetingDeps {
  /** Returns the member row, or null when the identity has none. */
  readUser: (discordUserId: string) => Promise<{ displayName: string; brokerAccountId: string | null } | null>;
  /** MUST be called only with a non-null account id. Returns that account's recent critiques. */
  readCritiques: (accountId: string) => Promise<Array<{ grade: string; pes: unknown }>>;
}

// ★ The real readers import the DB LAZILY. An eager `import { db }` executes a live database
// connection at module load, which meant importing this route — even to test its privacy rule —
// required a database. A safety property that can only be checked against live postgres is a
// property that stops being checked.
const defaultDeps: GreetingDeps = {
  readUser: async (discordUserId) => {
    const { db } = await import("../../../db/index.js");
    const { slumhouseUsers } = await import("../../../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ displayName: slumhouseUsers.displayName, brokerAccountId: slumhouseUsers.brokerAccountId })
      .from(slumhouseUsers)
      .where(eq(slumhouseUsers.discordUserId, discordUserId))
      .limit(1);
    return row ?? null;
  },
  readCritiques: async (accountId) => {
    const { db } = await import("../../../db/index.js");
    const { tradeCritique } = await import("../../../db/schema.js");
    const { desc, eq } = await import("drizzle-orm");
    return await db
      .select({ grade: tradeCritique.grade, pes: tradeCritique.plainEnglishSummary })
      .from(tradeCritique)
      .where(eq(tradeCritique.accountId, accountId))
      .orderBy(desc(tradeCritique.critiquedAt))
      .limit(RECENT_LIMIT);
  },
};

export async function getAnamGreeting(
  req: SlumhouseRequest,
  res: Response,
  deps: GreetingDeps = defaultDeps,
): Promise<void> {
  const discordUserId = req.slumhouseUser?.discordUserId;
  if (!discordUserId) {
    // requireSlumhouseUser should have caught this; fail closed rather than assume.
    res.status(401).json({ error: "not_signed_in" });
    return;
  }

  try {
    const user = await deps.readUser(discordUserId);
    const name = user?.displayName?.trim() || "friend";

    // ── FAIL-CLOSED GATE ──────────────────────────────────────────────────────
    // No mapping means no scope, and no scope means no trade content. Not "show
    // something generic from the pool" — nothing.
    if (!user?.brokerAccountId) {
      res.json({
        greeting: `Welcome back, ${name}.`,
        talkingPoints: [],
        emptyReason: "not_mapped",
        receiptCount: 0,
      } satisfies AnamGreetingResponse);
      return;
    }

    const rows = await deps.readCritiques(user.brokerAccountId);

    if (rows.length === 0) {
      res.json({
        greeting: `Welcome back, ${name}. Nothing new to go over yet.`,
        talkingPoints: [],
        emptyReason: "no_critiques_yet",
        receiptCount: 0,
      } satisfies AnamGreetingResponse);
      return;
    }

    // Render the receipts as-is. No re-grading, no re-interpretation — the critique service's
    // words are the receipt; paraphrasing them here would make this a second, unaudited judge.
    const talkingPoints: string[] = [];
    for (const row of rows) {
      const pes = (row.pes ?? {}) as PlainEnglishBlock;
      if (pes.one_liner) talkingPoints.push(pes.one_liner);
      if (pes.action_needed) talkingPoints.push(`What to do: ${pes.action_needed}`);
    }

    const latest = (rows[0].pes ?? {}) as PlainEnglishBlock;
    const greeting = latest.one_liner
      ? `Welcome back, ${name}. Last trade graded ${rows[0].grade}: ${latest.one_liner}`
      : `Welcome back, ${name}. Your last trade graded ${rows[0].grade}.`;

    res.json({
      greeting,
      talkingPoints,
      emptyReason: null,
      receiptCount: rows.length,
    } satisfies AnamGreetingResponse);
  } catch (err) {
    // A greeting must never take the Office down, and must never fall back to another
    // member's data on error. Fail closed to a plain welcome.
    logger.warn({ err, discordUserId }, "anam-greeting: receipt lookup failed — serving plain welcome");
    res.status(200).json({
      greeting: "Welcome back.",
      talkingPoints: [],
      emptyReason: "no_critiques_yet",
      receiptCount: 0,
    } satisfies AnamGreetingResponse);
  }
}

export const anamGreetingRouter = Router();
// Wrapped rather than passed directly: Express supplies `next` as the third argument, which
// would land in the `deps` slot and silently replace the real readers with a function.
anamGreetingRouter.get("/slumhouse/api/anam-greeting", requireSlumhouseUser, (req, res) =>
  getAnamGreeting(req as SlumhouseRequest, res),
);
