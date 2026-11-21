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
  Input,
  NumberInput,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { PlatformAdminOnly } from "../auth/PlatformAdminOnly";
import { formatDateTime } from "../lib/dates";
import { ConfirmButton } from "./ConfirmButton";
import {
  TENANT_PAGE_SIZE,
  usePlatformTenantActions,
  usePlatformTenantDirectory,
  useTenantAccessActions,
  useTenantOwner,
  type SupportSessionToken,
  type CreatedTenant,
  type TenantDirectoryEntry,
} from "./platformApi";

const STATUSES = ["provisioning", "active", "migrating", "suspended", "expired", "deleted"];
const ANY = "__any__";
const DEFAULT_RETENTION_DAYS = 30;

function statusVariant(status: string) {
  switch (status) {
    case "active":
      return "success-soft" as const;
    case "suspended":
    case "expired":
      return "warning-soft" as const;
    case "deleted":
      return "destructive-soft" as const;
    default:
      return "info-soft" as const;
  }
}

/**
 * Every tenant on the platform, for the platform admin: find one, create one with its first
 * admin, suspend or resume it, schedule its deletion (kept for a retention period, cancellable
 * until it runs out). Platform admin only.
 */
export function PlatformTenantsPage() {
  return (
    <PlatformAdminOnly>
      <PlatformTenants />
    </PlatformAdminOnly>
  );
}

function PlatformTenants() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const directory = usePlatformTenantDirectory({ query, status, page });
  const actions = usePlatformTenantActions();
  const tenants = directory.data?.tenants ?? [];
  const total = directory.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / TENANT_PAGE_SIZE) - 1);

  function run(id: string, work: () => Promise<unknown>, done: string) {
    setBusyId(id);
    setError(null);
    void work()
      .then(() => toast(done))
      .catch(setError)
      .finally(() => setBusyId(null));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{t("platform.tenantsTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("platform.tenantsDescription")}</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          {t("platform.tenantCreate")}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-64">
          <Input
            aria-label={t("platform.tenantSearch")}
            placeholder={t("platform.tenantSearch")}
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setPage(0);
            }}
          />
        </div>
        <div className="w-44">
          <Select
            aria-label={t("platform.tenantStatus")}
            options={[
              { value: ANY, label: t("platform.tenantAnyStatus") },
              ...STATUSES.map((s) => ({ value: s, label: t(`platform.status_${s}`) })),
            ]}
            value={status || ANY}
            onValueChange={(value) => {
              setStatus(value === ANY ? "" : value);
              setPage(0);
            }}
          />
        </div>
      </div>

      {error ? <ApiErrorMessage error={error} /> : null}
      {directory.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : directory.error ? (
        <ApiErrorMessage error={directory.error} />
      ) : tenants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("platform.tenantsEmpty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("platform.colName")}</TableHead>
              <TableHead>{t("platform.colStatus")}</TableHead>
              <TableHead>{t("platform.colTier")}</TableHead>
              <TableHead>{t("platform.colMembers")}</TableHead>
              <TableHead>{t("platform.colCreated")}</TableHead>
              <TableHead className="text-right">{t("platform.colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((tenant) => (
              <TenantRow
                key={tenant.id}
                tenant={tenant}
                busy={busyId === tenant.id}
                onEdit={(change) =>
                  run(
                    tenant.id,
                    () => actions.update(tenant.id, change),
                    t("platform.updatedToast"),
                  )
                }
                onSuspend={() =>
                  run(tenant.id, () => actions.suspend(tenant.id), t("platform.suspendedToast"))
                }
                onResume={() =>
                  run(tenant.id, () => actions.resume(tenant.id), t("platform.resumedToast"))
                }
                onCancelDeletion={() =>
                  run(
                    tenant.id,
                    () => actions.cancelDeletion(tenant.id),
                    t("platform.deletionCancelledToast"),
                  )
                }
                onRequestDeletion={(days) =>
                  run(
                    tenant.id,
                    () => actions.requestDeletion(tenant.id, days),
                    t("platform.deletionScheduledToast"),
                  )
                }
              />
            ))}
          </TableBody>
        </Table>
      )}

      {total > TENANT_PAGE_SIZE ? (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span>{t("platform.pageOf", { page: page + 1, pages: lastPage + 1, total })}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            {t("platform.prev")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
          >
            {t("platform.next")}
          </Button>
        </div>
      ) : null}

      <CreateTenantDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function TenantRow({
  tenant,
  busy,
  onEdit,
  onSuspend,
  onResume,
  onCancelDeletion,
  onRequestDeletion,
}: {
  tenant: TenantDirectoryEntry;
  busy: boolean;
  onEdit: (change: { name?: string; tier?: string }) => void;
  onSuspend: () => void;
  onResume: () => void;
  onCancelDeletion: () => void;
  onRequestDeletion: (days: number) => void;
}) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState(false);
  const pendingDeletion = Boolean(tenant.deletionEffectiveAt);
  const gone = tenant.status === "deleted";
  return (
    <TableRow>
      <TableCell>
        {tenant.name ? (
          <div className="font-medium">{tenant.name}</div>
        ) : (
          <div className="font-medium italic text-muted-foreground">{t("platform.unnamed")}</div>
        )}
        <div className="font-mono text-xs text-muted-foreground">{tenant.id}</div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Badge variant={statusVariant(tenant.status)}>
            {t(`platform.status_${tenant.status}`, { defaultValue: tenant.status })}
          </Badge>
          {pendingDeletion ? (
            <span className="text-xs text-muted-foreground">
              {t("platform.deletesOn", { when: formatDateTime(tenant.deletionEffectiveAt) })}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>{tenant.tier}</TableCell>
      <TableCell>{tenant.memberCount}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDateTime(tenant.createdAt)}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          {gone ? null : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t("platform.edit")}
            </Button>
          )}
          {gone ? null : (
            <Button size="sm" variant="outline" onClick={() => setManaging(true)}>
              {t("platform.access")}
            </Button>
          )}
          {gone ? null : tenant.status === "suspended" ? (
            <ConfirmButton
              label={t("platform.resume")}
              description={t("platform.resumeConfirm", { name: tenant.name })}
              busy={busy}
              onConfirm={onResume}
            />
          ) : (
            <ConfirmButton
              label={t("platform.suspend")}
              description={t("platform.suspendConfirm", { name: tenant.name })}
              busy={busy}
              onConfirm={onSuspend}
            />
          )}
          {gone ? null : pendingDeletion ? (
            <ConfirmButton
              label={t("platform.cancelDeletion")}
              description={t("platform.cancelDeletionConfirm", { name: tenant.name })}
              busy={busy}
              onConfirm={onCancelDeletion}
            />
          ) : (
            <Button
              size="sm"
              variant="destructive"
              loading={busy}
              onClick={() => setDeleting(true)}
            >
              {t("platform.delete")}
            </Button>
          )}
        </div>
        {editing ? (
          <EditTenantDialog
            tenant={tenant}
            onClose={() => setEditing(false)}
            onSave={(change) => {
              setEditing(false);
              onEdit(change);
            }}
          />
        ) : null}
        {managing ? (
          <TenantAccessDialog tenant={tenant} onClose={() => setManaging(false)} />
        ) : null}
        <DeleteDialog
          open={deleting}
          name={tenant.name}
          onClose={() => setDeleting(false)}
          onConfirm={(days) => {
            setDeleting(false);
            onRequestDeletion(days);
          }}
        />
      </TableCell>
    </TableRow>
  );
}

