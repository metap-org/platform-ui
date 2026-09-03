import { useApiQuery } from "../api/useApiQuery";
import { useCurrentUser } from "./useCurrentUser";

export type TenantUser = { id: string; email: string };
type UsersResponse = { data: TenantUser[] };

/** `GET /users` (`crates/metap-http/src/routes/users.rs`) — every user in the current tenant, the
 * "pick a user" primitive an assignee/reporter/watcher picker needs. Platform-level (every
 * `@metap/platform-ui` consumer's backend exposes this route, not specific to any one entity or
 * app) — moved here 2026-08-31 from `apps/jira-fe`'s `IssuePanels.tsx`, the first consumer to
 * need it, once it was clear the logic itself had nothing jira-specific in it.
 *
 * `enabled` defaults to `true` (every existing call site is unaffected); pass `false` to skip the
 * request entirely for a caller that turns out not to need the list — see `useCurrentUserEmail`
 * below, which now only falls back to it against a backend too old to return `email` on
 * `/auth/me`. `staleTime` is 5 minutes because this is a slow-moving list (a tenant gains users
 * rarely) that would otherwise re-fetch on every window focus under React Query's default of `0`. */
export function useTenantUsers(enabled: boolean = true): TenantUser[] {
  const { data } = useApiQuery<UsersResponse, TenantUser[]>(
    ["tenant-users"],
    "/users",
    (r) => r.data,
    enabled,
    { staleTime: 5 * 60 * 1000 },
  );
  return data ?? [];
}

/** The logged-in caller's own email. The JWT only carries `sub` (a user id), never email
 * (`crates/metap-http/src/auth.rs`'s `Claims`), so this used to cross-reference `GET /auth/me`'s
 * `userId` against the **whole tenant user list** — one `GET /users` for every user in the tenant,
 * re-fetched on every window focus, from `AppShellLayout` (i.e. on every page) just to render one
 * address in the header. Fine at a handful of users, badly wasteful past that
 * (`docs/audits/02-auth-permission-workflow-diagram-audit.md` finding B8).
 *
 * `GET /auth/me` now returns `email` directly (2026-09-03), so the common path costs nothing
 * beyond the `useCurrentUser()` call every consumer already makes. The tenant-list lookup stays as
 * a fallback purely for backend compatibility — an older backend omits the field — and is skipped
 * entirely (`enabled: false`, so no request at all) whenever `/auth/me` did supply it. */
export function useCurrentUserEmail(): string | null {
  const { data: me } = useCurrentUser();
  const needsFallback = me !== undefined && me.email == null;
  const users = useTenantUsers(needsFallback);
  if (me?.email != null) {
    return me.email;
  }
  return users.find((u) => u.id === me?.userId)?.email ?? null;
}
