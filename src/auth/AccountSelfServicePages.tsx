import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Input, Spinner } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { useAuth } from "./AuthContext";
import {
  acceptInvitation,
  lookupInvitation,
  readTokenFromUrl,
  requestPasswordReset,
  resetPassword,
  stripTokenFromUrl,
  tenantLabel,
  type InvitationInfo,
} from "./accountApi";

/** The public account pages (roadmap 113 P2): accepting an invitation, asking for a reset link and
 *  setting a new password from it. Each reads its `?token=` once and drops it from the URL. Mount
 *  them on routes outside the signed-in shell: `/accept-invite`, `/forgot-password`,
 *  `/reset-password` (the paths the emails link to). */

const ERROR_KEYS: Record<string, string> = {
  invitation_invalid: "account.error_invitation_invalid",
  invitation_needs_sign_in: "account.error_invitation_needs_sign_in",
  sso_required: "account.error_sso_required",
  reset_token_invalid: "account.error_reset_token_invalid",
  invalid_credentials: "account.error_wrong_current_password",
  account_locked: "login.accountLocked",
  account_disabled: "login.accountDisabled",
  no_tenant_access: "login.noTenantAccess",
};

function useErrorText() {
  const { t } = useTranslation();
  return (err: unknown) => {
    if (err instanceof ApiError) {
      const key = ERROR_KEYS[err.code];
      return key ? t(key) : err.message;
    }
    return t("common.somethingWentWrong");
  };
}

function useUrlToken() {
  const [token] = useState(readTokenFromUrl);
  useEffect(() => stripTokenFromUrl(), []);
  return token;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-sm py-8">
      <h2 className="mb-4 text-xl font-semibold text-foreground">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

function BackToLogin() {
  const { t } = useTranslation();
  const nav = useNavigationAdapter();
  return (
    <nav.Link to="/login" className="text-sm text-primary hover:underline">
      {t("account.backToLogin")}
    </nav.Link>
  );
}

export function AcceptInvitePage() {
  const { t } = useTranslation();
  const { markAuthenticated } = useAuth();
  const nav = useNavigationAdapter();
  const describe = useErrorText();
  const token = useUrlToken();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(
    token ? null : t("account.error_invitation_invalid"),
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    lookupInvitation(token)
      .then((data) => {
        setInfo(data);
        setDisplayName(data.displayName);
      })
      .catch((err) => setLoadError(describe(err)));
    // describe is stable in behaviour; the lookup runs once per token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (loadError) {
    return (
      <Card title={t("account.acceptTitle")}>
        <Alert variant="destructive">{loadError}</Alert>
        <BackToLogin />
      </Card>
    );
  }
  if (!info) return <Spinner />;

  const tenant = tenantLabel({ tenantId: info.tenantId, name: info.tenantName }, (id) =>
    t("shell.unnamedTenant", { id }),
  );
  const setsPassword = info.passwordMode === "set";
  const mismatch = setsPassword && confirm.length > 0 && confirm !== password;
  const tooShort =
    setsPassword && password.length > 0 && [...password].length < info.minPasswordLength;

  async function handleAccept() {
    setError(null);
    setSubmitting(true);
    try {
      await acceptInvitation(token, password, displayName.trim() || undefined);
      await markAuthenticated();
      nav.navigate(nav.toHome());
    } catch (err) {
      setError(describe(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title={t("account.acceptTitle")}>
      <p className="text-sm text-muted-foreground">
        {t("account.acceptIntro", { tenant, email: info.email })}
      </p>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {info.passwordMode === "provider" ? (
        <Alert>{t("account.error_invitation_needs_sign_in")}</Alert>
      ) : (
        <>
          <Input
            label={t("admin.users.displayName")}
            value={displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
          />
          <Input
            label={setsPassword ? t("account.newPassword") : t("account.currentPassword")}
            type="password"
            autoComplete={setsPassword ? "new-password" : "current-password"}
            helperText={
              setsPassword
                ? t("account.passwordPolicy", { count: info.minPasswordLength })
                : t("account.confirmExistingHint")
            }
            error={
              tooShort ? t("account.passwordPolicy", { count: info.minPasswordLength }) : undefined
            }
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          {setsPassword ? (
            <Input
              label={t("account.confirmPassword")}
              type="password"
              autoComplete="new-password"
              error={mismatch ? t("account.passwordMismatch") : undefined}
              value={confirm}
              onChange={(event) => setConfirm(event.currentTarget.value)}
            />
          ) : null}
          <Button
            loading={submitting}
            disabled={password.length === 0 || tooShort || (setsPassword && confirm !== password)}
            onClick={() => void handleAccept()}
          >
            {t("account.acceptSubmit", { tenant })}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("account.expiresAt", { when: new Date(info.expiresAt).toLocaleString() })}
          </p>
        </>
      )}
    </Card>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const describe = useErrorText();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(describe(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title={t("account.forgotTitle")}>
      {sent ? (
        <Alert>{t("account.forgotSent", { email: email.trim() })}</Alert>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("account.forgotIntro")}</p>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Input
            label={t("login.email")}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            onKeyDown={(event) => event.key === "Enter" && email.trim() && void handleSubmit()}
          />
          <Button loading={submitting} disabled={!email.trim()} onClick={() => void handleSubmit()}>
            {t("account.forgotSubmit")}
          </Button>
        </>
      )}
      <BackToLogin />
    </Card>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const describe = useErrorText();
  const token = useUrlToken();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : t("account.error_reset_token_invalid"),
  );
  const [submitting, setSubmitting] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(describe(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title={t("account.resetTitle")}>
      {done ? (
        <Alert>{t("account.resetDone")}</Alert>
      ) : (
        <>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          {token ? (
            <>
              <Input
                label={t("account.newPassword")}
                type="password"
                autoComplete="new-password"
                helperText={t("account.resetPolicyHint")}
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <Input
                label={t("account.confirmPassword")}
                type="password"
                autoComplete="new-password"
                error={mismatch ? t("account.passwordMismatch") : undefined}
                value={confirm}
                onChange={(event) => setConfirm(event.currentTarget.value)}
              />
              <Button
                loading={submitting}
                disabled={password.length === 0 || confirm !== password}
                onClick={() => void handleSubmit()}
              >
                {t("account.resetSubmit")}
              </Button>
            </>
          ) : null}
        </>
      )}
      <BackToLogin />
    </Card>
  );
}
