import { useQuery } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "./client";

/** Extra `useQuery` knobs a caller occasionally needs beyond the four positional params above —
 *  kept as a trailing options bag (not more positional params) since these are the exception, not
 *  the common case (most calls only ever pass `queryKey`/`path`/`select`/`enabled`). */
type ApiQueryOptions<TFetched> = {
  /** How long fetched data stays "fresh" (no automatic background refetch on remount/window
   *  focus) — omit for the React Query default (`0`, i.e. always refetch). Pass `Infinity` for
   *  data that only ever changes via an explicit action this app already invalidates on (e.g.
   *  `useEntity`/`useEntities` — entity metadata never changes mid-session except through the
   *  low-code publish/rollback/enable actions in `adminApi.ts`, which invalidate these same query
   *  keys directly rather than relying on a timed re-fetch). */
  staleTime?: number;
  /** Seeds the query with data already sitting in another query's cache, skipping the network
   *  request entirely when it's available — same shape `TFetched` the real fetch would produce.
   *  A function (not a plain value) so it's evaluated per-mount against the *current* cache
   *  rather than captured once at the caller's render. Return `undefined` to fall through to a
   *  real fetch, same as omitting `initialData` altogether. */
  initialData?: () => TFetched | undefined;
};

export function useApiQuery<TFetched, TSelected = TFetched>(
  queryKey: QueryKey,
  path: string,
  select?: (data: TFetched) => TSelected,
  enabled: boolean = true,
  options?: ApiQueryOptions<TFetched>,
) {
  const { status } = useAuth();

  return useQuery({
    queryKey,
    queryFn: () => apiFetch<TFetched>(path),
    select,
    enabled: status === "authenticated" && enabled,
    staleTime: options?.staleTime,
    initialData: options?.initialData,
  });
}
