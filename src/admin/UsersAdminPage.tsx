import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  MultiSelect,
  Select,
  Separator,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Spinner,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { GraphQLError } from "../api/graphqlClient";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { AdminOnly } from "../auth/AdminOnly";
import { useCurrentUser } from "../auth/useCurrentUser";
import { relativeTime } from "../lib/dates";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { DataList, type DataListColumn } from "../list/DataList";
import { AdminHistory } from "./AdminHistory";
import { ConfirmButton } from "./ConfirmButton";
import {
  useRoles,
  useUser,
  useUserAdminActions,
  useUserAudit,
  useUsers,
  roleDisplayName,
  type AdminRole,
  type AdminUserRow,
  type UserStatus,
} from "./userAdminApi";

const ALL = "all";
const DEFAULT_PAGE_SIZE = 25;
/** `ListUsers` caps a page at 200 (`identity.MaxListLimit`). */
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];
const STATUSES: UserStatus[] = ["active", "disabled", "invited"];
const KNOWN_ERRORS = ["last_admin", "self_modification", "already_member", "weak_password"];
/** The server's refusals get their own message; anything else shows the server's text. */
function useActionError() {
  const { t } = useTranslation();
  return (err: unknown) => {
    const code = err instanceof GraphQLError ? err.code : "";
    if (KNOWN_ERRORS.includes(code)) return t(`admin.users.error_${code}`);
    return err instanceof Error ? err.message : t("common.somethingWentWrong");
  };
}

function statusVariant(status: UserStatus): "success" | "secondary" | "warning" {
  if (status === "active") return "success";
  if (status === "invited") return "warning";
  return "secondary";
}

function Initials({ text }: { text: string }) {
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
    >
      {text.slice(0, 2).toUpperCase() || "?"}
    </span>
  );
}

function roleOptions(roles: AdminRole[] | undefined) {
  return (roles ?? []).map((role) => ({ value: role.name, label: roleDisplayName(role) }));
}

/** Shown when an invitation link couldn't be emailed: the admin copies it and passes it on. */
function InviteLinkNotice({ url }: { url: string }) {
  const { t } = useTranslation();
  return (
    <Alert className="flex flex-col gap-2">
      <span className="text-sm">{t("admin.users.inviteNotEmailed")}</span>
      <div className="flex items-center gap-2">
        <Input
          className="h-8 text-xs"
          readOnly
          value={url}
          aria-label={t("admin.users.inviteLink")}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              .writeText(url)
              .then(() => toast(t("admin.users.inviteLinkCopied")))
          }
        >
          {t("admin.users.copy")}
        </Button>
      </div>
    </Alert>
  );
}

/** Adds someone: by invitation (default — they choose their own password from the emailed link)
 *  or, ticking "set a password now", with a password the admin passes on. */
