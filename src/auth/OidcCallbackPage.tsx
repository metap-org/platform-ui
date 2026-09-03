import { useEffect } from "react";
import { Alert, buttonVariants } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthContext";
import { useNavigationAdapter } from "../navigation/NavigationContext";

/**
 * Route target for `crates/metap-auth::OidcConfig`'s `post_login_redirect` — the backend's
 * `GET /auth/oidc/{tenantId}/callback` mints the session the exact same way a local login does and
 * sets it as a cookie directly on its own redirect response, so by the time the browser lands
 * here the session already exists; this page has nothing to extract from the URL.
 *
 * That's a change from the original design (2026-09-03): the callback used to hand the minted JWT
 * to the browser as a `#token=...` URL fragment, which this page read, stored, and scrubbed from
 * history. Once the backend moved to cookie-based sessions
 * (`docs/audits/02-auth-permission-workflow-diagram-audit.md`'s follow-up), embedding the token in
 * the URL at all — even a fragment immediately wiped — stopped being the best available option:
 * a `Set-Cookie` header on the redirect achieves the same "keep it out of server logs/`Referer`"
 * goal without the token ever touching the address bar or session history in the first place.
 *
 * So this page now does the same thing every other route does to find out whether the caller is
 * signed in: reads `useAuth().status`, which resolves via the ordinary `GET /auth/me` bootstrap
 * check. `"authenticated"` means the redirect's cookie took — go home. `"anonymous"` means either
 * the OIDC flow genuinely failed before ever reaching this cookie-setting step, or someone opened
 * this URL directly without going through login at all; either way there's nothing to recover
 * client-side, so this shows a plain failure state with a way back to login.
 */
export function OidcCallbackPage() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const navAdapter = useNavigationAdapter();

  useEffect(() => {
    if (status === "authenticated") {
      navAdapter.navigate(navAdapter.toHome(), { replace: true });
    }
  }, [status, navAdapter]);

  if (status === "anonymous") {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4 py-8">
        <Alert variant="destructive">{t("common.signInFailed")}</Alert>
        <a href={navAdapter.toLogin()} className={buttonVariants({ variant: "outline" })}>
          {t("common.backToLogin")}
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-sm text-foreground">{t("common.signingIn")}</p>
    </div>
  );
}
