import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Input, QrCode, Spinner, toast } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { describeMfaError, type MfaEnrollment } from "./securityApi";

/** A one-time code field: digits for an authenticator, or a recovery code when `allowRecovery`. */
export function MfaCodeInput({
  value,
  onChange,
  onSubmit,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  label?: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Input
      label={label ?? t("security.codeLabel")}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      className="font-mono tracking-widest"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => event.key === "Enter" && value.trim() && onSubmit?.()}
    />
  );
}

/** The recovery codes, shown once: copy, download, and an acknowledgement before going on. */
export function RecoveryCodesPanel({
  codes,
  onDone,
  doneLabel,
}: {
  codes: string[];
  onDone: () => void;
  doneLabel?: string;
}) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n");

  function download() {
    const blob = new Blob([`${t("security.recoveryFileHeader")}\n\n${text}\n`], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert>{t("security.recoveryCodesIntro")}</Alert>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => toast(t("security.codesCopied")))
          }
        >
          {t("security.copyCodes")}
        </Button>
        <Button size="sm" variant="outline" onClick={download}>
          {t("security.downloadCodes")}
        </Button>
      </div>
      <Checkbox checked={saved} onCheckedChange={setSaved} label={t("security.savedCodes")} />
      <Button onClick={onDone} disabled={!saved}>
        {doneLabel ?? t("security.done")}
      </Button>
    </div>
  );
}

/**
 * Turning on an authenticator app: scan the QR (or type the secret), confirm with a first code,
 * then keep the recovery codes. `begin`/`confirm` are the two calls of whichever path is enrolling
 * — the signed-in account page (`/me/mfa*`) or a sign-in the tenant forces to enrol (`/auth/mfa/setup*`).
 */
export function MfaEnrollmentFlow({
  begin,
  confirm,
  onDone,
  onCancel,
  doneLabel,
}: {
  begin: () => Promise<MfaEnrollment>;
  confirm: (code: string) => Promise<string[]>;
  onDone: () => void;
  onCancel?: () => void;
  doneLabel?: string;
}) {
  const { t } = useTranslation();
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    begin()
      .then((e) => live && setEnrollment(e))
      .catch((err: unknown) => live && setError(describeMfaError(err, t)));
    return () => {
      live = false;
    };
    // Starting an enrolment issues a new secret: once per mount, not on every render's new `begin`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      setCodes(await confirm(code));
    } catch (err) {
      setError(describeMfaError(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (codes) return <RecoveryCodesPanel codes={codes} onDone={onDone} doneLabel={doneLabel} />;

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {!enrollment ? (
        error ? null : (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )
      ) : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t("security.stepInstall")}</li>
            <li>{t("security.stepScan")}</li>
            <li>{t("security.stepCode")}</li>
          </ol>
          <div className="flex justify-center">
            <QrCode value={enrollment.otpauthUri} size={176} label={t("security.qrLabel")} />
          </div>
          <div className="text-center text-xs text-muted-foreground">
            {t("security.secretHint")}
            <div className="mt-1 select-all break-all font-mono text-sm text-foreground">
              {enrollment.secret}
            </div>
          </div>
          <MfaCodeInput value={code} onChange={setCode} onSubmit={() => void handleConfirm()} />
          <div className="flex justify-end gap-2">
            {onCancel ? (
              <Button variant="ghost" onClick={onCancel}>
                {t("shell.cancel")}
              </Button>
            ) : null}
            <Button onClick={() => void handleConfirm()} disabled={!code.trim()} loading={busy}>
              {t("security.verifyAndEnable")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
