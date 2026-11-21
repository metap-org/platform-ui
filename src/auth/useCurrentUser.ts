import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

export type CurrentUser = {
  userId: string | null;
  tenantId: string;
  /** `null` when the backend couldn't resolve it (no matching `users` row, or a token whose `sub`
   * isn't a real user) — the field is additive and best-effort server-side, so never assume it's
   * present. Older backends predating 2026-09-03 omit it entirely, which lands here as
   * `undefined`; `useCurrentUserEmail` normalizes both to `null`. */
  email?: string | null;
  roles: string[];
};

/** How long the caller's own record counts as fresh. React Query refetches a stale query every time
 *  a component that reads it mounts, and this record is read by the shell *and* by most pages
 *  (`AdminOnly`, `Can`, the Users and Workspace pages, ...): with the default `staleTime` of 0 every
 *  navigation to such a page re-asked `GET /auth/me`. The session is kept alive by `AuthProvider`'s
 *  own 20-minute poll (that one ignores `staleTime`), and login, logout, tenant switch and a 401
 *  anywhere refetch it explicitly, so a few minutes of freshness only delays seeing a role change
 *  made while someone was already signed in. */
export const CURRENT_USER_STALE_MS = 5 * 60 * 1000;

/** Backed by `GET /auth/me` — the frontend's only way to know the caller's roles, since roles
 * are deliberately never encoded on the JWT itself (looked up fresh per request server-side).
 *
 * Bypasses the `useApiQuery` wrapper deliberately (calls `useQuery`/`apiFetch` directly, `retry:
 * false`) rather than going through the usual `status === "authenticated"` gate: this exact query,
 * under the exact same `["currentUser"]` key, is what `AuthContext`'s `AuthProvider` uses to
 * *derive* that status in the first place — gating it on the status it produces would mean it can
 * never run. React-query dedupes by query key, so `AuthProvider`'s own copy of this same query and
 * every `useCurrentUser()` call site share one cached result and one in-flight request, not a
 * fetch each. A 401 here (not logged in) is an expected, unretried outcome, not a fetch error to
 * keep hammering. */
export function useCurrentUser() {
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: () => apiFetch<{ data: CurrentUser }>("/auth/me"),
    retry: false,
    staleTime: CURRENT_USER_STALE_MS,
    select: (response) => response.data,
  });
}
