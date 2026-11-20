import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  buttonVariants,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  MultiSelect,
  Select,
  SettingsRow,
  SettingsSection,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { GraphQLError } from "../api/graphqlClient";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { AdminOnly } from "../auth/AdminOnly";
import { useCurrentUser } from "../auth/useCurrentUser";
import { relativeTime } from "../lib/dates";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useNavigationAdapter } from "../navigation/NavigationContext";
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

function Initials({ text, size = "sm" }: { text: string; size?: "sm" | "lg" }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary ${size === "lg" ? "h-11 w-11 text-sm" : "h-7 w-7 text-[11px]"}`}
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
  accountSecurityHref,
}: {
  userId: string;
  selfId: string | null;
  onClose: () => void;
  accountSecurityHref: string | null;
}) {
  const { t, i18n } = useTranslation();
  const nav = useNavigationAdapter();
  const { data: user, isLoading, error } = useUser(userId);
  const { data: roles } = useRoles();
  const actions = useUserAdminActions();
  const describe = useActionError();
  // Unsaved edit of the display name; null shows the saved value.
  const [draftName, setDraftName] = useState<string | null>(null);
  // Unsaved role picks; null shows the saved roles. Applied only on "Save".
  const [draftRoles, setDraftRoles] = useState<string[] | null>(null);
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

  function saveName() {
    void run(
      "profile",
      async () => {
        await actions.updateUser(current.id, displayName.trim());
        setDraftName(null);
      },
      t("admin.users.saved"),
    );
  }

  const pickedRoles = draftRoles ?? current.roles;
  const rolesChanged =
    pickedRoles.length !== current.roles.length ||
    pickedRoles.some((r) => !current.roles.includes(r));

  function saveRoles() {
    const added = pickedRoles.filter((r) => !current.roles.includes(r));
    const removed = current.roles.filter((r) => !pickedRoles.includes(r));
    void run(
      "roles",
      async () => {
        for (const role of added) await actions.assignRole(current.id, role);
        for (const role of removed) await actions.revokeRole(current.id, role);
        setDraftRoles(null);
      },
      t("admin.users.rolesSaved"),
    );
  }

  const isSelf = current.id === selfId;
  const canResetPassword = current.authProvider === "local" && !current.sharedIdentity && !isSelf;
  const nameChanged = displayName.trim() !== current.displayName;
  const invited = current.status === "invited";

  return (
    <div className="flex flex-col gap-4">
      {/* Who: identity, what marks them out, and when they were added and last signed in. */}
      <div className="flex items-start gap-3">
        <Initials text={current.displayName || current.email} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-base font-semibold text-foreground">
              {current.displayName || current.email}
            </span>
            {isSelf ? <Badge variant="outline">{t("admin.users.you")}</Badge> : null}
            {current.isOwner ? <Badge variant="secondary">{t("admin.users.owner")}</Badge> : null}
            {current.authProvider !== "local" ? (
              <Badge variant="outline">{t("admin.users.sso")}</Badge>
            ) : null}
          </div>
          {current.displayName ? (
            <div className="truncate text-sm text-muted-foreground">{current.email}</div>
          ) : null}
          <div className="mt-1 text-xs text-muted-foreground">
            {t("admin.users.createdAt", { when: relativeTime(current.createdAt, i18n.language) })}
            {" · "}
            {current.lastLoginAt
              ? t("admin.users.lastSignIn", {
                  when: relativeTime(current.lastLoginAt, i18n.language),
                })
              : t("admin.users.neverSignedIn")}
          </div>
        </div>
        <Badge variant={statusVariant(current.status)} className="shrink-0">
          {t(`admin.users.status_${current.status}`)}
        </Badge>
      </div>

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">{t("admin.users.tabInfo")}</TabsTrigger>
          <TabsTrigger value="history">{t("admin.users.history")}</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="flex flex-col gap-4">
          <SettingsSection title={t("admin.users.profile")}>
            <SettingsRow label={t("admin.users.displayName")} controlWidth="wide">
              <Input
                className="w-full"
                aria-label={t("admin.users.displayName")}
                placeholder={current.email}
                value={displayName}
                onChange={(event) => setDraftName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && nameChanged) saveName();
                  if (event.key === "Escape") setDraftName(null);
                }}
              />
              {nameChanged ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setDraftName(null)}>
                    {t("admin.users.cancelEdit")}
                  </Button>
                  <Button size="sm" loading={busy === "profile"} onClick={saveName}>
                    {t("admin.users.save")}
                  </Button>
                </>
              ) : null}
            </SettingsRow>
            <SettingsRow label={t("admin.users.email")}>
              <span className="truncate text-sm">{current.email}</span>
            </SettingsRow>
            <SettingsRow
              label={t("admin.users.signInMethod")}
              description={current.sharedIdentity ? t("admin.users.sharedIdentity") : undefined}
            >
              <span className="text-sm">
                {current.authProvider === "local"
                  ? current.hasPassword
                    ? t("admin.users.signInPassword")
                    : t("admin.users.signInNoPassword")
                  : t("admin.users.signInSso", { provider: current.authProvider })}
              </span>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            title={t("admin.users.rolesLabel")}
            description={t("admin.users.rolesHint")}
          >
            <SettingsRow label={t("admin.users.rolesInWorkspace")} controlWidth="wide">
              <div>
                <MultiSelect
                  placeholder={t("admin.users.rolesPlaceholder")}
                  options={roleOptions(roles)}
                  value={pickedRoles}
                  onChange={setDraftRoles}
                />
              </div>
              {rolesChanged ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setDraftRoles(null)}>
                    {t("admin.users.cancelEdit")}
                  </Button>
                  <Button size="sm" loading={busy === "roles"} onClick={saveRoles}>
                    {t("admin.users.save")}
                  </Button>
                </>
              ) : null}
            </SettingsRow>
          </SettingsSection>

          {invited ? (
            <SettingsSection title={t("admin.users.invitation")}>
              <SettingsRow
                label={t("admin.users.invitationStatus")}
                description={
                  current.invitationExpiresAt
                    ? t("admin.users.invitationExpires", {
                        when: relativeTime(current.invitationExpiresAt, i18n.language),
                      })
                    : t("admin.users.invitationExpired")
                }
              >
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === "invite"}
                  onClick={() =>
                    void run("invite", async () => {
                      const result = await actions.resendInvitation(current.id);
                      setResentLink(result.emailSent ? null : result.acceptUrl);
                      if (result.emailSent)
                        toast(t("admin.users.invited", { email: current.email }));
                    })
                  }
                >
                  {t("admin.users.resendInvite")}
                </Button>
              </SettingsRow>
              {resentLink ? (
                <div className="px-4 py-3">
                  <InviteLinkNotice url={resentLink} />
                </div>
              ) : null}
            </SettingsSection>
          ) : null}

          {isSelf ? (
            <SettingsSection title={t("admin.users.access")}>
              <SettingsRow
                label={t("admin.users.ownSecurity")}
                description={t("admin.users.ownSecurityHint")}
              >
                {accountSecurityHref ? (
                  <nav.Link
                    to={accountSecurityHref}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    {t("admin.users.openAccountSecurity")}
                  </nav.Link>
                ) : null}
              </SettingsRow>
            </SettingsSection>
          ) : (
            <SettingsSection
              title={t("admin.users.access")}
              description={current.isOwner ? t("admin.users.ownerProtectedHint") : undefined}
            >
              {canResetPassword ? (
                <SettingsRow
                  label={t("admin.users.resetPassword")}
                  description={t("admin.users.resetPasswordHint")}
                  controlWidth="wide"
                >
                  <Input
                    className="w-full"
                    type="password"
                    autoComplete="new-password"
                    aria-label={t("admin.users.newPassword")}
                    placeholder={t("admin.users.newPassword")}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.currentTarget.value)}
                  />
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
                    {t("admin.users.resetPasswordShort")}
                  </Button>
                </SettingsRow>
              ) : current.sharedIdentity ? (
                <SettingsRow
                  label={t("admin.users.resetPassword")}
                  description={t("admin.users.sharedIdentityHint")}
                />
              ) : null}
              {!current.isOwner && !invited ? (
                <SettingsRow
                  label={t("admin.users.resetMfa")}
                  description={t("admin.users.resetMfaHint")}
                >
                  <ConfirmButton
                    label={t("admin.users.resetMfaShort")}
                    description={t("admin.users.resetMfaConfirm", { email: current.email })}
                    busy={busy === "mfa"}
                    onConfirm={() =>
                      void run("mfa", () => actions.resetMfa(current.id), t("admin.users.mfaReset"))
                    }
                  />
                </SettingsRow>
              ) : null}
              {!invited ? (
                <SettingsRow
                  label={
                    current.status === "disabled"
                      ? t("admin.users.enableTitle")
                      : t("admin.users.disableTitle")
                  }
                  description={
                    current.status === "disabled"
                      ? t("admin.users.enableHint")
                      : t("admin.users.disableHint")
                  }
                >
                  {current.status === "disabled" ? (
                    <ConfirmButton
                      label={t("admin.users.enable")}
                      description={t("admin.users.enableConfirm", { email: current.email })}
                      busy={busy === "status"}
                      onConfirm={() => void run("status", () => actions.enableUser(current.id))}
                    />
                  ) : (
                    <ConfirmButton
                      label={t("admin.users.disable")}
                      description={t("admin.users.disableConfirm", { email: current.email })}
                      busy={busy === "status"}
                      disabled={current.isOwner}
                      onConfirm={() => void run("status", () => actions.disableUser(current.id))}
                    />
                  )}
                </SettingsRow>
              ) : null}
              <SettingsRow
                label={invited ? t("admin.users.withdrawInvite") : t("admin.users.removeTitle")}
                description={invited ? t("admin.users.withdrawHint") : t("admin.users.removeHint")}
              >
                <ConfirmButton
                  destructive
                  label={invited ? t("admin.users.withdrawInvite") : t("admin.users.remove")}
                  description={
                    invited
                      ? t("admin.users.withdrawInviteConfirm", { email: current.email })
                      : t("admin.users.removeConfirm", { email: current.email })
                  }
                  busy={busy === "remove"}
                  disabled={current.isOwner}
                  onConfirm={() =>
                    void run("remove", async () => {
                      await actions.removeUser(current.id);
                      onClose();
                    })
                  }
                />
              </SettingsRow>
            </SettingsSection>
          )}
        </TabsContent>

        <TabsContent value="history">
          <UserHistory userId={current.id} />
        </TabsContent>
      </Tabs>
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

function UsersAdminPageContent({ accountSecurityHref }: { accountSecurityHref: string | null }) {
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
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("admin.users.detailTitle")}</SheetTitle>
          </SheetHeader>
          {openUser ? (
            <UserDetail
              userId={openUser}
              selfId={selfId}
              onClose={() => setOpenUser(null)}
              accountSecurityHref={accountSecurityHref}
            />
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
export function UsersAdminPage({
  accountSecurityHref = "/account/security",
}: {
  /** Where "your own security" points from your own row (the shell's account security page);
   *  `null` hides the link. */
  accountSecurityHref?: string | null;
} = {}) {
  return (
    <AdminOnly>
      <UsersAdminPageContent accountSecurityHref={accountSecurityHref} />
    </AdminOnly>
  );
}
