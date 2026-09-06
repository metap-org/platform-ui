// Platform-admin tenant-switcher (`../../../metap-lowcode/docs/features/01-platform-admin-tenant-switcher.md`)
// — backend lives entirely in `metap-lowcode`'s `metap-control-http`, an optional surface a
// consuming app merges into its router (see that crate's own doc comment), not `metap` core.
// Response shapes hand-typed here rather than pulled from `generated-types.ts`, same convention
// `adminApi.ts`'s own ops-style endpoints (`useCreateAdminUser`, etc.) already use — these are
// admin JSON responses, not `EntitySummary`-shaped domain data.
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { useApiQuery } from "../api/useApiQuery";

export type PlatformTenant = {
  id: string;
  tier: string;
  status: "active" | "suspended" | "deleted";
  strategy: { type: "schema" | "dedicated_db"; schemaName?: string; dsnSecretRef?: string };
  createdAt: string;
  trialExpiresAt: string | null;
};

export function usePlatformTenants(enabled: boolean) {
  return useApiQuery<{ data: PlatformTenant[] }, PlatformTenant[]>(
    ["platform", "tenants"],
    "/platform/tenants",
    (response) => response.data,
    enabled,
  );
}

export type ImpersonationStatus =
  { impersonating: true; expiresAt: string } | { impersonating: false };

/** `staleTime: 0` (React Query's own default refetch-on-mount/refocus stays on) rather than
 *  polling on a timer — the banner catching up a little late after a session silently expires
 *  mid-tab-away is an acceptable gap, not worth a dedicated interval for a session that already
 *  self-expires server-side regardless of what this shows. Not gated on `platform_admin`
 *  (`useApiQuery`'s `enabled`) — a caller mid-impersonation no longer holds that role (see
 *  `impersonation_status`'s own doc comment, `metap-control-http`), so this must run for *every*
 *  authenticated user to ever notice their own impersonation ending. */
export function useImpersonationStatus() {
  return useApiQuery<{ data: ImpersonationStatus }, ImpersonationStatus>(
    ["platform", "impersonationStatus"],
    "/platform/impersonation-status",
    (response) => response.data,
    true,
    { staleTime: 0 },
  );
}

/** Plain `apiFetch` + manual invalidation, not `useApiMutation` — `impersonate`'s path is
 *  per-tenant (same reason `useAdminRoleActions` isn't a bound mutation hook either), and both
 *  actions here need to invalidate the *same* 2 query keys, so keeping them in one hook avoids
 *  repeating that list. Both actions swap the session cookie server-side (`Set-Cookie` on the
 *  response) — `credentials: "include"` (already the default for every `apiFetch` call) is all
 *  the frontend needs to do to pick up the new session on its very next request; invalidating
 *  `currentUser` just makes the UI (roles badge, email) reflect it immediately instead of after
 *  the next incidental refetch. */
export function useImpersonationActions() {
  const queryClient = useQueryClient();

  async function invalidateAfterSwitch() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["currentUser"] }),
      queryClient.invalidateQueries({ queryKey: ["platform", "impersonationStatus"] }),
    ]);
  }

  async function startImpersonation(tenantId: string) {
    await apiFetch(`/platform/tenants/${tenantId}/impersonate`, { method: "POST" });
    await invalidateAfterSwitch();
  }

  async function exitImpersonation() {
    await apiFetch("/platform/exit-impersonation", { method: "POST" });
    await invalidateAfterSwitch();
  }

  return { startImpersonation, exitImpersonation };
}
