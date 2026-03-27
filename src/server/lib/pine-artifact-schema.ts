import { z } from "zod";

export const pineCompileRequestSchema = z.object({
  strategyId: z.string().uuid(),
  firmKey: z.string().optional(),
  exportType: z.enum(["pine_indicator", "pine_strategy", "alert_only"]).default("pine_indicator"),
});

export const pineExportResponseSchema = z.object({
  id: z.string().uuid(),
  strategyId: z.string().uuid(),
  exportType: z.string(),
  exportabilityScore: z.number(),
  exportabilityBand: z.string(),
  status: z.string(),
  artifacts: z.array(z.object({
    id: z.string().uuid(),
    artifactType: z.string(),
    fileName: z.string(),
    sizeBytes: z.number(),
  })).optional(),
});

export type PineCompileRequest = z.infer<typeof pineCompileRequestSchema>;
export type PineExportResponse = z.infer<typeof pineExportResponseSchema>;
