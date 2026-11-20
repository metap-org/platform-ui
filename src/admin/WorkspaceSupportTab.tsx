import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  NumberInput,
  Select,
  Skeleton,
  Textarea,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { useTenantUsers } from "../auth/useTenantUsers";
import { relativeTime } from "../lib/dates";
import { ConfirmButton } from "./ConfirmButton";
import { roleDisplayName, useRoles } from "./userAdminApi";
import { useSupportActions, useSupportGrants, type SupportGrant } from "./workspaceAdvancedApi";

const MAX_HOURS = 168;

/**
 * Letting the platform's support staff into the tenant for a while (roadmap 115 M10): a grant
 * names the reason, the role they act as and how long; every support session started under it is
 * listed, and revoking ends them all at once.
 */
export function WorkspaceSupportTab() {
  const { t } = useTranslation();
  const grants = useSupportGrants();
  const actions = useSupportActions();
  const people = useTenantUsers();
  const [granting, setGranting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const rows = grants.data ?? [];
  const active = rows.filter((g) => g.active);
  const past = rows.filter((g) => !g.active);
  const who = (id: string) => people.find((p) => p.id === id)?.email ?? id.slice(0, 8);
  const row = (g: SupportGrant) => (
    <GrantRow
      key={g.id}
      grant={g}
      who={who}
      busy={busyId === g.id}
      onRevoke={() => {
        setBusyId(g.id);
        setError(null);
        void actions
          .revoke(g.id)
          .then(() => toast(t("workspace.supportRevokedToast")))
          .catch(setError)
          .finally(() => setBusyId(null));
      }}
    />
  );

  return (
    <div className="flex max-w-3xl flex-col gap-4 pt-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{t("workspace.supportTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("workspace.supportDescription")}</p>
        </div>
        <Button size="sm" onClick={() => setGranting(true)}>
          {t("workspace.supportGrant")}
        </Button>
      </div>
      {error ? <ApiErrorMessage error={error} /> : null}
      {grants.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : grants.error ? (
        <ApiErrorMessage error={grants.error} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("workspace.supportEmpty")}</p>
      ) : (
        <>
          {active.length ? (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {active.map(row)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("workspace.supportNoneActive")}</p>
          )}
          {past.length ? (
            <>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("workspace.supportHistory")}
              </h4>
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {past.map(row)}
              </ul>
            </>
          ) : null}
        </>
      )}
      <GrantDialog open={granting} onClose={() => setGranting(false)} />
    </div>
  );
}

function GrantRow({
  grant,
  who,
  busy,
  onRevoke,
}: {
  grant: SupportGrant;
  who: (id: string) => string;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={grant.active ? "success" : "secondary"}>
          {grant.active
            ? t("workspace.supportActive")
            : grant.revokedAt
              ? t("workspace.supportRevoked")
              : t("workspace.supportExpired")}
        </Badge>
        <Badge variant="outline" className="font-normal">
          {grant.role}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {grant.active
            ? t("workspace.supportUntil", { when: relativeTime(grant.expiresAt, i18n.language) })
            : t("workspace.supportGrantedAt", {
                when: relativeTime(grant.createdAt, i18n.language),
              })}
          {" · "}
          {t("workspace.supportBy", { who: who(grant.grantedBy) })}
        </span>
        {grant.active ? (
          <span className="ml-auto">
            <ConfirmButton
              label={t("workspace.supportRevoke")}
              description={t("workspace.supportRevokeConfirm")}
              destructive
              busy={busy}
              onConfirm={onRevoke}
            />
          </span>
        ) : null}
      </div>
      <p className="text-sm">{grant.reason}</p>
      {grant.sessions.length ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {grant.sessions.map((s) => (
            <li key={`${s.memberId}-${s.startedAt}`}>
              {t("workspace.supportSession", {
                who: s.startedByEmail,
                when: relativeTime(s.startedAt, i18n.language),
              })}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("workspace.supportNoSessions")}</p>
      )}
    </li>
  );
}

function GrantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: roles } = useRoles();
  const actions = useSupportActions();
  const [reason, setReason] = useState("");
  const [role, setRole] = useState("");
  const [hours, setHours] = useState(24);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setReason("");
    setRole("");
    setHours(24);
    setError(null);
    onClose();
  }

  async function grant() {
    setBusy(true);
    setError(null);
    try {
      await actions.grant(reason.trim(), role, hours);
      toast(t("workspace.supportGranted"));
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workspace.supportGrant")}</DialogTitle>
          <DialogDescription>{t("workspace.supportGrantHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Textarea
            label={t("workspace.supportReason")}
            placeholder={t("workspace.supportReasonPlaceholder")}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Select
            label={t("workspace.supportRole")}
            helperText={t("workspace.supportRoleHint")}
            placeholder={t("workspace.supportPickRole")}
            options={(roles ?? [])
              .filter((r) => r.name !== "platform_admin")
              .map((r) => ({ value: r.name, label: roleDisplayName(r) }))}
            value={role || undefined}
            onValueChange={setRole}
          />
          <NumberInput
            label={t("workspace.supportHours")}
            helperText={t("workspace.supportHoursHint", { max: MAX_HOURS })}
            min={1}
            max={MAX_HOURS}
            value={hours}
            onChange={setHours}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("shell.cancel")}
          </Button>
          <Button
            onClick={() => void grant()}
            disabled={!reason.trim() || !role || hours < 1 || hours > MAX_HOURS}
            loading={busy}
          >
            {t("workspace.supportGrant")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
