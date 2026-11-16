import { Spinner } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../../api/ApiErrorMessage";
import type { EntitySummary } from "../../metadata/types";
import { useNavigationAdapter } from "../../navigation/NavigationContext";
import { useAdminPolicies } from "../adminApi";
import { isBasicShapedRow } from "../policyCondition";
import {
  BASE_ACTIONS,
  TRANSITION,
  transitionAction,
  workflowActions,
} from "./rolePermissionsModel";
import { policiesRoleHref } from "./policyLinks";

const EVERYONE = "";

/** Who may do what on one entity (roadmap 114): a read-only view of its basic grants, one row per
 *  role. Permissions are edited per role (`RolePermissionsEditor`); each role links to its editor. */
export function EntityAccessView({
  entity,
  roleHref = policiesRoleHref,
}: {
  entity: EntitySummary;
  roleHref?: (role: string) => string;
}) {
  const { t } = useTranslation();
  const nav = useNavigationAdapter();
  const { data: policies, isLoading, error } = useAdminPolicies(entity.name, true);
  const flows = workflowActions(entity);

  if (isLoading) return <Spinner />;
  if (error) return <ApiErrorMessage error={error} />;

  const byRole = new Map<string, Set<string>>();
  for (const p of (policies ?? []).filter(isBasicShapedRow)) {
    for (const role of p.roles && p.roles.length > 0 ? p.roles : [EVERYONE]) {
      byRole.set(role, (byRole.get(role) ?? new Set()).add(p.action));
    }
  }
  const roles = [...byRole.keys()].sort((a, b) =>
    a === EVERYONE ? -1 : b === EVERYONE ? 1 : a.localeCompare(b),
  );

  const workflowCell = (actions: Set<string>) => {
    if (!entity.workflow) return "–";
    if (actions.has(TRANSITION)) return "✓";
    const n = flows.filter((w) => actions.has(transitionAction(w.action))).length;
    return n === 0 ? "" : `${n}/${flows.length}`;
  };

  return (
    <div className="flex flex-col gap-2 pt-2">
      <p className="text-sm text-muted-foreground">{t("admin.rolePermissions.entityViewHint")}</p>
      {roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("admin.rolePermissions.entityViewEmpty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left">{t("admin.policies.matrix.role")}</th>
                {BASE_ACTIONS.map((a) => (
                  <th key={a} className="px-3 py-2 text-center">
                    {t(`admin.rolePermissions.action_${a}`)}
                  </th>
                ))}
                <th className="px-3 py-2 text-center">
                  {t("admin.rolePermissions.action_transition")}
                </th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const actions = byRole.get(role) ?? new Set<string>();
                return (
                  <tr key={role || "everyone"} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-1.5">
                      {role === EVERYONE ? (
                        <span className="text-muted-foreground">
                          {t("admin.policies.matrix.everyone")}
                        </span>
                      ) : (
                        <nav.Link
                          to={roleHref(role)}
                          className="font-medium text-primary hover:underline"
                        >
                          {role}
                        </nav.Link>
                      )}
                    </td>
                    {BASE_ACTIONS.map((a) => (
                      <td key={a} className="px-3 py-1.5 text-center">
                        {actions.has(a) ? "✓" : ""}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-center text-muted-foreground">
                      {workflowCell(actions)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
