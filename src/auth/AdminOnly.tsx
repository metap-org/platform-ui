import type { ReactNode } from "react";
import { Alert, Spinner } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useCurrentUser } from "./useCurrentUser";

/** The role name the backend itself checks — `metap_permission::RequestContext::is_admin` matches
 * the literal `"admin"`, and `metap-http`'s `AdminContext` extractor rejects anything else before a
 * single `/admin/*` handler runs. Hardcoded here for exactly that reason: this gate can only ever
 * agree with the server, never hide a page from someone the server would have let in. */
const ADMIN_ROLE = "admin";

/**
 * Wraps an admin screen so a non-admin sees a plain "you don't have access" message instead of the
 * page rendering in full, firing its `/admin/*` requests, and painting error alerts once each one
 * comes back 403. Purely presentational — the server enforces the real boundary either way (see
 * `Can`'s doc comment); this exists so the four admin pages this package exports don't depend on
 * every consumer remembering to gate the route themselves
 * (`docs/audits/02-auth-permission-workflow-diagram-audit.md` finding B6).
 *
 * Distinct from `Can` in one way that matters: roles arrive asynchronously via `GET /auth/me`, and
 * `Can` treats "still loading" as "not allowed" — correct for hiding a button, wrong for a whole
 * page, where it would flash the denial message at an admin before their roles land. This waits.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading || !user) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user.roles.includes(ADMIN_ROLE)) {
    return (
      <div className="mx-auto max-w-md py-8">
        <Alert variant="destructive">{t("admin.notAuthorized")}</Alert>
      </div>
    );
  }

  return <>{children}</>;
}
