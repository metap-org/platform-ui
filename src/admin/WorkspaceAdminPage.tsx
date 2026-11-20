import { useMemo, useState } from "react";
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
  Input,
  MultiSelect,
  NumberInput,
  PageHeader,
  SectionCard,
  Select,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toggle,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { GraphQLError } from "../api/graphqlClient";
import { AdminOnly } from "../auth/AdminOnly";
import { useCurrentUser } from "../auth/useCurrentUser";
import { relativeTime } from "../lib/dates";
import { DataList, type DataListColumn } from "../list/DataList";
import { ConfirmButton } from "./ConfirmButton";
import { roleDisplayName, useRoles, useUsers } from "./userAdminApi";
import {
  SECURITY_KEYS,
  SECURITY_LIMITS,
  useApiKeys,
  useOwnerActions,
  useOwnerStatus,
  useServiceAccountActions,
  useServiceAccounts,
  useTenantConfig,
  useTenantConfigActions,
  type ApiKey,
  type ConfigItem,
  type CreatedApiKey,
  type ServiceAccount,
} from "./workspaceAdminApi";

/**
 * The tenant admin's own workspace (roadmap 115): security settings (M3, M11), service accounts
 * with API keys (M5) and the owner (M8). Admin-only, like `UsersAdminPage`. The `tab` the page
 * opens on can be set by the caller (e.g. from the URL).
 */
export type WorkspaceAdminTab = "security" | "serviceAccounts" | "owner";

export function WorkspaceAdminPage({
  defaultTab = "security",
}: { defaultTab?: WorkspaceAdminTab } = {}) {
  return (
    <AdminOnly>
      <WorkspaceAdminContent defaultTab={defaultTab} />
    </AdminOnly>
  );
}

