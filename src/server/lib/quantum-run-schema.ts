import { z } from "zod";

export const quantumRunRequestSchema = z.object({
  backtestId: z.string().uuid(),
  eventType: z.enum(["breach", "ruin", "target_hit", "tail_loss"]).default("breach"),
  firmKey: z.string().optional().default("topstep_50k"),
  threshold: z.number().optional(),
  epsilon: z.number().positive().optional().default(0.01),
  alpha: z.number().positive().max(0.5).optional().default(0.05),
  backend: z.string().optional(),
});

export const hybridCompareRequestSchema = z.object({
  backtestId: z.string().uuid(),
  eventType: z.enum(["breach", "ruin", "target_hit", "tail_loss"]).default("breach"),
  firmKey: z.string().optional().default("topstep_50k"),
  threshold: z.number().optional(),
});

export type QuantumRunRequest = z.infer<typeof quantumRunRequestSchema>;
export type HybridCompareRequest = z.infer<typeof hybridCompareRequestSchema>;