function DeleteDialog({
  open,
  name,
  onClose,
  onConfirm,
}: {
  open: boolean;
  name: string;
  onClose: () => void;
  onConfirm: (days: number) => void;
}) {
  const { t } = useTranslation();
  const [days, setDays] = useState(DEFAULT_RETENTION_DAYS);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("platform.deleteTitle", { name })}</DialogTitle>
          <DialogDescription>{t("platform.deleteHint")}</DialogDescription>
        </DialogHeader>
        <NumberInput
          label={t("platform.retentionDays")}
          helperText={t("platform.retentionHint")}
          min={1}
          max={365}
          value={days}
          onChange={setDays}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={days < 1 || days > 365}
            onClick={() => onConfirm(days)}
          >
            {t("platform.deleteConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateTenantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const actions = usePlatformTenantActions();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tier, setTier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedTenant | null>(null);

  function close() {
    setName("");
    setEmail("");
    setDisplayName("");
    setTier("");
    setError(null);
    setCreated(null);
    onClose();
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const result = await actions.create({
        name: name.trim(),
        tier: tier.trim() || undefined,
        adminEmail: email.trim(),
        adminDisplayName: displayName.trim() || undefined,
      });
      toast(t("platform.createdToast"));
      if (result.emailSent) close();
      else setCreated(result);
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
          <DialogTitle>{t("platform.tenantCreate")}</DialogTitle>
          <DialogDescription>{t("platform.createHint")}</DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="flex flex-col gap-3">
            <Alert>{t("platform.emailNotSent")}</Alert>
            <Input readOnly label={t("platform.acceptLink")} value={created.acceptUrl} />
            <DialogFooter>
              <Button onClick={close}>{t("platform.done")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {error ? <Alert variant="destructive">{error}</Alert> : null}
              <Input
                label={t("platform.createName")}
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
              <Input
                label={t("platform.createAdminEmail")}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
              <Input
                label={t("platform.createAdminName")}
                value={displayName}
                onChange={(e) => setDisplayName(e.currentTarget.value)}
              />
              <Input
                label={t("platform.createTier")}
                helperText={t("platform.createTierHint")}
                value={tier}
                onChange={(e) => setTier(e.currentTarget.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => void create()}
                disabled={!name.trim() || !email.trim()}
                loading={busy}
              >
                {t("platform.tenantCreate")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Getting into a tenant (a support session, needs the tenant's own grant) and moving its
 *  ownership when the owner is gone (announced to the tenant's admins, effective after a wait). */
function TenantAccessDialog({
  tenant,
  onClose,
}: {
  tenant: TenantDirectoryEntry;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Fixed when the dialog opens: a wait that ends while it is open shows on the next open.
  const [openedAt] = useState(() => Date.now());
  const view = useTenantOwner(tenant.id, true);
  const actions = useTenantAccessActions(tenant.id);
  const [session, setSession] = useState<SupportSessionToken | null>(null);
  const [newOwner, setNewOwner] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"session" | "request" | "complete" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const pending = view.data?.owner.pendingRecovery ?? null;
  const people = view.data?.people ?? [];
  const waitOver = pending ? new Date(pending.effectiveAt).getTime() <= openedAt : false;

  function run(
    kind: "session" | "request" | "complete",
    work: () => Promise<unknown>,
    done?: string,
  ) {
    setBusy(kind);
    setError(null);
    void work()
      .then(() => done && toast(done))
      .catch(setError)
      .finally(() => setBusy(null));
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("platform.accessTitle", { name: tenant.name })}</DialogTitle>
          <DialogDescription>{t("platform.accessHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {error ? <ApiErrorMessage error={error} /> : null}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t("platform.supportTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("platform.supportHint")}</p>
            {session ? (
              <div className="flex flex-col gap-2">
                <Input readOnly label={t("platform.supportToken")} value={session.token} />
                <p className="text-xs text-muted-foreground">
                  {t("platform.supportTokenNote", {
                    role: session.role,
                    when: formatDateTime(session.expiresAt),
                  })}
                </p>
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard?.writeText(session.token);
                      toast(t("platform.copied"));
                    }}
                  >
                    {t("platform.copy")}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button
                  size="sm"
                  loading={busy === "session"}
                  onClick={() =>
                    run("session", async () => setSession(await actions.startSupportSession()))
                  }
                >
                  {t("platform.supportOpen")}
                </Button>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t("platform.ownerTitle")}</h3>
            {view.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : view.error ? (
              <ApiErrorMessage error={view.error} />
            ) : (
              <>
                <p className="text-sm">
                  {view.data?.owner.ownerEmail
                    ? t("platform.ownerIs", { email: view.data.owner.ownerEmail })
                    : t("platform.ownerNone")}
                </p>
                {pending ? (
                  <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
                    <p>
                      {t("platform.recoveryPending", {
                        email:
                          people.find((p) => p.id === pending.newOwnerMemberId)?.email ??
                          pending.newOwnerMemberId,
                        when: formatDateTime(pending.effectiveAt),
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">{pending.reason}</p>
                    <div>
                      <Button
                        size="sm"
                        disabled={!waitOver}
                        loading={busy === "complete"}
                        onClick={() =>
                          run(
                            "complete",
                            () => actions.completeRecovery(),
                            t("platform.recoveryDone"),
                          )
                        }
                      >
                        {t("platform.recoveryComplete")}
                      </Button>
                      {waitOver ? null : (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("platform.recoveryWaiting")}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Select
                      label={t("platform.recoveryNewOwner")}
                      placeholder={t("platform.recoveryPick")}
                      options={people
                        .filter((p) => !p.isOwner)
                        .map((p) => ({
                          value: p.id,
                          label: p.displayName ? `${p.displayName} (${p.email})` : p.email,
                        }))}
                      value={newOwner || undefined}
                      onValueChange={setNewOwner}
                    />
                    <Textarea
                      label={t("platform.recoveryReason")}
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.currentTarget.value)}
                    />
                    <div>
                      <Button
                        size="sm"
                        disabled={!newOwner || !reason.trim()}
                        loading={busy === "request"}
                        onClick={() =>
                          run(
                            "request",
                            () => actions.requestRecovery(newOwner, reason.trim()),
                            t("platform.recoveryRequested"),
                          )
                        }
                      >
                        {t("platform.recoveryStart")}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("platform.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTenantDialog({
  tenant,
  onClose,
  onSave,
}: {
  tenant: TenantDirectoryEntry;
  onClose: () => void;
  onSave: (change: { name?: string; tier?: string }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(tenant.name);
  const [tier, setTier] = useState(tenant.tier);
  const change = {
    ...(name.trim() !== tenant.name ? { name: name.trim() } : {}),
    ...(tier.trim() !== tenant.tier ? { tier: tier.trim() } : {}),
  };
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("platform.editTitle")}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{tenant.id}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            label={t("platform.createName")}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Input
            label={t("platform.colTier")}
            value={tier}
            onChange={(e) => setTier(e.currentTarget.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={Object.keys(change).length === 0 || !name.trim() || !tier.trim()}
            onClick={() => onSave(change)}
          >
            {t("platform.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
