/**
 * useStrategyEvidence — fetch cross-validation provenance for a strategy.
 *
 * Backs the Evidence tab on the Strategy Detail page (Pass 19 Track B).
 * Endpoint: GET /api/strategies/:id/evidence
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { StrategyEvidenceResponse } from "@/types/strategy-evidence";

export function useStrategyEvidence(id: string | undefined) {
  return useQuery({
    queryKey: ["strategies", id, "evidence"],
    queryFn: () =>
      api.get<StrategyEvidenceResponse>(`/strategies/${id}/evidence`),
    enabled: !!id,
    staleTime: 30_000,
  });
}
