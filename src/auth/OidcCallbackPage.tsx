import { useEffect, useState } from "react";
import { Alert, buttonVariants } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthContext";
import { useNavigationAdapter } from "../navigation/NavigationContext";

/**
 * Route target for `crates/metap-auth::OidcConfig`'s `post_login_redirect` — the backend's
 * `GET /auth/oidc/{tenantId}/callback` appends the minted session JWT as a URL fragment
 * (`#token=...`, never a query param: fragments never reach server access logs or `Referer`
 * headers), so this page's only job is to read it out of `window.location.hash` and hand it to
 * `setToken`, exactly like `LoginForm` does after a local login — from here on an OIDC session is
 * indistinguishable from a local one to the rest of the app.
 *
 * Two things this page owes that fragment-based handoff, both added 2026-09-03
 * (`docs/audits/02-auth-permission-workflow-diagram-audit.md` findings B3/B4). First, the token is
 * scrubbed from the URL the moment it's read (`history.replaceState`) and the redirect home
 * *replaces* rather than pushes — otherwise the whole point of keeping the JWT out of logs is
 * given back by leaving `#token=<JWT>` one Back-button press away in session history. Second, a
 * callback that arrives without a usable token (the IdP denied the request and sent `#error=...`,
 * or someone opened this URL directly) now says so and offers a way out, instead of sitting on
 * "Signing you in…" forever with no token ever coming.
 */
export function OidcCallbackPage() {
  const { t } = useTranslation();
  const { setToken } = useAuth();
  const navAdapter = useNavigationAdapter();
  // Read once, during the first render rather than inside the effect below. The effect then only
  // performs side effects and never calls `setState`, which is both what the lint rule
  // (`react/set-state-in-effect`) asks for and simpler: whether a token was present is a fact
  // about the URL this page was opened with, not state that evolves.
  const [token] = useState(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const hash = window.location.hash;
    return hash.startsWith("#token=") ? decodeURIComponent(hash.slice("#token=".length)) : null;
  });

  useEffect(() => {
    if (!token) {
      return;
    }
    // Before `setToken`, so the credential stops being part of the address as early as possible —
    // `replaceState` rewrites the current entry in place rather than adding another one.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setToken(token);
    navAdapter.navigate(navAdapter.toHome(), { replace: true });
  }, [token, setToken, navAdapter]);

  if (!token) {
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
