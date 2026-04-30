import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

/**
 * Execute a function while holding a PostgreSQL advisory lock for the given session.
 * Uses pg_advisory_xact_lock which auto-releases when the transaction commits/rolls back.
 *
 * The lock key is derived from hashtext(sessionId) to produce a stable int4.
 * This prevents concurrent position mutations on the same session.
 */
export async function withSessionLock<T>(
  sessionId: string,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  if (process.env.TF_POSITION_LOCKING !== "1") {
    // Feature flag disabled — run without lock
    return fn(db);
  }

  return db.transaction(async (tx) => {
    // Acquire advisory lock — blocks until available or timeout
    // 5s timeout prevents deadlocks
    await tx.execute(sql`SET LOCAL statement_timeout = '5000'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`);
    await tx.execute(sql`SET LOCAL statement_timeout = '0'`);  // Reset for the actual work

    return fn(tx as unknown as typeof db);
  });
}
