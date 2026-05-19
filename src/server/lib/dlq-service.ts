import { db } from "../db/index.js";
import { deadLetterQueue } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { notifyCritical } from "../services/notification-service.js";

/**
 * Capture a failed operation to the Dead Letter Queue.
 */
export async function captureToDLQ(params: {
  operationType: string;
  entityType?: string;
  entityId?: string;
  errorMessage: string;
  metadata?: Record<string, unknown>;
  maxRetries?: number;
}): Promise<string> {
  const now = new Date();
  const [item] = await db.insert(deadLetterQueue).values({
    operationType: params.operationType,
    entityType: params.entityType ?? null,
    entityId: params.entityId ?? null,
    errorMessage: params.errorMessage,
    retryCount: 0,
    maxRetries: params.maxRetries ?? 3,
    firstFailedAt: now,
    lastFailedAt: now,
    metadata: params.metadata ?? null,
  }).returning();

  logger.warn(
    { dlqId: item.id, operationType: params.operationType, entityId: params.entityId },
    "Operation captured to DLQ",
  );

  return item.id;
}

/**
 * Registry of retry handlers by operation type.
 * Each handler should re-attempt the original operation.
 */
const retryHandlers = new Map<string, (item: typeof deadLetterQueue.$inferSelect) => Promise<void>>();

export function registerRetryHandler(
  operationType: string,
  handler: (item: typeof deadLetterQueue.$inferSelect) => Promise<void>,
): void {
  retryHandlers.set(operationType, handler);
}

/**
 * Retry a single DLQ item by ID.
 * Returns true if resolved, false if retry failed.
 */
export async function retryDLQItem(id: string): Promise<boolean> {
  const [item] = await db.select().from(deadLetterQueue).where(eq(deadLetterQueue.id, id));
  if (!item) throw new Error(`DLQ item ${id} not found`);
  if (item.resolved) return true; // Already resolved

  const handler = retryHandlers.get(item.operationType);
  if (!handler) {
    logger.warn({ dlqId: id, operationType: item.operationType }, "No retry handler registered for operation type");
    return false;
  }

  try {
    await handler(item);
    // Success — mark resolved
    await db.update(deadLetterQueue)
      .set({ resolved: true, resolvedAt: new Date() })
      .where(eq(deadLetterQueue.id, id));
    logger.info({ dlqId: id, operationType: item.operationType }, "DLQ item resolved via retry");
    return true;
  } catch (err) {
    // Retry failed — increment counter
    await db.update(deadLetterQueue)
      .set({
        retryCount: item.retryCount + 1,
        lastFailedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(deadLetterQueue.id, id));
    logger.warn(
      { dlqId: id, operationType: item.operationType, attempt: item.retryCount + 1 },
      "DLQ retry failed",
    );
    return false;
  }
}

/**
 * Retry all unresolved items that haven't exceeded max retries.
 */
export async function retryAllUnresolved(): Promise<{ attempted: number; resolved: number }> {
  const items = await db.select().from(deadLetterQueue)
    .where(and(
      eq(deadLetterQueue.resolved, false),
      eq(deadLetterQueue.escalated, false),
      sql`${deadLetterQueue.retryCount} < ${deadLetterQueue.maxRetries}`,
    ))
    .limit(50); // Process in batches

  let resolved = 0;
  for (const item of items) {
    try {
      const success = await retryDLQItem(item.id);
      if (success) resolved++;
    } catch (err) {
      logger.error({ dlqId: item.id, err }, "DLQ retry threw unexpectedly");
    }
  }

  if (items.length > 0) {
    logger.info({ attempted: items.length, resolved }, "DLQ batch retry complete");
  }
  return { attempted: items.length, resolved };
}

/**
 * Escalate items that have exceeded max retries.
 * Sends Discord alert and marks as escalated.
 */
export async function escalateDLQ(): Promise<number> {
  const items = await db.select().from(deadLetterQueue)
    .where(and(
      eq(deadLetterQueue.resolved, false),
      eq(deadLetterQueue.escalated, false),
      sql`${deadLetterQueue.retryCount} >= ${deadLetterQueue.maxRetries}`,
    ));

  for (const item of items) {
    await db.update(deadLetterQueue)
      .set({ escalated: true })
      .where(eq(deadLetterQueue.id, item.id));

    notifyCritical(
      `DLQ Escalation: ${item.operationType}`,
      `Operation ${item.operationType} failed after ${item.retryCount} retries.\nEntity: ${item.entityType}/${item.entityId}\nError: ${item.errorMessage}`,
      { dlqId: item.id, operationType: item.operationType, entityId: item.entityId },
    );

    logger.error(
      { dlqId: item.id, operationType: item.operationType, retryCount: item.retryCount },
      "DLQ item escalated — max retries exceeded",
    );
  }

  return items.length;
}

/**
 * Get DLQ health metrics.
 */
export async function getDLQMetrics() {
  const [metrics] = await db.select({
    total: sql<number>`count(*)::int`,
    unresolved: sql<number>`count(*) filter (where resolved = false)::int`,
    escalated: sql<number>`count(*) filter (where escalated = true and resolved = false)::int`,
    avgRetries: sql<number>`coalesce(avg(retry_count)::numeric(4,1), 0)`,
    oldestUnresolved: sql<string>`min(first_failed_at) filter (where resolved = false)`,
  }).from(deadLetterQueue);

  return metrics;
}
