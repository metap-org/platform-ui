import { useApiQuery } from "../api/useApiQuery";
import { useCurrentUser } from "./useCurrentUser";

export type TenantUser = { id: string; email: string };
type UsersResponse = { data: TenantUser[] };

/** `GET /users` (`crates/metap-http/src/routes/users.rs`) — every user in the current tenant, the
 * "pick a user" primitive an assignee/reporter/watcher picker needs. Platform-level (every
 * `@metap/platform-ui` consumer's backend exposes this route, not specific to any one entity or
 * app) — moved here 2026-08-31 from `apps/jira-fe`'s `IssuePanels.tsx`, the first consumer to
 * need it, once it was clear the logic itself had nothing jira-specific in it. */
export function useTenantUsers(): TenantUser[] {
  const { data } = useApiQuery<UsersResponse, TenantUser[]>(
    ["tenant-users"],
    "/users",
    (r) => r.data,
  );
  return data ?? [];
}

/** The logged-in caller's own email — the JWT only carries `sub` (a user id), never email
 * (`crates/metap-http/src/auth.rs`'s `Claims`), so this cross-references `GET /auth/me`'s
 * `userId` against the tenant user list rather than needing a new backend field. */
export function useCurrentUserEmail(): string | null {
  const { data: me } = useCurrentUser();
  const users = useTenantUsers();
  return users.find((u) => u.id === me?.userId)?.email ?? null;
}
