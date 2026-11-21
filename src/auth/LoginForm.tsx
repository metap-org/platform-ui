import { useEffect, useState } from "react";
import { Alert, Button, buttonVariants, Input, Separator } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { apiFetch, ApiError } from "../api/client";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { useAuth } from "./AuthContext";
import { tenantLabel, useSignupOpen } from "./accountApi";
import { MfaCodeInput, MfaEnrollmentFlow } from "./MfaEnrollment";
import {
  beginRequiredMfaSetup,
  confirmRequiredMfaSetup,
  describeMfaError,
  discoverSso,
  loginWithMfaCode,
} from "./securityApi";

type ProvidersResponse = { data: { providers: string[] } };

type TenantChoice = { tenantId: string; name: string | null };

/** `POST /auth/login`'s body: a session (token); or — for a person in several tenants who has
 *  not picked one — the tenants to choose from; or, with no session yet, a second step: a code
 *  (`mfaRequired`) or enrolling an authenticator the tenant requires (`mfaSetupRequired`), both
 *  continued with `mfaToken`. */
type LoginResponse = {
  data: {
    token?: string;
    tenantId?: string;
    selectTenant?: boolean;
    tenants?: TenantChoice[];
    mfaRequired?: boolean;
    mfaSetupRequired?: boolean;
    mfaToken?: string;
  };
};

type SecondStep = { kind: "code" | "setup"; mfaToken: string };

const LOGIN_ERROR_KEYS: Record<string, string> = {
  invalid_credentials: "login.invalidCredentials",
  account_locked: "login.accountLocked",
  account_disabled: "login.accountDisabled",
  no_tenant_access: "login.noTenantAccess",
  sso_required: "login.ssoRequired",
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
  const signupOpen = useSignupOpen().data === true;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [choices, setChoices] = useState<TenantChoice[] | null>(null);
  const [secondStep, setSecondStep] = useState<SecondStep | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  // Where single sign-on starts for the email typed, once looked up (a tenant that enforces SSO
  // refuses the password, and the person needs a way on).
  const [ssoStartUrl, setSsoStartUrl] = useState<string | null>(null);

  async function finishSignIn() {
    // Awaited (2026-09-04, `markAuthenticated`'s own doc comment on the `AuthContext` interface)
    // — by the time this resolves, `status` has already settled to "authenticated", so the
    // destination route's `RequireAuth` can't read a stale "anonymous" and bounce back here.
    await markAuthenticated();
    navAdapter.navigate(navAdapter.toHome());
  }

  function backToCredentials(message: string | null = null) {
    setSecondStep(null);
    setChoices(null);
    setCode("");
    setUseRecovery(false);
    setError(message);
  }

  async function lookUpSso(): Promise<string | null> {
    try {
      const found = await discoverSso(email);
      const url = found.ssoAvailable && found.startUrl ? found.startUrl : null;
      setSsoStartUrl(url);
      return url;
    } catch {
      setSsoStartUrl(null);
      return null;
    }
  }

  async function handleSsoClick() {
    setError(null);
    setSubmitting(true);
    const url = await lookUpSso();
    setSubmitting(false);
    if (url) {
      window.location.assign(url);
    } else {
      setError(t("login.ssoNotAvailable"));
    }
  }

  async function handleCode() {
    if (!secondStep) return;
    setError(null);
    setSubmitting(true);
    try {
      await loginWithMfaCode(secondStep.mfaToken, code);
      await finishSignIn();
    } catch (err) {
      if (err instanceof ApiError && err.code === "mfa_challenge") {
        backToCredentials(t("security.challengeExpired"));
      } else {
        setError(describeMfaError(err, t));
        setCode("");
      }
    } finally {
      setSubmitting(false);
    }
  }

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
      if (response.data.mfaToken && (response.data.mfaRequired || response.data.mfaSetupRequired)) {
        setChoices(null);
        setSecondStep({
          kind: response.data.mfaRequired ? "code" : "setup",
          mfaToken: response.data.mfaToken,
        });
        return;
      }
      await finishSignIn();
    } catch (err) {
      if (err instanceof ApiError && err.code === "sso_required") {
        setChoices(null);
        void lookUpSso();
      }
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

  if (secondStep?.kind === "setup") {
    const { mfaToken } = secondStep;
    return (
      <div className="mx-auto max-w-sm py-8">
        <h2 className="mb-1 text-xl font-semibold text-foreground">{t("login.mfaSetupTitle")}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t("login.mfaSetupHint")}</p>
        <MfaEnrollmentFlow
          begin={() => beginRequiredMfaSetup(mfaToken)}
          confirm={(value) => confirmRequiredMfaSetup(mfaToken, value)}
          onDone={() => void finishSignIn()}
          onCancel={() => backToCredentials()}
          doneLabel={t("login.continue")}
        />
      </div>
    );
  }

  if (secondStep?.kind === "code") {
    return (
      <div className="mx-auto max-w-xs py-8">
        <h2 className="mb-1 text-xl font-semibold text-foreground">{t("login.mfaTitle")}</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {useRecovery ? t("login.mfaRecoveryHint") : t("login.mfaHint")}
        </p>
        {error ? (
          <Alert variant="destructive" className="mb-4">
            {error}
          </Alert>
        ) : null}
        <div className="flex flex-col gap-4">
          <MfaCodeInput
            key={useRecovery ? "recovery" : "totp"}
            autoFocus
            label={useRecovery ? t("security.recoveryCodeLabel") : t("security.codeLabel")}
            value={code}
            onChange={setCode}
            onSubmit={() => void handleCode()}
          />
          <Button onClick={() => void handleCode()} disabled={!code.trim()} loading={submitting}>
            {t("login.verify")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="self-center text-primary"
            onClick={() => {
              setUseRecovery((v) => !v);
              setCode("");
              setError(null);
            }}
          >
            {useRecovery ? t("login.useAuthenticator") : t("login.useRecoveryCode")}
          </Button>
          <Button variant="ghost" onClick={() => backToCredentials()}>
            {t("login.back")}
          </Button>
        </div>
      </div>
    );
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
          {ssoStartUrl ? (
            <div className="mt-2">
              <a href={ssoStartUrl} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("login.ssoButton")}
              </a>
            </div>
          ) : null}
        </Alert>
      ) : null}
      <div className="flex flex-col gap-4">
        <Input
          label={t("login.email")}
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);
            setSsoStartUrl(null);
          }}
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
        {signupOpen ? (
          <navAdapter.Link
            to="/signup"
            className="self-center text-sm text-primary hover:underline"
          >
            {t("signup.link")}
          </navAdapter.Link>
        ) : null}
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">{t("login.orDivider")}</span>
          <Separator className="flex-1" />
        </div>
        {oidcEnabled && tenantId ? (
          <a
            href={`/auth/oidc/${encodeURIComponent(tenantId)}/login`}
            className={buttonVariants({ variant: "outline" })}
          >
            {t("login.ssoButton")}
          </a>
        ) : (
          // Single sign-on found from the email's domain (roadmap 115 M7): no tenant needed up front.
          <Button
            variant="outline"
            disabled={!email.includes("@")}
            loading={submitting && password.length === 0}
            onClick={() => void handleSsoClick()}
          >
            {t("login.ssoWithEmail")}
          </Button>
        )}
      </div>
    </div>
  );
}
