import { useApiQuery } from "../api/useApiQuery";
import type { EntitySummary } from "./types";

/** `staleTime: Infinity` — entity metadata never changes mid-session except through the low-code
 *  publish/rollback/enable actions (`adminApi.ts`'s `useLowCodeActions`), which explicitly
 *  invalidate this exact query key when they swap the live registry. Without this, React Query's
 *  default `staleTime: 0` meant every remount of a page using this hook (or every window focus)
 *  fired a background refetch of data that, in the overwhelmingly common case, was never going to
 *  have changed. */
export function useEntities() {
  return useApiQuery<{ data: EntitySummary[] }, EntitySummary[]>(
    ["entities"],
    "/metadata/entities",
    (response) => response.data,
    true,
    { staleTime: Infinity },
  );
}
