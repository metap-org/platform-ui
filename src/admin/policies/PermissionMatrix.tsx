import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api/client";
import type { EntitySummary } from "../../metadata/types";
import {
  type AdminUser,
  useAdminPolicies,
  useAdminRoleActions,
  useAdminUsers,
  useKnownActions,
  useSyncMatrixPolicies,
} from "../adminApi";
import { ApiErrorMessage } from "../../api/ApiErrorMessage";
import {
  EMPTY_ACTION_SET,
  EVERYONE_ROLE,
  checkedCountForAction,
  collectKnownRoles,
  desiredEqual,
  type DesiredState,
  initialDesiredCells,
  permissionLabel,
  toGrants,
  toggleCell,
  toggleColumn,
  toggleRow,
} from "./policyMatrixHelpers";

const NO_USERS: AdminUser[] = [];

/** Isolated so a keystroke in "assign user" only re-renders the one expanded role's panel, not
 *  every row in the matrix — mounted fresh per expanded role (see `RoleRow` below), so its own
 *  `newUserId`/`userActionError` state naturally resets when the admin switches which role they
 *  have expanded, rather than leaking typed-but-unsubmitted text across roles as the previous
 *  shared-state version did. */
function RoleUsersPanel({
  role,
  usersForRole,
  onAssignUser,
  onRevokeUser,
}: {
  role: string;
  usersForRole: AdminUser[];
  onAssignUser: (userId: string) => Promise<void>;
  onRevokeUser: (userId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [newUserId, setNewUserId] = useState("");
  const [userActionError, setUserActionError] = useState<string | null>(null);

  async function handleAssign() {
    const userId = newUserId.trim();
    if (!userId) return;
    setUserActionError(null);
    try {
      await onAssignUser(userId);
      setNewUserId("");
    } catch (err) {
      setUserActionError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  async function handleRevoke(userId: string) {
    setUserActionError(null);
    try {
      await onRevokeUser(userId);
    } catch (err) {
      setUserActionError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      {userActionError ? <p className="text-sm text-destructive">{userActionError}</p> : null}
      <div className="flex flex-wrap items-center gap-1">
        {usersForRole.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("admin.policies.matrix.noUsersForRole")}
          </p>
        ) : (
          usersForRole.map((u) => (
            <Badge key={u.userId} variant="secondary" className="gap-1">
              {u.userId}
              <button
                type="button"
                aria-label={`Revoke ${role} from ${u.userId}`}
                onClick={() => void handleRevoke(u.userId)}
                className="text-xs leading-none"
              >
                ×
              </button>
            </Badge>
          ))
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          placeholder={t("admin.policies.matrix.userIdPlaceholder")}
          value={newUserId}
          onChange={(e) => setNewUserId(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAssign();
            }
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleAssign()}
          disabled={newUserId.trim().length === 0}
        >
          {t("admin.policies.matrix.assignUser")}
        </Button>
      </div>
    </div>
  );
}

/** One matrix row, `memo`-wrapped so toggling this role's checkboxes never re-renders any other
 *  role's row (audit `platform-ui/docs/audits/01-frontend-performance-audit.md`, finding #2). This
 *  only works because every prop is reference-stable unless something *this row* actually depends
 *  on changed: `checkedActions` is `desired.get(role)` — `toggleCell`/`toggleRow` replace only the
 *  touched role's `Set` (`policyMatrixHelpers.ts`), `usersForRole` comes from a `useMemo`'d
 *  per-role map in the parent, and every callback below is `useCallback`'d in the parent with
 *  stable deps. Same pattern as `LowCodeEntitiesAdminPage.tsx`'s `FieldRowEditor`. */
const RoleRow = memo(function RoleRow({
  role,
  actionList,
  hasWorkflow,
  checkedActions,
  usersForRole,
  expanded,
  onToggleCell,
  onToggleRow,
  onToggleExpand,
  onAssignUser,
  onRevokeUser,
}: {
  role: string;
  actionList: string[];
  hasWorkflow: boolean;
  checkedActions: ReadonlySet<string>;
  usersForRole: AdminUser[];
  expanded: boolean;
  onToggleCell: (role: string, action: string, checked: boolean) => void;
  onToggleRow: (role: string, actions: string[], checked: boolean) => void;
  onToggleExpand: (role: string) => void;
  onAssignUser: (role: string, userId: string) => Promise<void>;
  onRevokeUser: (role: string, userId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const count = actionList.filter((action) => checkedActions.has(action)).length;

  return (
    <>
      <TableRow>
        <TableCell>
          <div className="flex items-center gap-1">
            <Checkbox
              checked={count === actionList.length && actionList.length > 0}
              indeterminate={count > 0 && count < actionList.length}
              onCheckedChange={(checked) => onToggleRow(role, actionList, checked)}
              label={role === EVERYONE_ROLE ? t("admin.policies.matrix.everyone") : role}
            />
            {role !== EVERYONE_ROLE ? (
              <Button variant="ghost" size="sm" onClick={() => onToggleExpand(role)}>
                {t("admin.policies.matrix.usersCount", { count: usersForRole.length })}
              </Button>
            ) : null}
          </div>
        </TableCell>
        {actionList.map((action) => {
          const disabled = action === "transition" && !hasWorkflow;
          return (
            <TableCell key={action}>
              <Checkbox
                disabled={disabled}
                checked={checkedActions.has(action)}
                onCheckedChange={(checked) => onToggleCell(role, action, checked)}
              />
            </TableCell>
          );
        })}
      </TableRow>
      {expanded ? (
        <TableRow>
          <TableCell colSpan={1 + actionList.length}>
            <RoleUsersPanel
              role={role}
              usersForRole={usersForRole}
              onAssignUser={(userId) => onAssignUser(role, userId)}
              onRevokeUser={(userId) => onRevokeUser(role, userId)}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
});

/**
 * The RBAC "basic permissions" view — a role × action grid, edited entirely client-side (no
 * request fires per click) and committed with one `Save` button via `PUT /admin/policies/matrix`
 * (`useSyncMatrixPolicies`), which replaces the entire basic-shaped policy set for this entity in
 * a single atomic backend transaction. This replaced an earlier version that fired one
 * `POST`/`DELETE` per checkbox (plus an extra split call for a legacy shared-multi-role row) —
 * moving the "what does the final state look like" computation server-side turns an editing
 * session's worth of clicks into exactly one HTTP call, and the shared-row-splitting case simply
 * no longer exists (the backend always rewrites basic-shaped rows as one-role-per-row).
 *
 * Fetches independently of `AdvancedPoliciesPanel` (its sibling tab) but shares one cached
 * request: `useAdminPolicies` keys by `["admin","policies",entity]` through
 * `@tanstack/react-query`, so mounting both tabs' data hooks at once is not a double round-trip.
 *
 * Local edits are only re-seeded from the server once per entity (tracked via `seededFor`), not
 * on every background refetch — otherwise an unrelated refetch (e.g. React Query's
 * refetch-on-window-focus) could silently discard unsaved changes.
 */
export function PermissionMatrix({ entity }: { entity: EntitySummary }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: policies, isLoading, error } = useAdminPolicies(entity.name);
  const { data: users } = useAdminUsers();
  const { data: actions } = useKnownActions();
  const syncMatrix = useSyncMatrixPolicies();
  const { assignRole, revokeRole } = useAdminRoleActions();

  const [manualRoles, setManualRoles] = useState<string[]>([]);
  const [newRole, setNewRole] = useState("");
  const [baseline, setBaseline] = useState<DesiredState>(new Map());
  const [desired, setDesired] = useState<DesiredState>(new Map());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!policies) return;
    if (seededFor.current === entity.name) return;
    const next = initialDesiredCells(policies);
    setBaseline(next);
    setDesired(next);
    seededFor.current = entity.name;
  }, [policies, entity.name]);

  const dirty = !desiredEqual(desired, baseline);
  const actionList = useMemo(() => actions ?? [], [actions]);
  const hasWorkflow = Boolean(entity.workflow);

  const roles = useMemo(
    () => [EVERYONE_ROLE, ...collectKnownRoles(users ?? [], policies ?? [], manualRoles)],
    [users, policies, manualRoles],
  );

  const usersByRole = useMemo(() => {
    const map = new Map<string, AdminUser[]>();
    for (const role of roles) {
      map.set(
        role,
        (users ?? []).filter((u) => u.roles.includes(role)),
      );
    }
    return map;
  }, [users, roles]);

  const setCell = useCallback((role: string, action: string, checked: boolean) => {
    setDesired((prev) => toggleCell(prev, role, action, checked));
  }, []);

  const setRow = useCallback((role: string, actions: string[], checked: boolean) => {
    setDesired((prev) => toggleRow(prev, role, actions, checked));
  }, []);

  const setColumn = useCallback(
    (action: string, checked: boolean) => {
      setDesired((prev) => toggleColumn(prev, action, roles, checked));
    },
    [roles],
  );

  const toggleExpand = useCallback((role: string) => {
    setExpandedRole((prev) => (prev === role ? null : role));
  }, []);

  const handleAssignUser = useCallback(
    async (role: string, userId: string) => {
      await assignRole(userId, role);
    },
    [assignRole],
  );

  const handleRevokeUser = useCallback(
    async (role: string, userId: string) => {
      await revokeRole(userId, role);
    },
    [revokeRole],
  );

  async function handleSave() {
    setSaveError(null);
    try {
      await syncMatrix.mutateAsync({ entity: entity.name, grants: toGrants(desired) });
      setBaseline(desired);
      await queryClient.invalidateQueries({ queryKey: ["admin", "policies", entity.name] });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  function addRole() {
    const role = newRole.trim();
    if (role && role !== EVERYONE_ROLE && !manualRoles.includes(role)) {
      setManualRoles((prev) => [...prev, role]);
    }
    setNewRole("");
  }

  if (isLoading) return <Spinner />;
  if (error) return <ApiErrorMessage error={error} />;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {dirty ? (
          <p className="text-sm text-muted-foreground">
            {t("admin.policies.matrix.unsavedChanges")}
          </p>
        ) : (
          <span />
        )}
        <Button onClick={() => void handleSave()} disabled={!dirty} loading={syncMatrix.isPending}>
          {t("common.save")}
        </Button>
      </div>
      {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("admin.policies.matrix.role")}</TableHead>
            {actionList.map((action) => {
              const disabled = action === "transition" && !hasWorkflow;
              const count = checkedCountForAction(desired, action, roles);
              const head = (
                <Checkbox
                  disabled={disabled}
                  checked={count === roles.length && roles.length > 0}
                  indeterminate={count > 0 && count < roles.length}
                  onCheckedChange={(checked) => setColumn(action, checked)}
                  label={permissionLabel(entity.name, action)}
                />
              );
              return (
                <TableHead key={action} className={disabled ? "text-muted-foreground" : undefined}>
                  {disabled ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>{head}</span>
                      </TooltipTrigger>
                      <TooltipContent>{t("admin.policies.matrix.noWorkflow")}</TooltipContent>
                    </Tooltip>
                  ) : (
                    head
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => (
            <RoleRow
              key={role}
              role={role}
              actionList={actionList}
              hasWorkflow={hasWorkflow}
              checkedActions={desired.get(role) ?? EMPTY_ACTION_SET}
              usersForRole={usersByRole.get(role) ?? NO_USERS}
              expanded={expandedRole === role}
              onToggleCell={setCell}
              onToggleRow={setRow}
              onToggleExpand={toggleExpand}
              onAssignUser={handleAssignUser}
              onRevokeUser={handleRevokeUser}
            />
          ))}
          <TableRow>
            <TableCell colSpan={1 + actionList.length}>
              <div className="flex items-center gap-2">
                <Input
                  placeholder={t("admin.policies.matrix.addRolePlaceholder")}
                  value={newRole}
                  onChange={(e) => setNewRole(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRole();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addRole}
                  disabled={newRole.trim().length === 0}
                >
                  {t("admin.policies.matrix.addRole")}
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
