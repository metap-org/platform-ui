import { useApiQuery } from "../api/useApiQuery";

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
 * are deliberately never encoded on the JWT itself (looked up fresh per request server-side). */
export function useCurrentUser() {
  return useApiQuery<{ data: CurrentUser }, CurrentUser>(
    ["currentUser"],
    "/auth/me",
    (response) => response.data,
  );
}
