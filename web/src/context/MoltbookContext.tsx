import { createContext, useContext, useCallback, type ReactNode } from "react";
import { usePolling } from "../hooks/usePolling.ts";
import { api } from "../api/client.ts";
import type { MoltbookStatus } from "../api/types.ts";

const MoltbookContext = createContext<MoltbookStatus | null>(null);

export function MoltbookProvider({ children }: { children: ReactNode }) {
  const fetcher = useCallback(() => api<MoltbookStatus>("/moltbook/status"), []);
  const { data } = usePolling(fetcher, 30_000);
  return <MoltbookContext.Provider value={data}>{children}</MoltbookContext.Provider>;
}

export function useMoltbook(): MoltbookStatus | null {
  return useContext(MoltbookContext);
}
