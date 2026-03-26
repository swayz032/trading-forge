import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { TournamentResult } from "@/types/api";

export function useTournament() {
  return useQuery({
    queryKey: ["tournament", "latest"],
    queryFn: () => api.get<TournamentResult>("/tournament/latest"),
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ["tournament", "leaderboard"],
    queryFn: async () => {
      const res = await api.get<{ strategies: any[] } | any[]>("/tournament/leaderboard");
      return Array.isArray(res) ? res : res.strategies ?? [];
    },
  });
}
