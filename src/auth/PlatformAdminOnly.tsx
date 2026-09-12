import type { ReactNode } from "react";
import { Alert, Spinner } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useCurrentUser } from "./useCurrentUser";

/** The role name the backend itself checks — `metap_http::auth::PlatformAdminContext` rejects
 * anything but the literal `"platform_admin"` before a `/platform/*` handler runs (see
 * `AppShellLayout.tsx`'s existing `useHasRole("platform_admin")` gate on the tenant-switcher
 * dropdown). Hardcoded here for the same reason `AdminOnly.tsx`'s `ADMIN_ROLE` is: this gate can
 * only ever agree with the server, never hide a page from someone the server would have let in.
 */
const PLATFORM_ADMIN_ROLE = "platform_admin";

/**
 * `AdminOnly`'s platform-level counterpart — wraps a cross-tenant admin screen (tenant
 * provisioning, wave rollout, ...) so a caller who only holds the per-tenant `"admin"` role sees a
 * plain "you don't have access" message instead of the page rendering in full and firing
 * `platform_admin`-gated GraphQL/REST calls that would come back 403. Purely presentational — the
 * server enforces the real boundary either way (`PlatformAdminContext`); this exists so a new
 * platform-admin page doesn't depend on every consumer remembering to gate the route themselves,
 * same reasoning as `AdminOnly`'s own doc comment.
 *
 * Distinct from `Can` in the same way `AdminOnly` is: roles arrive asynchronously via
 * `GET /auth/me`, and `Can` treats "still loading" as "not allowed" — correct for hiding a button,
 * wrong for a whole page, where it would flash the denial message at a platform admin before their
 * roles land. This waits.
 */
export function PlatformAdminOnly({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading || !user) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user.roles.includes(PLATFORM_ADMIN_ROLE)) {
    return (
      <div className="mx-auto max-w-md py-8">
        <Alert variant="destructive">{t("admin.notAuthorized")}</Alert>
      </div>
    );
  }

  return <>{children}</>;
}
