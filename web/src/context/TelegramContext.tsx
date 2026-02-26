import { createContext, useContext, useCallback, type ReactNode } from "react";
import { usePolling } from "../hooks/usePolling.ts";
import { api } from "../api/client.ts";
import type { TelegramStatus } from "../api/types.ts";

const TelegramContext = createContext<TelegramStatus | null>(null);

export function TelegramProvider({ children }: { children: ReactNode }) {
  const fetcher = useCallback(() => api<TelegramStatus>("/telegram/status"), []);
  const { data } = usePolling(fetcher, 30_000);
  return <TelegramContext.Provider value={data}>{children}</TelegramContext.Provider>;
}

export function useTelegram(): TelegramStatus | null {
  return useContext(TelegramContext);
}
