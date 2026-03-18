import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export function useDecayDashboard() {
  return useQuery({
    queryKey: ["decay", "dashboard"],
    queryFn: () => api.get<any>("/decay/dashboard"),
  });
}