function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { createUser, inviteUser } = useUserAdminActions();
  const { data: roles } = useRoles();
  const describe = useActionError();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [withPassword, setWithPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [manualLink, setManualLink] = useState<string | null>(null);

  function close() {
    setEmail("");
    setDisplayName("");
    setWithPassword(false);
    setPassword("");
    setPicked([]);
    setError(null);
    setFieldErrors({});
    setManualLink(null);
    onOpenChange(false);
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      if (withPassword) {
        const result = await createUser({
          email: email.trim(),
          displayName: displayName.trim() || undefined,
          password: password || undefined,
          roles: picked,
        });
        toast(
          result.createdIdentity
            ? t("admin.users.created", { email: result.user.email })
            : t("admin.users.addedExisting", { email: result.user.email }),
        );
        close();
        return;
      }
      const result = await inviteUser({
        email: email.trim(),
        displayName: displayName.trim() || undefined,
        roles: picked,
      });
      if (result.emailSent) {
        toast(t("admin.users.invited", { email: result.user.email }));
        close();
      } else {
        setManualLink(result.acceptUrl);
      }
    } catch (err) {
      setError(describe(err));
      if (err instanceof GraphQLError && err.fieldErrors) setFieldErrors(err.fieldErrors);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.users.createTitle")}</DialogTitle>
        </DialogHeader>
        {manualLink ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">{t("admin.users.invitedNoEmail", { email: email.trim() })}</p>
            <InviteLinkNotice url={manualLink} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            <Input
              label={t("admin.users.email")}
              type="email"
              value={email}
              error={fieldErrors.email?.[0]}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <Input
              label={t("admin.users.displayName")}
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
            <MultiSelect
              label={t("admin.users.rolesLabel")}
              placeholder={t("admin.users.rolesPlaceholder")}
              options={roleOptions(roles)}
              value={picked}
              onChange={setPicked}
              error={fieldErrors.roles?.[0]}
            />
            <Checkbox
              label={t("admin.users.setPasswordNow")}
              checked={withPassword}
              onCheckedChange={setWithPassword}
            />
            {withPassword ? (
              <Input
                label={t("admin.users.password")}
                type="password"
                autoComplete="new-password"
                value={password}
                error={fieldErrors.password?.[0]}
                helperText={t("admin.users.passwordHint")}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{t("admin.users.inviteHint")}</p>
            )}
          </div>
        )}
        <DialogFooter>
          {manualLink ? (
            <Button onClick={close}>{t("admin.users.done")}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                {t("shell.cancel")}
              </Button>
              <Button loading={saving} disabled={!email.trim()} onClick={() => void handleSubmit()}>
                {withPassword ? t("admin.users.add") : t("admin.users.sendInvite")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserHistory({ userId }: { userId: string }) {
  return <AdminHistory audit={useUserAudit(userId)} />;
}

function UserDetail({
  userId,
  selfId,
  onClose,
}: {
  userId: string;
  selfId: string | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { data: user, isLoading, error } = useUser(userId);
  const { data: roles } = useRoles();
  const actions = useUserAdminActions();
  const describe = useActionError();
  // Unsaved edit of the display name; null shows the saved value.
  const [draftName, setDraftName] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [resentLink, setResentLink] = useState<string | null>(null);

  if (isLoading) return <Spinner />;
  if (error) return <ApiErrorMessage error={error} />;
  if (!user) return null;
  const current = user;
  const displayName = draftName ?? current.displayName;

  async function run(name: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(name);
    try {
      await fn();
      if (done) toast(done);
    } catch (err) {
      toast(describe(err), { variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  function changeRoles(next: string[]) {
    const added = next.filter((r) => !current.roles.includes(r));
    const removed = current.roles.filter((r) => !next.includes(r));
    void run("roles", async () => {
      for (const role of added) await actions.assignRole(current.id, role);
      for (const role of removed) await actions.revokeRole(current.id, role);
    });
  }

  const isSelf = current.id === selfId;
  const canResetPassword = current.authProvider === "local" && !current.sharedIdentity && !isSelf;

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="flex items-center gap-3">
        <Initials text={current.displayName || current.email} />
        <div className="min-w-0">
          <div className="truncate font-medium">{current.displayName || current.email}</div>
          <div className="truncate text-sm text-muted-foreground">{current.email}</div>
        </div>
        <Badge variant={statusVariant(current.status)} className="ml-auto">
          {t(`admin.users.status_${current.status}`)}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("admin.users.createdAt", { when: relativeTime(current.createdAt, i18n.language) })}
        {current.sharedIdentity ? ` · ${t("admin.users.sharedIdentity")}` : ""}
      </p>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("admin.users.profile")}</h3>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label={t("admin.users.displayName")}
              value={displayName}
              onChange={(event) => setDraftName(event.currentTarget.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            loading={busy === "profile"}
            disabled={displayName.trim() === current.displayName}
            onClick={() =>
              void run(
                "profile",
                async () => {
                  await actions.updateUser(current.id, displayName);
                  setDraftName(null);
                },
                t("admin.users.saved"),
              )
            }
          >
            {t("admin.users.save")}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("admin.users.rolesLabel")}</h3>
        <MultiSelect
          placeholder={t("admin.users.rolesPlaceholder")}
          options={roleOptions(roles)}
          value={current.roles}
          onChange={changeRoles}
        />
      </section>

      {current.status === "invited" ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("admin.users.invitation")}</h3>
          <p className="text-sm text-muted-foreground">
            {current.invitationExpiresAt
              ? t("admin.users.invitationExpires", {
                  when: relativeTime(current.invitationExpiresAt, i18n.language),
                })
              : t("admin.users.invitationExpired")}
          </p>
          <div>
            <Button
              size="sm"
              variant="outline"
              loading={busy === "invite"}
              onClick={() =>
                void run("invite", async () => {
                  const result = await actions.resendInvitation(current.id);
                  setResentLink(result.emailSent ? null : result.acceptUrl);
                  if (result.emailSent) toast(t("admin.users.invited", { email: current.email }));
                })
              }
            >
              {t("admin.users.resendInvite")}
            </Button>
          </div>
          {resentLink ? <InviteLinkNotice url={resentLink} /> : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("admin.users.access")}</h3>
        {!isSelf ? (
          <div className="flex flex-wrap gap-2">
            {current.status === "invited" ? null : current.status === "disabled" ? (
              <Button
                size="sm"
                variant="outline"
                loading={busy === "status"}
                onClick={() => void run("status", () => actions.enableUser(current.id))}
              >
                {t("admin.users.enable")}
              </Button>
            ) : (
              <ConfirmButton
                label={t("admin.users.disable")}
                description={t("admin.users.disableConfirm", { email: current.email })}
                busy={busy === "status"}
                onConfirm={() => void run("status", () => actions.disableUser(current.id))}
              />
            )}
            <ConfirmButton
              destructive
              label={
                current.status === "invited"
                  ? t("admin.users.withdrawInvite")
                  : t("admin.users.remove")
              }
              description={
                current.status === "invited"
                  ? t("admin.users.withdrawInviteConfirm", { email: current.email })
                  : t("admin.users.removeConfirm", { email: current.email })
              }
              busy={busy === "remove"}
              onConfirm={() =>
                void run("remove", async () => {
                  await actions.removeUser(current.id);
                  onClose();
                })
              }
            />
          </div>
        ) : null}
        {canResetPassword ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={t("admin.users.newPassword")}
                type="password"
                autoComplete="new-password"
                helperText={t("admin.users.resetPasswordHint")}
                value={newPassword}
                onChange={(event) => setNewPassword(event.currentTarget.value)}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              loading={busy === "password"}
              disabled={newPassword.length === 0}
              onClick={() =>
                void run(
                  "password",
                  async () => {
                    await actions.resetPassword(current.id, newPassword);
                    setNewPassword("");
                  },
                  t("admin.users.passwordReset"),
                )
              }
            >
              {t("admin.users.resetPassword")}
            </Button>
          </div>
        ) : current.sharedIdentity ? (
          <p className="text-xs text-muted-foreground">{t("admin.users.sharedIdentityHint")}</p>
        ) : null}
        {!isSelf && !current.isOwner && current.status !== "invited" ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t("admin.users.resetMfaHint")}</p>
            <ConfirmButton
              label={t("admin.users.resetMfa")}
              description={t("admin.users.resetMfaConfirm", { email: current.email })}
              busy={busy === "mfa"}
              onConfirm={() =>
                void run("mfa", () => actions.resetMfa(current.id), t("admin.users.mfaReset"))
              }
            />
          </div>
        ) : null}
        {current.isOwner && !isSelf ? (
          <p className="text-xs text-muted-foreground">{t("admin.users.ownerProtectedHint")}</p>
        ) : null}
      </section>

      <Separator />
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("admin.users.history")}</h3>
        <UserHistory userId={current.id} />
      </section>
    </div>
  );
}

/** The user cell: initials, name or email, "(you)", an SSO badge, and the email under a name. */
function UserCell({ user, selfId }: { user: AdminUserRow; selfId: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Initials text={user.displayName || user.email} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 truncate text-sm font-medium">
          {user.displayName || user.email}
          {user.id === selfId ? (
            <span className="text-xs font-normal text-muted-foreground">
              ({t("admin.users.you")})
            </span>
          ) : null}
          {user.isOwner ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
              {t("admin.users.owner")}
            </Badge>
          ) : null}
          {user.authProvider !== "local" ? (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
              {t("admin.users.sso")}
            </Badge>
          ) : null}
        </div>
        {user.displayName ? (
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        ) : null}
      </div>
    </div>
  );
}

function UsersAdminPageContent() {
  const { t, i18n } = useTranslation();
  const { data: me } = useCurrentUser();
  const { data: roles } = useRoles();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [role, setRole] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 250);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: status === ALL ? undefined : (status as UserStatus),
      role: role === ALL ? undefined : role,
      offset: (page - 1) * pageSize,
      limit: pageSize,
    }),
    [debouncedSearch, status, role, page, pageSize],
  );
  const { data, isLoading, isFetching, error, refetch } = useUsers(query);
  const selfId = me?.userId ?? null;
  const users = data?.users ?? [];

  const columns: DataListColumn<AdminUserRow>[] = [
    {
      key: "user",
      header: t("admin.users.colUser"),
      required: true,
      cell: (user) => <UserCell user={user} selfId={selfId} />,
    },
    {
      key: "roles",
      header: t("admin.users.colRoles"),
      filter: (
        <Select
          className="h-8 px-2 text-xs"
          aria-label={t("admin.users.colRoles")}
          value={role}
          options={[
            { value: ALL, label: t("admin.users.allRoles") },
            ...(roles ?? []).map((r) => ({
              value: r.name,
              label: `${roleDisplayName(r)} (${r.userCount})`,
            })),
          ]}
          onValueChange={(value) => {
            setRole(value);
            setPage(1);
          }}
        />
      ),
      cell: (user) => (
        <div className="flex flex-wrap gap-1">
          {user.roles.map((r) => (
            <Badge key={r} variant="outline" className="font-normal">
              {r}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "status",
      header: t("admin.users.colStatus"),
      width: "11rem",
      filter: (
        <Select
          className="h-8 px-2 text-xs"
          aria-label={t("admin.users.colStatus")}
          value={status}
          options={[
            { value: ALL, label: t("admin.users.allStatuses") },
            ...STATUSES.map((s) => ({ value: s, label: t(`admin.users.status_${s}`) })),
          ]}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        />
      ),
      cell: (user) => (
        <Badge variant={statusVariant(user.status)}>{t(`admin.users.status_${user.status}`)}</Badge>
      ),
    },
    {
      key: "lastLogin",
      header: t("admin.users.colLastLogin"),
      width: "11rem",
      cell: (user) => (
        <span className="text-muted-foreground" title={user.lastLoginAt ?? undefined}>
          {user.lastLoginAt
            ? relativeTime(user.lastLoginAt, i18n.language)
            : t("admin.users.neverSignedIn")}
        </span>
      ),
    },
  ];

  return (
    <>
      <DataList
        title={t("admin.users.title")}
        rows={users}
        getRowId={(user) => user.id}
        columns={columns}
        loading={isLoading}
        error={error}
        emptyText={t("admin.users.empty")}
        search={{
          value: search,
          placeholder: t("admin.users.searchPlaceholder"),
          onChange: (value) => {
            setSearch(value);
            setPage(1);
          },
        }}
        filtersActive={status !== ALL || role !== ALL}
        onRefresh={() => void refetch()}
        refreshing={isFetching}
        columnVisibilityKey="platform-ui.list.hiddenColumns.admin.users"
        onRowClick={(user) => setOpenUser(user.id)}
        toolbar={<Button onClick={() => setCreating(true)}>{t("admin.users.add")}</Button>}
        paging={{
          page,
          pageSize,
          total: data?.total ?? null,
          onPageChange: setPage,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          onPageSizeChange: (size) => {
            setPageSize(size);
            setPage(1);
          },
        }}
      />

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <Sheet open={openUser !== null} onOpenChange={(open) => !open && setOpenUser(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("admin.users.detailTitle")}</SheetTitle>
          </SheetHeader>
          {openUser ? (
            <UserDetail userId={openUser} selfId={selfId} onClose={() => setOpenUser(null)} />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Self-gated on the `admin` role rather than trusting every consumer to gate the route: the
 * content below calls admin-only GraphQL fields from its very first render, so an ungated
 * non-admin would otherwise watch the page assemble itself and then fill with 403 alerts.
 * `AdminOnly` keeps that body unmounted entirely until roles resolve and pass
 * (`docs/audits/02-auth-permission-workflow-diagram-audit.md` finding B6). */
export function UsersAdminPage() {
  return (
    <AdminOnly>
      <UsersAdminPageContent />
    </AdminOnly>
  );
}