function WorkspaceAdminContent({ defaultTab }: { defaultTab: WorkspaceAdminTab }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader title={t("workspace.title")} description={t("workspace.subtitle")} />
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="security">{t("workspace.tabSecurity")}</TabsTrigger>
          <TabsTrigger value="serviceAccounts">{t("workspace.tabServiceAccounts")}</TabsTrigger>
          <TabsTrigger value="owner">{t("workspace.tabOwner")}</TabsTrigger>
        </TabsList>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="serviceAccounts">
          <ServiceAccountsTab />
        </TabsContent>
        <TabsContent value="owner">
          <OwnerTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof GraphQLError) {
    const field = err.fieldErrors ? Object.values(err.fieldErrors)[0]?.[0] : undefined;
    return field ?? err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

// --- Security ---------------------------------------------------------------------------------

type SecurityDraft = {
  requireMfa: boolean;
  passwordMinLength: number;
  sessionTtlMinutes: number;
  apiKeyMaxLifetimeDays: number;
};

function readDraft(items: ConfigItem[]): SecurityDraft {
  const value = (key: string) => items.find((item) => item.key === key)?.value;
  return {
    requireMfa: value(SECURITY_KEYS.requireMfa) === true,
    passwordMinLength: Number(value(SECURITY_KEYS.passwordMinLength) ?? 8),
    sessionTtlMinutes: Math.round(Number(value(SECURITY_KEYS.sessionTtlSeconds) ?? 3600) / 60),
    apiKeyMaxLifetimeDays: Number(value(SECURITY_KEYS.apiKeyMaxLifetimeDays) ?? 0),
  };
}

function SecurityTab() {
  const config = useTenantConfig();
  if (config.isLoading) return <Skeleton className="h-64 w-full" />;
  if (config.error) return <ApiErrorMessage error={config.error} />;
  const items = config.data ?? [];
  // Keyed on the saved values: after a save (or a reset) the form starts again from what the
  // server now holds, with no effect copying props into state.
  const saved = readDraft(items);
  return <SecurityForm key={JSON.stringify(saved)} items={items} saved={saved} />;
}

function SecurityForm({ items, saved }: { items: ConfigItem[]; saved: SecurityDraft }) {
  const { t } = useTranslation();
  const actions = useTenantConfigActions();
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const overridden = (key: string) => items.find((item) => item.key === key)?.overridden ?? false;

  const changes: [string, unknown][] = [];
  if (draft.requireMfa !== saved.requireMfa)
    changes.push([SECURITY_KEYS.requireMfa, draft.requireMfa]);
  if (draft.passwordMinLength !== saved.passwordMinLength)
    changes.push([SECURITY_KEYS.passwordMinLength, draft.passwordMinLength]);
  if (draft.sessionTtlMinutes !== saved.sessionTtlMinutes)
    changes.push([SECURITY_KEYS.sessionTtlSeconds, draft.sessionTtlMinutes * 60]);
  if (draft.apiKeyMaxLifetimeDays !== saved.apiKeyMaxLifetimeDays)
    changes.push([SECURITY_KEYS.apiKeyMaxLifetimeDays, draft.apiKeyMaxLifetimeDays]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      for (const [key, value] of changes) await actions.set(key, value);
      toast(t("workspace.securitySaved"));
    } catch (err) {
      setError(errorText(err, t("common.somethingWentWrong")));
    } finally {
      setSaving(false);
    }
  }

  // Whether the key is at its default, or a link back to it.
  function defaultHint(configKey: string) {
    if (!overridden(configKey)) {
      return <span className="text-xs text-muted-foreground">{t("workspace.usingDefault")}</span>;
    }
    return (
      <button
        type="button"
        className="text-xs text-primary hover:underline"
        onClick={() =>
          void actions
            .reset(configKey)
            .catch((err: unknown) => setError(errorText(err, t("common.somethingWentWrong"))))
        }
      >
        {t("workspace.resetToDefault")}
      </button>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4 pt-2">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <SectionCard
        title={t("workspace.signInTitle")}
        description={t("workspace.signInDescription")}
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{t("workspace.requireMfa")}</div>
              <p className="text-xs text-muted-foreground">{t("workspace.requireMfaHint")}</p>
              {defaultHint(SECURITY_KEYS.requireMfa)}
            </div>
            <Toggle
              checked={draft.requireMfa}
              onCheckedChange={(requireMfa) => setDraft({ ...draft, requireMfa })}
              aria-label={t("workspace.requireMfa")}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <NumberInput
                label={t("workspace.passwordMinLength")}
                helperText={t("workspace.passwordMinLengthHint")}
                min={SECURITY_LIMITS.passwordMinLength.min}
                max={SECURITY_LIMITS.passwordMinLength.max}
                value={draft.passwordMinLength}
                onChange={(passwordMinLength) => setDraft({ ...draft, passwordMinLength })}
              />
              {defaultHint(SECURITY_KEYS.passwordMinLength)}
            </div>
            <div className="flex flex-col gap-1">
              <NumberInput
                label={t("workspace.sessionTtl")}
                helperText={t("workspace.sessionTtlHint")}
                min={SECURITY_LIMITS.sessionTtlMinutes.min}
                max={SECURITY_LIMITS.sessionTtlMinutes.max}
                value={draft.sessionTtlMinutes}
                onChange={(sessionTtlMinutes) => setDraft({ ...draft, sessionTtlMinutes })}
              />
              {defaultHint(SECURITY_KEYS.sessionTtlSeconds)}
            </div>
          </div>
        </div>
      </SectionCard>
      <SectionCard
        title={t("workspace.apiKeysTitle")}
        description={t("workspace.apiKeysDescription")}
      >
        <div className="flex max-w-xs flex-col gap-1">
          <NumberInput
            label={t("workspace.apiKeyMaxLifetime")}
            helperText={t("workspace.apiKeyMaxLifetimeHint")}
            min={SECURITY_LIMITS.apiKeyMaxLifetimeDays.min}
            max={SECURITY_LIMITS.apiKeyMaxLifetimeDays.max}
            value={draft.apiKeyMaxLifetimeDays}
            onChange={(apiKeyMaxLifetimeDays) => setDraft({ ...draft, apiKeyMaxLifetimeDays })}
          />
          {defaultHint(SECURITY_KEYS.apiKeyMaxLifetimeDays)}
        </div>
      </SectionCard>
      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={changes.length === 0} loading={saving}>
          {t("workspace.save")}
        </Button>
        <Button variant="ghost" disabled={changes.length === 0} onClick={() => setDraft(saved)}>
          {t("workspace.discard")}
        </Button>
      </div>
    </div>
  );
}

// --- Service accounts and API keys ---------------------------------------------------------------

function ServiceAccountsTab() {
  const { t, i18n } = useTranslation();
  const accounts = useServiceAccounts();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = accounts.data?.find((a) => a.id === openId) ?? null;

  const columns: DataListColumn<ServiceAccount>[] = [
    {
      key: "name",
      header: t("workspace.saName"),
      required: true,
      cell: (a) => <span className="font-medium">{a.displayName}</span>,
    },
    {
      key: "roles",
      header: t("workspace.saRoles"),
      cell: (a) => (
        <span className="flex flex-wrap gap-1">
          {a.roles.map((role) => (
            <Badge key={role} variant="outline" className="font-normal">
              {role}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      key: "status",
      header: t("workspace.saStatus"),
      width: "8rem",
      cell: (a) => (
        <Badge variant={a.status === "active" ? "success" : "secondary"}>
          {t(`admin.users.status_${a.status}`)}
        </Badge>
      ),
    },
    {
      key: "created",
      header: t("workspace.saCreated"),
      width: "10rem",
      cell: (a) => relativeTime(a.createdAt, i18n.language),
    },
  ];

  return (
    <div className="pt-2">
      <DataList
        title={t("workspace.tabServiceAccounts")}
        rows={accounts.data ?? []}
        getRowId={(a) => a.id}
        columns={columns}
        loading={accounts.isLoading}
        error={accounts.error}
        emptyText={t("workspace.saEmpty")}
        onRefresh={() => void accounts.refetch()}
        refreshing={accounts.isFetching}
        onRowClick={(a) => setOpenId(a.id)}
        bodyClassName="max-h-[calc(100vh-280px)] min-h-[240px]"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            {t("workspace.saCreate")}
          </Button>
        }
      />
      <CreateServiceAccountDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(a) => {
          setCreating(false);
          setOpenId(a.id);
        }}
      />
      <Sheet open={open !== null} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="w-full sm:max-w-xl">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle>{open.displayName}</SheetTitle>
              </SheetHeader>
              <ApiKeysPanel account={open} />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CreateServiceAccountDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (account: ServiceAccount) => void;
}) {
  const { t } = useTranslation();
  const { data: roles } = useRoles();
  const actions = useServiceAccountActions();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setName("");
    setPicked([]);
    setError(null);
    onClose();
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const account = await actions.createServiceAccount(name.trim(), picked);
      setName("");
      setPicked([]);
      onCreated(account);
    } catch (err) {
      setError(errorText(err, t("common.somethingWentWrong")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workspace.saCreate")}</DialogTitle>
          <DialogDescription>{t("workspace.saCreateHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Input
            label={t("workspace.saName")}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <MultiSelect
            label={t("workspace.saRoles")}
            placeholder={t("admin.users.rolesPlaceholder")}
            options={(roles ?? []).map((role) => ({
              value: role.name,
              label: roleDisplayName(role),
            }))}
            value={picked}
            onChange={setPicked}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("shell.cancel")}
          </Button>
          <Button onClick={() => void create()} disabled={!name.trim()} loading={busy}>
            {t("workspace.saCreate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function keyState(key: ApiKey): "active" | "expired" | "revoked" {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

function ApiKeysPanel({ account }: { account: ServiceAccount }) {
  const { t, i18n } = useTranslation();
  const keys = useApiKeys(account.id);
  const actions = useServiceAccountActions();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const rows = useMemo(
    () =>
      // Live keys first, newest first within each group.
      [...(keys.data ?? [])].sort(
        (a, b) =>
          Number(keyState(a) !== "active") - Number(keyState(b) !== "active") ||
          b.createdAt.localeCompare(a.createdAt),
      ),
    [keys.data],
  );

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-wrap gap-1">
        {account.roles.map((role) => (
          <Badge key={role} variant="outline" className="font-normal">
            {role}
          </Badge>
        ))}
      </div>
      {created ? <NewKeyNotice created={created} onDismiss={() => setCreated(null)} /> : null}
      {error ? <ApiErrorMessage error={error} /> : null}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("workspace.keysTitle")}</h3>
        <Button size="sm" onClick={() => setCreating(true)}>
          {t("workspace.keyCreate")}
        </Button>
      </div>
      {keys.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : keys.error ? (
        <ApiErrorMessage error={keys.error} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("workspace.keysEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {rows.map((key) => {
            const state = keyState(key);
            return (
              <li key={key.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{key.name}</span>
                    <Badge
                      variant={
                        state === "active"
                          ? "success"
                          : state === "expired"
                            ? "warning"
                            : "secondary"
                      }
                    >
                      {t(`workspace.key_${state}`)}
                    </Badge>
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">{key.prefix}…</div>
                  <div className="text-xs text-muted-foreground">
                    {t("workspace.keyCreatedAt", {
                      when: relativeTime(key.createdAt, i18n.language),
                    })}
                    {" · "}
                    {key.expiresAt
                      ? t("workspace.keyExpiresAt", {
                          when: relativeTime(key.expiresAt, i18n.language),
                        })
                      : t("workspace.keyNoExpiry")}
                    {" · "}
                    {key.lastUsedAt
                      ? t("workspace.keyLastUsed", {
                          when: relativeTime(key.lastUsedAt, i18n.language),
                        })
                      : t("workspace.keyNeverUsed")}
                  </div>
                </div>
                {state === "active" ? (
                  <ConfirmButton
                    label={t("workspace.keyRevoke")}
                    description={t("workspace.keyRevokeConfirm", { name: key.name })}
                    destructive
                    busy={busyId === key.id}
                    onConfirm={() => {
                      setBusyId(key.id);
                      setError(null);
                      void actions
                        .revokeApiKey(key)
                        .catch(setError)
                        .finally(() => setBusyId(null));
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <CreateApiKeyDialog
        open={creating}
        account={account}
        onClose={() => setCreating(false)}
        onCreated={(result) => {
          setCreating(false);
          setCreated(result);
        }}
      />
    </div>
  );
}

/** The secret of a key just created: shown once, with a copy button. */
function NewKeyNotice({ created, onDismiss }: { created: CreatedApiKey; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert className="flex flex-col gap-2">
      <span className="text-sm font-medium">{t("workspace.keyCreatedTitle")}</span>
      <span className="text-xs">{t("workspace.keyCreatedHint")}</span>
      <code className="select-all break-all rounded bg-muted px-2 py-1 font-mono text-xs">
        {created.token}
      </code>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              .writeText(created.token)
              .then(() => toast(t("workspace.keyCopied")))
          }
        >
          {t("admin.users.copy")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t("workspace.keySaved")}
        </Button>
      </div>
    </Alert>
  );
}

const EXPIRY_CHOICES = [7, 30, 90, 365, 0] as const;

function CreateApiKeyDialog({
  open,
  account,
  onClose,
  onCreated,
}: {
  open: boolean;
  account: ServiceAccount;
  onClose: () => void;
  onCreated: (result: CreatedApiKey) => void;
}) {
  const { t } = useTranslation();
  const config = useTenantConfig();
  const actions = useServiceAccountActions();
  const cap = Number(
    config.data?.find((item) => item.key === SECURITY_KEYS.apiKeyMaxLifetimeDays)?.value ?? 0,
  );
  const choices = EXPIRY_CHOICES.filter((days) => (cap > 0 ? days > 0 && days <= cap : true));
  const [name, setName] = useState("");
  const [days, setDays] = useState<string>("90");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // With a cap below every preset, the cap itself is the only choice.
  const options = (choices.length > 0 ? [...choices] : [cap]).map((d) => ({
    value: String(d),
    label: d === 0 ? t("workspace.keyNoExpiry") : t("workspace.keyDays", { count: d }),
  }));
  const selected = options.some((o) => o.value === days) ? days : (options[0]?.value ?? "0");

  function close() {
    setName("");
    setError(null);
    onClose();
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await actions.createApiKey(account.id, name.trim(), Number(selected));
      setName("");
      onCreated(result);
    } catch (err) {
      setError(errorText(err, t("common.somethingWentWrong")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workspace.keyCreate")}</DialogTitle>
          <DialogDescription>
            {cap > 0 ? t("workspace.keyCapHint", { count: cap }) : t("workspace.keyCreateHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Input
            label={t("workspace.keyName")}
            placeholder={t("workspace.keyNamePlaceholder")}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Select
            label={t("workspace.keyExpiry")}
            options={options}
            value={selected}
            onValueChange={setDays}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("shell.cancel")}
          </Button>
          <Button onClick={() => void create()} disabled={!name.trim()} loading={busy}>
            {t("workspace.keyCreate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Owner -------------------------------------------------------------------------------------

function OwnerTab() {
  const { t, i18n } = useTranslation();
  const status = useOwnerStatus();
  const actions = useOwnerActions();
  const { data: me } = useCurrentUser();
  const admins = useUsers({ role: "admin", status: "active", offset: 0, limit: 200 });
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (status.isLoading) return <Skeleton className="h-40 w-full" />;
  if (status.error) return <ApiErrorMessage error={status.error} />;
  const owner = status.data;
  if (!owner) return null;
  const isOwner = me?.userId === owner.ownerMemberId;
  const candidates = (admins.data?.users ?? []).filter((u) => u.id !== owner.ownerMemberId);
  const recovery = owner.pendingRecovery;
  const recoveryTarget = recovery
    ? (admins.data?.users.find((u) => u.id === recovery.newOwnerMemberId)?.email ??
      recovery.newOwnerMemberId)
    : null;

  async function run(name: string, fn: () => Promise<void>, done: string) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      toast(done);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4 pt-2">
      {error ? <ApiErrorMessage error={error} /> : null}
      {recovery ? (
        <Alert variant="destructive" className="flex flex-col gap-2">
          <span className="font-medium">{t("workspace.recoveryPendingTitle")}</span>
          <span className="text-sm">
            {t("workspace.recoveryPending", {
              by: recovery.requestedByEmail,
              to: recoveryTarget,
              when: relativeTime(recovery.effectiveAt, i18n.language),
            })}
          </span>
          <span className="text-sm">
            {t("workspace.recoveryReason", { reason: recovery.reason })}
          </span>
          <div>
            <ConfirmButton
              label={t("workspace.recoveryCancel")}
              description={t("workspace.recoveryCancelConfirm")}
              busy={busy === "cancel"}
              onConfirm={() =>
                void run("cancel", actions.cancelOwnerRecovery, t("workspace.recoveryCancelled"))
              }
            />
          </div>
        </Alert>
      ) : null}
      <SectionCard title={t("workspace.ownerTitle")} description={t("workspace.ownerDescription")}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{owner.ownerEmail || owner.ownerMemberId}</span>
          {isOwner ? <Badge variant="outline">{t("workspace.ownerYou")}</Badge> : null}
        </div>
      </SectionCard>
      <SectionCard
        title={t("workspace.transferTitle")}
        description={
          isOwner ? t("workspace.transferDescription") : t("workspace.transferOwnerOnly")
        }
      >
        {isOwner ? (
          candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("workspace.transferNoAdmins")}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <Select
                  label={t("workspace.transferTo")}
                  placeholder={t("workspace.transferPick")}
                  options={candidates.map((u) => ({
                    value: u.id,
                    label: u.displayName ? `${u.displayName} (${u.email})` : u.email,
                  }))}
                  value={target}
                  onValueChange={setTarget}
                />
              </div>
              {target ? (
                <ConfirmButton
                  label={t("workspace.transfer")}
                  description={t("workspace.transferConfirm", {
                    email: candidates.find((u) => u.id === target)?.email ?? "",
                  })}
                  destructive
                  busy={busy === "transfer"}
                  onConfirm={() =>
                    void run(
                      "transfer",
                      async () => {
                        await actions.transferOwnership(target);
                        setTarget("");
                      },
                      t("workspace.transferred"),
                    )
                  }
                />
              ) : null}
            </div>
          )
        ) : null}
      </SectionCard>
    </div>
  );
}
