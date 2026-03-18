import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ComplianceRuleset, ComplianceDrift } from "@/types/api";

export function useRulesets() {
  return useQuery({
    queryKey: ["compliance", "rulesets"],
    queryFn: async () => {
      const res = await api.get<{ rulesets: ComplianceRuleset[] } | ComplianceRuleset[]>("/compliance/rulesets");
      return Array.isArray(res) ? res : res.rulesets ?? [];
    },
  });
}

export function useDrift() {
  return useQuery({
    queryKey: ["compliance", "drift"],
    queryFn: async () => {
      const res = await api.get<{ drifts: ComplianceDrift[] } | ComplianceDrift[]>("/compliance/drift/unresolved");
      return Array.isArray(res) ? res : res.drifts ?? [];
    },
  });
}

export function useGate() {
  return useQuery({
    queryKey: ["compliance", "gate"],
    queryFn: () => api.get<any>("/compliance/gate/today"),
  });
}
