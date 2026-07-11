/**
 * carter-correlation-context.ts — deep-scan Carter F-1 (2026-07-06).
 *
 * Links the OUTER Carter audit rows (carter.tool_invoked / carter.tool_failed, written in carter-tools.ts
 * with the HTTP-request correlationId = req.id) to the INNER rows (carter.action_executed +
 * lifecycle.* fan-out) so a single Carter tool call is joinable end-to-end on ONE correlationId
 * (CLAUDE.md §2: bar→handler→DB→SSE→audit_log). Previously the inner rows minted a fresh randomUUID that
 * never touched req.id, leaving two unlinked audit rows per call.
 *
 * carter-tools.ts runs the handler inside `runWithCarterCorrelationId(reqId, () => handler(...))`;
 * auditActionExecuted + the lifecycle-fanning confirm handlers default their correlationId to
 * `getCarterCorrelationId()` (the ambient req.id) before falling back to a fresh UUID.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const carterCorrelationStore = new AsyncLocalStorage<string>();

/** Run `fn` with `correlationId` (the HTTP req.id) as the ambient Carter correlation id. */
export function runWithCarterCorrelationId<T>(correlationId: string | null | undefined, fn: () => T): T {
  if (correlationId == null) return fn();
  return carterCorrelationStore.run(correlationId, fn);
}

/** The ambient Carter correlation id (req.id) for the current async context, or undefined outside one. */
export function getCarterCorrelationId(): string | undefined {
  return carterCorrelationStore.getStore();
}
