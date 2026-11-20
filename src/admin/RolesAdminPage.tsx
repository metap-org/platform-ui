import { useMemo, useState } from "react";
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Autocomplete,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { ApiError, apiFetch } from "../api/client";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { AdminOnly } from "../auth/AdminOnly";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { DataList, type DataListColumn } from "../list/DataList";
import { AdminHistory } from "./AdminHistory";
import {
  RolePermissionsEditor,
  type RolePermissionsEditorProps,
} from "./policies/RolePermissionsEditor";
import { useRole, useRoleAdminActions, useRoleAudit } from "./roleAdminApi";
import {
  roleDisplayName,
  useRoles,
  useUserAdminActions,
  useUsers,
  type AdminRole,
  type AdminUserRow,
} from "./userAdminApi";

const MEMBERS_PAGE = 200;

/** A server refusal this page explains itself; anything else shows the server's text. */
function describeError(err: unknown, t: (key: string) => string): string {
  const code = err instanceof ApiError ? err.code : "";
  if (code === "role_exists") return t("admin.roles.error_role_exists");
  if (code === "last_admin" || code === "self_modification") return t(`admin.users.error_${code}`);
  return err instanceof Error ? err.message : t("common.somethingWentWrong");
}

function CreateRoleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (name: string) => void;
}) {
  const { t } = useTranslation();
  const { createRole } = useRoleAdminActions();
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const { data: roles } = useRoles();

  function close() {
    setName("");
    setLabel("");
    setDescription("");
    setCopyFrom(undefined);
    setError(null);
    setFieldErrors({});
    onOpenChange(false);
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const role = await createRole({
        name: name.trim(),
        label: label.trim() || undefined,
        description: description.trim() || undefined,
        copyFrom,
      });
      toast(t("admin.roles.created", { name: roleDisplayName(role) }));
      close();
      onCreated(role.name);
    } catch (err) {
      setError(describeError(err, t));
      if (err instanceof ApiError && err.fieldErrors) setFieldErrors(err.fieldErrors);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.roles.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Input
            label={t("admin.roles.name")}
            value={name}
            error={fieldErrors.name?.[0]}
            helperText={t("admin.roles.nameHint")}
            onChange={(event) => setName(event.currentTarget.value.toLowerCase())}
          />
          <Input
            label={t("admin.roles.label")}
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
          />
          <Textarea
            label={t("admin.roles.description")}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
          <Select
            label={t("admin.rolePermissions.copyFrom")}
            placeholder={t("admin.rolePermissions.copyFromNone")}
            options={(roles ?? [])
              .filter((r) => r.name !== "admin")
              .map((r) => ({ value: r.name, label: roleDisplayName(r) }))}
            value={copyFrom}
            onValueChange={setCopyFrom}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("shell.cancel")}
          </Button>
          <Button loading={saving} disabled={!name.trim()} onClick={() => void handleCreate()}>
            {t("admin.roles.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** `role_in_use`: lists what still holds the role, so the admin knows what to clear first. */
function InUseMessage({ error }: { error: ApiError }) {
  const { t } = useTranslation();
  const members = error.fieldErrors?.members ?? [];
  const policies = error.fieldErrors?.policies ?? [];
  return (
    <Alert variant="destructive" className="flex flex-col gap-2">
      <span className="font-medium">{t("admin.roles.inUseTitle")}</span>
      {members.length > 0 ? (
        <span className="text-sm">
          {t("admin.roles.inUseMembers")}: {members.join(", ")}
        </span>
      ) : null}
      {policies.length > 0 ? (
        <span className="text-sm">
          {t("admin.roles.inUsePolicies")}: {policies.join(", ")}
        </span>
      ) : null}
      <span className="text-sm">{t("admin.roles.inUseHint")}</span>
    </Alert>
  );
}

function RoleInfo({ role, onDeleted }: { role: AdminRole; onDeleted: () => void }) {
  const { t, i18n } = useTranslation();
  const { updateRole, deleteRole } = useRoleAdminActions();
  // Unsaved edits; null shows the saved value.
  const [draftLabel, setDraftLabel] = useState<string | null>(null);
  const [draftDescription, setDraftDescription] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<ApiError | Error | null>(null);
  const label = draftLabel ?? role.label ?? "";
  const description = draftDescription ?? role.description ?? "";
  const dirty =
    label.trim() !== (role.label ?? "") || description.trim() !== (role.description ?? "");

  async function handleSave() {
    setSaving(true);
    try {
      await updateRole({ name: role.name, label: label.trim(), description: description.trim() });
      setDraftLabel(null);
      setDraftDescription(null);
      toast(t("admin.users.saved"));
    } catch (err) {
      toast(describeError(err, t), { variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRole(role.name);
      toast(t("admin.roles.deleted", { name: roleDisplayName(role) }));
      onDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err : new Error(t("common.somethingWentWrong")));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{role.name}</code>
        {role.builtin ? <Badge variant="secondary">{t("admin.roles.builtin")}</Badge> : null}
        <span>· {t("admin.roles.memberCount", { count: role.userCount })}</span>
        <span>· {t("admin.roles.policyCount", { count: role.policyCount })}</span>
      </div>

      <section className="flex flex-col gap-3">
        <Input
          label={t("admin.roles.label")}
          value={label}
          placeholder={role.name}
          onChange={(event) => setDraftLabel(event.currentTarget.value)}
        />
        <Textarea
          label={t("admin.roles.description")}
          rows={3}
          value={description}
          onChange={(event) => setDraftDescription(event.currentTarget.value)}
        />
        <div>
          <Button
            size="sm"
            variant="outline"
            loading={saving}
            disabled={!dirty}
            onClick={() => void handleSave()}
          >
            {t("admin.users.save")}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("admin.roles.dangerZone")}</h3>
        {role.builtin ? (
          <p className="text-sm text-muted-foreground">{t("admin.roles.builtinHint")}</p>
        ) : (
          <>
            {deleteError instanceof ApiError && deleteError.code === "role_in_use" ? (
              <InUseMessage error={deleteError} />
            ) : deleteError ? (
              <Alert variant="destructive">{deleteError.message}</Alert>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="self-start" loading={deleting}>
                  {t("admin.roles.delete")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("admin.roles.delete")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("admin.roles.deleteConfirm", { name: roleDisplayName(role) })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("shell.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleDelete()}>
                    {t("admin.roles.delete")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </section>
      {role.updatedAt ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.roles.updatedAt", {
            when: new Date(role.updatedAt).toLocaleString(i18n.language),
          })}
        </p>
      ) : null}
    </div>
  );
}

/** Searches the tenant's members for the "add member" picker. */
async function searchMembers(query: string, exclude: Set<string>) {
  const params = new URLSearchParams({ limit: "10" });
  if (query.trim()) params.set("search", query.trim());
  const data = await apiFetch<{ users: AdminUserRow[] }>(`/admin/users?${params.toString()}`);
  return data.users
    .filter((u) => !exclude.has(u.id))
    .map((u) => ({
      value: u.id,
      label: u.displayName ? `${u.displayName} · ${u.email}` : u.email,
    }));
}

function RoleMembers({ role }: { role: AdminRole }) {
  const { t } = useTranslation();
  const { assignRole, revokeRole } = useUserAdminActions();
  const { data, isLoading, error } = useUsers({ role: role.name, offset: 0, limit: MEMBERS_PAGE });
  const members = useMemo(() => data?.users ?? [], [data]);
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const [pickerInput, setPickerInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await fn();
      toast(done);
    } catch (err) {
      toast(describeError(err, t), { variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      <Autocomplete
        label={t("admin.roles.addMember")}
        placeholder={t("admin.users.searchPlaceholder")}
        inputValue={pickerInput}
        onInputChange={setPickerInput}
        onSearch={(query) => searchMembers(query, memberIds)}
        disabled={busy === "add"}
        onValueChange={(userId) => {
          if (!userId) return;
          setPickerInput("");
          void run("add", () => assignRole(userId, role.name), t("admin.roles.memberAdded"));
        }}
      />
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ApiErrorMessage error={error} />
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.roles.membersEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{m.displayName || m.email}</div>
                {m.displayName ? (
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                loading={busy === m.id}
                disabled={busy !== null && busy !== m.id}
                onClick={() =>
                  void run(m.id, () => revokeRole(m.id, role.name), t("admin.roles.memberRemoved"))
                }
              >
                {t("admin.roles.removeMember")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > members.length ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.roles.membersTruncated", { shown: members.length, total: data.total })}
        </p>
      ) : null}
    </div>
  );
}

export type RolesAdminPageProps = {
  /** Sections of the permissions editor (e.g. product modules); default: the entity namespace. */
  permissionGroups?: RolePermissionsEditorProps["groupFor"];
  /** Where one entity's advanced policies are edited. */
  advancedHref?: RolePermissionsEditorProps["advancedHref"];
};

function RoleDetail({
  name,
  onClose,
  permissionGroups,
  advancedHref,
}: { name: string; onClose: () => void } & RolesAdminPageProps) {
  const { t } = useTranslation();
  const { data: role, isLoading, error } = useRole(name);
  const audit = useRoleAudit(name);

  if (isLoading) return <Spinner />;
  if (error) return <ApiErrorMessage error={error} />;
  if (!role) return null;

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div>
        <div className="text-base font-semibold">{roleDisplayName(role)}</div>
        {role.description ? (
          <p className="text-sm text-muted-foreground">{role.description}</p>
        ) : null}
      </div>
      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">{t("admin.roles.tabInfo")}</TabsTrigger>
          <TabsTrigger value="permissions">
            {t("admin.roles.tabPermissions", { count: role.policyCount })}
          </TabsTrigger>
          <TabsTrigger value="members">
            {t("admin.roles.tabMembers", { count: role.userCount })}
          </TabsTrigger>
          <TabsTrigger value="history">{t("admin.users.history")}</TabsTrigger>
        </TabsList>
        <TabsContent value="info">
          <RoleInfo role={role} onDeleted={onClose} />
        </TabsContent>
        {/* Kept mounted (hidden when inactive) so unsaved permission edits survive a tab switch. */}
        <TabsContent value="permissions" forceMount className="data-[state=inactive]:hidden">
          <RolePermissionsEditor
            key={role.name}
            role={role}
            groupFor={permissionGroups}
            advancedHref={advancedHref}
          />
        </TabsContent>
        <TabsContent value="members">
          <RoleMembers role={role} />
        </TabsContent>
        <TabsContent value="history">
          <div className="pt-2">
            <AdminHistory audit={audit} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RolesAdminPageContent({ permissionGroups, advancedHref }: RolesAdminPageProps) {
  const { t } = useTranslation();
  // `?role=<name>` opens that role, so other screens (the per-entity policy view) can link to it.
  const [searchParams, setSearchParams] = useSearchParams();
  const openRole = searchParams.get("role");
  const setOpenRole = (name: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (name) next.set("role", name);
    else next.delete("role");
    setSearchParams(next);
  };
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const { data, isLoading, isFetching, error, refetch } = useRoles(debouncedSearch);
  const [creating, setCreating] = useState(false);
  const roles = data ?? [];

  const columns: DataListColumn<AdminRole>[] = [
    {
      key: "role",
      header: t("admin.roles.colRole"),
      required: true,
      cell: (role) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{roleDisplayName(role)}</span>
          {role.label ? (
            <code className="truncate text-xs text-muted-foreground">{role.name}</code>
          ) : null}
          {role.builtin ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
              {t("admin.roles.builtin")}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: "description",
      header: t("admin.roles.description"),
      cell: (role) => (
        <span className="truncate text-muted-foreground">{role.description ?? ""}</span>
      ),
    },
    {
      key: "members",
      header: t("admin.roles.colMembers"),
      width: "8rem",
      cell: (role) => role.userCount,
    },
    {
      key: "policies",
      header: t("admin.roles.colPolicies"),
      width: "8rem",
      cell: (role) => role.policyCount,
    },
  ];

  return (
    <>
      <DataList
        title={t("admin.roles.title")}
        rows={roles}
        getRowId={(role) => role.id}
        columns={columns}
        loading={isLoading}
        error={error}
        emptyText={t("admin.roles.empty")}
        search={{
          value: search,
          placeholder: t("admin.roles.searchPlaceholder"),
          onChange: setSearch,
        }}
        onRefresh={() => void refetch()}
        refreshing={isFetching}
        columnVisibilityKey="platform-ui.list.hiddenColumns.admin.roles"
        onRowClick={(role) => setOpenRole(role.name)}
        toolbar={<Button onClick={() => setCreating(true)}>{t("admin.roles.add")}</Button>}
        paging={{
          page: 1,
          pageSize: Math.max(roles.length, 1),
          total: roles.length,
          onPageChange: () => {},
        }}
      />
      <CreateRoleDialog open={creating} onOpenChange={setCreating} onCreated={setOpenRole} />
      <Sheet open={openRole !== null} onOpenChange={(open) => !open && setOpenRole(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-4xl">
          <SheetHeader>
            <SheetTitle>{t("admin.roles.detailTitle")}</SheetTitle>
          </SheetHeader>
          {openRole ? (
            <RoleDetail
              name={openRole}
              onClose={() => setOpenRole(null)}
              permissionGroups={permissionGroups}
              advancedHref={advancedHref}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Self-gated on the admin role, like `UsersAdminPage`: every field it calls is admin-only. */
export function RolesAdminPage(props: RolesAdminPageProps) {
  return (
    <AdminOnly>
      <RolesAdminPageContent {...props} />
    </AdminOnly>
  );
}
