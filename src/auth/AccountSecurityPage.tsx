import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SectionCard,
  Skeleton,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { relativeTime } from "../lib/dates";
import { DataList, type DataListColumn } from "../list/DataList";
import { MfaCodeInput, MfaEnrollmentFlow, RecoveryCodesPanel } from "./MfaEnrollment";
import {
  describeMfaError,
  describeUserAgent,
  useAccountSecurityActions,
  useMfaStatus,
  useMySessions,
  type LoginSession,
} from "./securityApi";

/**
 * The signed-in person's own security settings (roadmap 115 M3/M4): two-factor authentication
 * (turn on with an authenticator app, new recovery codes, turn off) and the login sessions open
 * on their account across tenants and devices. Mount it on a signed-in route of the app (the
 * shell's account menu links to `accountSecurityPath`, `/account/security` by default).
 */
export function AccountSecurityPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("security.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("security.subtitle")}</p>
      </div>
      <TwoFactorSection />
      <SessionsSection />
    </div>
  );
}

type MfaDialog = "enable" | "disable" | "regenerate" | null;

function TwoFactorSection() {
  const { t } = useTranslation();
  const status = useMfaStatus();
  const actions = useAccountSecurityActions();
  const [dialog, setDialog] = useState<MfaDialog>(null);
  const enabled = status.data?.enabled ?? false;
  const left = status.data?.recoveryCodesLeft ?? 0;

  return (
    <SectionCard
      title={t("security.mfaTitle")}
      description={t("security.mfaDescription")}
      actions={
        status.data ? (
          <Badge variant={enabled ? "success" : "outline"}>
            {enabled ? t("security.mfaOn") : t("security.mfaOff")}
          </Badge>
        ) : null
      }
    >
      {status.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : status.error ? (
        <ApiErrorMessage error={status.error} />
      ) : enabled ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {t("security.recoveryLeft", { count: left })}
          </p>
          {left <= 2 ? <Alert>{t("security.recoveryLow")}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog("regenerate")}>
              {t("security.regenerate")}
            </Button>
            <Button variant="outline" onClick={() => setDialog("disable")}>
              {t("security.disable")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("security.mfaOffHint")}</p>
          <div>
            <Button onClick={() => setDialog("enable")}>{t("security.enable")}</Button>
          </div>
        </div>
      )}

      <Dialog open={dialog === "enable"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("security.enableTitle")}</DialogTitle>
          </DialogHeader>
          {dialog === "enable" ? (
            <MfaEnrollmentFlow
              begin={actions.beginMfaEnrollment}
              confirm={actions.confirmMfaEnrollment}
              onCancel={() => setDialog(null)}
              onDone={() => {
                setDialog(null);
                toast(t("security.enabledToast"));
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <CodeConfirmDialog
        open={dialog === "disable"}
        title={t("security.disableTitle")}
        description={t("security.disableDescription")}
        submitLabel={t("security.disable")}
        destructive
        onClose={() => setDialog(null)}
        onSubmit={async (code) => {
          await actions.disableMfa(code);
          setDialog(null);
          toast(t("security.disabledToast"));
          return null;
        }}
      />

      <CodeConfirmDialog
        open={dialog === "regenerate"}
        title={t("security.regenerateTitle")}
        description={t("security.regenerateDescription")}
        submitLabel={t("security.regenerate")}
        onClose={() => setDialog(null)}
        onSubmit={(code) => actions.regenerateRecoveryCodes(code)}
      />
    </SectionCard>
  );
}

/** Asks for a current code before a change to MFA; shows new recovery codes when `onSubmit`
 *  returns them. */
function CodeConfirmDialog({
  open,
  title,
  description,
  submitLabel,
  destructive,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  destructive?: boolean;
  onClose: () => void;
  onSubmit: (code: string) => Promise<string[] | null>;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  function close() {
    setCode("");
    setError(null);
    setCodes(null);
    onClose();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await onSubmit(code);
      if (result) setCodes(result);
    } catch (err) {
      setError(describeMfaError(err, t));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {codes ? null : <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {codes ? (
          <RecoveryCodesPanel codes={codes} onDone={close} />
        ) : (
          <div className="flex flex-col gap-4">
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            <MfaCodeInput
              autoFocus
              label={t("security.codeOrRecoveryLabel")}
              value={code}
              onChange={setCode}
              onSubmit={() => void submit()}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                {t("shell.cancel")}
              </Button>
              <Button
                variant={destructive ? "destructive" : "default"}
                onClick={() => void submit()}
                disabled={!code.trim()}
                loading={busy}
              >
                {submitLabel}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SessionsSection() {
  const { t, i18n } = useTranslation();
  const sessions = useMySessions();
  const actions = useAccountSecurityActions();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const rows = sessions.data ?? [];
  const others = rows.filter((s) => !s.current).length;

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  }

  const columns: DataListColumn<LoginSession>[] = [
    {
      key: "device",
      header: t("security.sessionDevice"),
      required: true,
      cell: (s) => (
        <span className="flex items-center gap-2">
          <span className="truncate" title={s.userAgent}>
            {describeUserAgent(s.userAgent) || t("security.unknownDevice")}
          </span>
          {s.current ? <Badge variant="outline">{t("security.thisSession")}</Badge> : null}
        </span>
      ),
    },
    { key: "ip", header: t("security.sessionIp"), width: "9rem", cell: (s) => s.ip || "—" },
    {
      key: "tenant",
      header: t("security.sessionTenant"),
      cell: (s) => s.tenantName || s.tenantId.slice(0, 8),
    },
    {
      key: "lastSeen",
      header: t("security.sessionLastSeen"),
      width: "10rem",
      cell: (s) => <span title={s.lastSeenAt}>{relativeTime(s.lastSeenAt, i18n.language)}</span>,
    },
    {
      key: "created",
      header: t("security.sessionCreated"),
      width: "10rem",
      cell: (s) => <span title={s.createdAt}>{relativeTime(s.createdAt, i18n.language)}</span>,
    },
  ];

  return (
    <DataList
      title={t("security.sessionsTitle")}
      rows={rows}
      getRowId={(s) => s.id}
      columns={columns}
      loading={sessions.isLoading}
      error={sessions.error}
      emptyText={t("security.noSessions")}
      onRefresh={() => void sessions.refetch()}
      refreshing={sessions.isFetching}
      bodyClassName="max-h-[420px]"
      banner={error ? <ApiErrorMessage error={error} /> : null}
      toolbar={
        <Button
          size="sm"
          variant="outline"
          disabled={others === 0}
          loading={busyId === "others"}
          onClick={() =>
            void run("others", async () => {
              const count = await actions.revokeOtherSessions();
              toast(t("security.othersRevoked", { count }));
            })
          }
        >
          {t("security.revokeOthers")}
        </Button>
      }
      rowActionsWidth="110px"
      rowActions={(s) =>
        s.current ? null : (
          <Button
            size="sm"
            variant="ghost"
            loading={busyId === s.id}
            onClick={() => void run(s.id, () => actions.revokeSession(s.id))}
          >
            {t("security.revoke")}
          </Button>
        )
      }
    />
  );
}
