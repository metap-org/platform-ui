import { useEffect, useState } from "react";
import { Alert, Button, buttonVariants, Input, Separator } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { apiFetch, ApiError } from "../api/client";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { useAuth } from "./AuthContext";
import { tenantLabel } from "./accountApi";

type ProvidersResponse = { data: { providers: string[] } };

type TenantChoice = { tenantId: string; name: string | null };

/** `POST /auth/login`'s body: a session (token), or — for a person in several tenants who has
 *  not picked one — the tenants to choose from, with no session yet. */
type LoginResponse = {
  data: { token?: string; tenantId?: string; selectTenant?: boolean; tenants?: TenantChoice[] };
};

const LOGIN_ERROR_KEYS: Record<string, string> = {
  invalid_credentials: "login.invalidCredentials",
  account_locked: "login.accountLocked",
  account_disabled: "login.accountDisabled",
  no_tenant_access: "login.noTenantAccess",
};

type LoginFormProps = {
  /**
   * Optional — most callers (`apps/crm-fe`, `apps/jira-fe` today) omit it and rely on
   * `POST /auth/login`'s global-by-email fallback, unchanged. Pass it once a caller actually
   * has a tenant to log into (e.g. after a tenant-picker step) to also enable the SSO button
   * below, which needs a `tenantId` to know which IdP to redirect to
   * (`GET /auth/oidc/{tenantId}/login`) — there is no tenant-picker UI in this package itself.
   */
  tenantId?: string;
};

export function LoginForm({ tenantId }: LoginFormProps = {}) {
  const { t } = useTranslation();
  const { markAuthenticated } = useAuth();
  const navAdapter = useNavigationAdapter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [choices, setChoices] = useState<TenantChoice[] | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    apiFetch<ProvidersResponse>(`/auth/providers?tenantId=${encodeURIComponent(tenantId)}`)
      .then((response) => setOidcEnabled(response.data.providers.includes("oidc")))
      .catch(() => setOidcEnabled(false));
  }, [tenantId]);

  async function handleSubmit(chosenTenant?: string) {
    setError(null);
    setSubmitting(true);
    const loginTenant = chosenTenant ?? tenantId;
    try {
      // `POST /auth/login` sets the session cookie itself (`Set-Cookie`, `HttpOnly`) — this
      // response's own JSON body still carries a bearer token for non-browser callers, but this
      // form has nothing to do with it now that the cookie is what makes every later request
      // authenticated (`docs/audits/02-auth-permission-workflow-diagram-audit.md`'s follow-up).
      const response = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          ...(loginTenant ? { tenantId: loginTenant } : {}),
        }),
      });
      if (response.data.selectTenant) {
        // Several tenants and none remembered: the person picks, then the same credentials are
        // posted again with that tenant (the password never leaves this component's state).
        setChoices(response.data.tenants ?? []);
        return;
      }
      // Awaited (2026-09-04, `markAuthenticated`'s own doc comment on the `AuthContext` interface)
      // — by the time this resolves, `status` has already settled to "authenticated", so the
      // destination route's `RequireAuth` can't read a stale "anonymous" and bounce back here.
      await markAuthenticated();
      navAdapter.navigate(navAdapter.toHome());
    } catch (err) {
      const key = err instanceof ApiError ? LOGIN_ERROR_KEYS[err.code] : undefined;
      if (key) {
        setError(t(key));
      } else {
        setError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (choices) {
    return (
      <div className="mx-auto max-w-xs py-8">
        <h2 className="mb-1 text-xl font-semibold text-foreground">{t("login.chooseTenant")}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t("login.chooseTenantHint")}</p>
        {error ? (
          <Alert variant="destructive" className="mb-4">
            {error}
          </Alert>
        ) : null}
        <div className="flex flex-col gap-2">
          {choices.map((choice) => (
            <Button
              key={choice.tenantId}
              variant="outline"
              className="justify-start"
              disabled={submitting}
              onClick={() => void handleSubmit(choice.tenantId)}
            >
              {tenantLabel(choice, (id) => t("shell.unnamedTenant", { id }))}
            </Button>
          ))}
          <Button
            variant="ghost"
            onClick={() => {
              setChoices(null);
              setError(null);
            }}
          >
            {t("login.back")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xs py-8">
      <h2 className="mb-4 text-xl font-semibold text-foreground">{t("login.title")}</h2>
      {error ? (
        <Alert variant="destructive" className="mb-4">
          {error}
        </Alert>
      ) : null}
      <div className="flex flex-col gap-4">
        <Input
          label={t("login.email")}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          onKeyDown={(event) => event.key === "Enter" && void handleSubmit()}
        />
        <Input
          label={t("login.password")}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          onKeyDown={(event) => event.key === "Enter" && void handleSubmit()}
        />
        <Button
          onClick={() => void handleSubmit()}
          disabled={email.trim().length === 0 || password.length === 0}
          loading={submitting}
        >
          {t("login.submit")}
        </Button>
        <navAdapter.Link
          to="/forgot-password"
          className="self-center text-sm text-primary hover:underline"
        >
          {t("account.forgotLink")}
        </navAdapter.Link>
        {oidcEnabled && tenantId ? (
          <>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">{t("login.orDivider")}</span>
              <Separator className="flex-1" />
            </div>
            <a
              href={`/auth/oidc/${encodeURIComponent(tenantId)}/login`}
              className={buttonVariants({ variant: "outline" })}
            >
              {t("login.ssoButton")}
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}
