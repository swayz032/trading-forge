/**
 * Shared lifecycle + evolution constants.
 *
 * Track E F-2: MAX_GENERATIONS is the single authoritative source for both
 * evolution-service.ts and critic-optimizer-service.ts. Both import from here.
 * A DB CHECK constraint (generation >= 0 AND generation <= 3) is added via
 * migration 0125b (Track B) to enforce the cap at the database layer.
 */

/** Hard cap on evolution depth. Must match DB CHECK constraint in migration 0125b. */
export const MAX_GENERATIONS = 3;

/** Cooldown in days between evolution attempts on the same lineage. */
export const COOLDOWN_DAYS = 7;
