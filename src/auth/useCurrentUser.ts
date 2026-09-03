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
    select: (response) => response.data,
  });
}
