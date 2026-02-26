import { useEffect, useRef } from "react";

export function useSSE(
  url: string | null,
  handlers: Record<string, (data: unknown) => void>,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);

    for (const event of Object.keys(handlersRef.current)) {
      es.addEventListener(event, (e: MessageEvent) => {
        try {
          handlersRef.current[event]?.(JSON.parse(e.data));
        } catch {
          /* ignore parse errors */
        }
      });
    }

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [url]);
}
