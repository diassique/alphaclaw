import { createContext, useContext, useCallback, type ReactNode } from "react";
import { usePolling } from "../hooks/usePolling.ts";
import { api } from "../api/client.ts";
import type { HealthAllResponse } from "../api/types.ts";

const StatusContext = createContext<HealthAllResponse | null>(null);

export function StatusProvider({ children }: { children: ReactNode }) {
  const fetcher = useCallback(() => api<HealthAllResponse>("/health-all"), []);
  const { data } = usePolling(fetcher, 10_000);
  return <StatusContext.Provider value={data}>{children}</StatusContext.Provider>;
}

export function useStatus(): HealthAllResponse | null {
  return useContext(StatusContext);
}
