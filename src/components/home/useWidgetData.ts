"use client";

import { useQuery } from "@tanstack/react-query";
import { widgetDef } from "@/lib/home/registry";

export class WidgetHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * One widget's data from /api/home/widgets/[id] (prompt 24b). Each widget loads on its own, so a
 * slow one never holds the page; refreshed on focus and every `refreshMs` (60 s for live figures).
 */
export function useWidgetData<T>(id: string, params: Record<string, string | undefined> = {}, enabled = true) {
  const def = widgetDef(id);
  const search = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return useQuery({
    queryKey: ["home-widget", id, search],
    enabled: enabled && !!def?.remote,
    queryFn: async (): Promise<{ data: T; at: string }> => {
      const res = await fetch(`/api/home/widgets/${id}${search ? `?${search}` : ""}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { data?: T; at?: string; error?: string };
      if (!res.ok) throw new WidgetHttpError(res.status, body.error ?? "error");
      return { data: body.data as T, at: body.at ?? new Date().toISOString() };
    },
    refetchInterval: def?.refreshMs,
    refetchOnWindowFocus: true,
    staleTime: Math.min(def?.refreshMs ?? 60_000, 60_000) / 2,
    retry: (count, err) => !(err instanceof WidgetHttpError && (err.status === 403 || err.status === 404)) && count < 2,
  });
}
