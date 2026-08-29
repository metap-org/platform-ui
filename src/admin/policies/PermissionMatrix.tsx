import { Fragment, useEffect, useRef, useState } from "react";
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
  useAdminPolicies,
  useAdminRoleActions,
  useAdminUsers,
  useKnownActions,
  useSyncMatrixPolicies,
} from "../adminApi";
import { ApiErrorMessage } from "../../api/ApiErrorMessage";
import {
  EVERYONE_ROLE,
  checkedCountForAction,
  checkedCountForRole,
  collectKnownRoles,
  initialDesiredCells,
  isChecked,
  permissionLabel,
  setsEqual,
  toGrants,
  toggleCell,
  toggleColumn,
  toggleRow,
} from "./policyMatrixHelpers";

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
  const { data: users, refetch: refetchUsers } = useAdminUsers();
  const { data: actions } = useKnownActions();
  const syncMatrix = useSyncMatrixPolicies();
  const { assignRole, revokeRole } = useAdminRoleActions();

  const [manualRoles, setManualRoles] = useState<string[]>([]);
  const [newRole, setNewRole] = useState("");
  const [baseline, setBaseline] = useState<Set<string>>(new Set());
  const [desired, setDesired] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [newUserId, setNewUserId] = useState("");
  const [userActionError, setUserActionError] = useState<string | null>(null);
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!policies) return;
    if (seededFor.current === entity.name) return;
    const next = initialDesiredCells(policies);
    setBaseline(next);
    setDesired(next);
    seededFor.current = entity.name;
  }, [policies, entity.name]);

  const dirty = !setsEqual(desired, baseline);

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

  async function handleAssignUser(role: string) {
    const userId = newUserId.trim();
    if (!userId) return;
    setUserActionError(null);
    try {
      await assignRole(userId, role);
      setNewUserId("");
      await refetchUsers();
    } catch (err) {
      setUserActionError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  async function handleRevokeUser(userId: string, role: string) {
    setUserActionError(null);
    try {
      await revokeRole(userId, role);
      await refetchUsers();
    } catch (err) {
      setUserActionError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  if (isLoading) return <Spinner />;
  if (error) return <ApiErrorMessage error={error} />;

  const knownRoles = collectKnownRoles(users ?? [], policies ?? [], manualRoles);
  const roles = [EVERYONE_ROLE, ...knownRoles];
  const actionList = actions ?? [];
  const hasWorkflow = Boolean(entity.workflow);

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
        <Button onClick={() => void handleSave()} disabled={!dirty || syncMatrix.isPending}>
          {syncMatrix.isPending ? <Spinner size="sm" className="mr-2" /> : null}
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
                  onCheckedChange={(checked) =>
                    setDesired((prev) => toggleColumn(prev, action, roles, checked))
                  }
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
          {roles.map((role) => {
            const count = checkedCountForRole(desired, role, actionList);
            const usersForRole = (users ?? []).filter((u) => u.roles.includes(role));
            return (
              <Fragment key={role}>
                <TableRow>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Checkbox
                        checked={count === actionList.length && actionList.length > 0}
                        indeterminate={count > 0 && count < actionList.length}
                        onCheckedChange={(checked) =>
                          setDesired((prev) => toggleRow(prev, role, actionList, checked))
                        }
                        label={role === EVERYONE_ROLE ? t("admin.policies.matrix.everyone") : role}
                      />
                      {role !== EVERYONE_ROLE ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setUserActionError(null);
                            setExpandedRole((prev) => (prev === role ? null : role));
                          }}
                        >
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
                          checked={isChecked(desired, role, action)}
                          onCheckedChange={(checked) =>
                            setDesired((prev) => toggleCell(prev, role, action, checked))
                          }
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
                {expandedRole === role ? (
                  <TableRow>
                    <TableCell colSpan={1 + actionList.length}>
                      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                        {userActionError ? (
                          <p className="text-sm text-destructive">{userActionError}</p>
                        ) : null}
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
                                  onClick={() => void handleRevokeUser(u.userId, role)}
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
                                void handleAssignUser(role);
                              }
                            }}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleAssignUser(role)}
                            disabled={newUserId.trim().length === 0}
                          >
                            {t("admin.policies.matrix.assignUser")}
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
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
