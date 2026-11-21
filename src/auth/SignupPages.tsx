import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Input, Spinner } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { useAuth } from "./AuthContext";
import {
  completeSignup,
  readTokenFromUrl,
  startSignup,
  stripTokenFromUrl,
  useSignupOpen,
} from "./accountApi";

/** The public self-service signup pages (roadmap 115 M2). Mount them outside the signed-in shell:
 *  `/signup` (the form) and `/signup/verify` (the path the confirmation email links to). */

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

export function SignupPage() {
  const { t } = useTranslation();
  const open = useSignupOpen();
  const [tenantName, setTenantName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  if (open.isLoading) return <Spinner />;
  if (!open.data) {
    return (
      <Card title={t("signup.title")}>
        <Alert variant="destructive">{t("signup.closed")}</Alert>
        <BackToLogin />
      </Card>
    );
  }
  if (sent) {
    return (
      <Card title={t("signup.checkEmailTitle")}>
        <p className="text-sm text-muted-foreground">{t("signup.checkEmail", { email })}</p>
        <BackToLogin />
      </Card>
    );
  }

  async function submit() {
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await startSignup({
        tenantName: tenantName.trim(),
        email: email.trim(),
        displayName: displayName.trim() || undefined,
        password,
      });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        setFieldErrors(
          Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v.join(" ")])),
        );
      } else if (err instanceof ApiError && err.code === "signup_disabled") {
        setError(t("signup.closed"));
      } else if (err instanceof ApiError && err.code === "captcha_failed") {
        setError(t("signup.captchaFailed"));
      } else {
        setError(t("common.somethingWentWrong"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title={t("signup.title")}>
      <p className="text-sm text-muted-foreground">{t("signup.intro")}</p>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Input
        label={t("signup.tenantName")}
        value={tenantName}
        error={fieldErrors.tenantName}
        onChange={(e) => setTenantName(e.currentTarget.value)}
      />
      <Input
        label={t("signup.displayName")}
        value={displayName}
        onChange={(e) => setDisplayName(e.currentTarget.value)}
      />
      <Input
        label={t("signup.email")}
        type="email"
        autoComplete="email"
        value={email}
        error={fieldErrors.email}
        onChange={(e) => setEmail(e.currentTarget.value)}
      />
      <Input
        label={t("signup.password")}
        type="password"
        autoComplete="new-password"
        value={password}
        error={fieldErrors.password}
        onChange={(e) => setPassword(e.currentTarget.value)}
      />
      <Button
        onClick={() => void submit()}
        loading={submitting}
        disabled={!tenantName.trim() || !email.trim() || !password}
      >
        {t("signup.submit")}
      </Button>
      <BackToLogin />
    </Card>
  );
}

export function SignupVerifyPage() {
  const { t } = useTranslation();
  const { markAuthenticated } = useAuth();
  const nav = useNavigationAdapter();
  const [token] = useState(readTokenFromUrl);
  const [error, setError] = useState<string | null>(token ? null : t("signup.linkInvalid"));
  const started = useRef(false);

  useEffect(() => stripTokenFromUrl(), []);
  useEffect(() => {
    // One attempt per mount: the link is single use, and StrictMode runs effects twice.
    if (!token || started.current) return;
    started.current = true;
    completeSignup(token)
      .then(async ({ mfaRequired }) => {
        if (mfaRequired) {
          nav.navigate("/login");
          return;
        }
        await markAuthenticated();
        nav.navigate(nav.toHome());
      })
      .catch((err) =>
        setError(
          err instanceof ApiError && err.code === "signup_invalid"
            ? t("signup.linkInvalid")
            : t("common.somethingWentWrong"),
        ),
      );
    // The effect is keyed on the token only; nav/markAuthenticated are stable for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) {
    return (
      <Card title={t("signup.verifyTitle")}>
        <Alert variant="destructive">{error}</Alert>
        <BackToLogin />
      </Card>
    );
  }
  return (
    <Card title={t("signup.verifyTitle")}>
      <Spinner />
      <p className="text-sm text-muted-foreground">{t("signup.verifying")}</p>
    </Card>
  );
}
