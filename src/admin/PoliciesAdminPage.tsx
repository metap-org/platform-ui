import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Input, Select, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useEntities } from "../metadata/useEntities";
import { useAdminPolicies } from "./adminApi";
import { isBasicShapedRow } from "./policyCondition";
import { EntityAccessView } from "./policies/EntityAccessView";
import { AdvancedPoliciesPanel } from "./policies/AdvancedPoliciesPanel";
import { PermissionSearch } from "./policies/PermissionSearch";
import {
  RolePermissionsEditor,
  type RolePermissionsEditorProps,
} from "./policies/RolePermissionsEditor";
import { roleDisplayName, useRoles } from "./userAdminApi";
import { policiesEntityHref, policiesRoleHref } from "./policies/policyLinks";
import { AdminOnly } from "../auth/AdminOnly";

export type PoliciesAdminPageProps = {
  /** Sections of the role editor (e.g. product modules); default: the entity namespace. */
  permissionGroups?: RolePermissionsEditorProps["groupFor"];
};

type View = "roles" | "entity";

/** "By role" (roadmap 114): the role list on the left, the selected role's permissions on every
 *  entity on the right — the same editor as a role's Permissions tab. */
function RolesView({
  role,
  onSelect,
  permissionGroups,
}: {
  role: string | null;
  onSelect: (role: string) => void;
  permissionGroups?: PoliciesAdminPageProps["permissionGroups"];
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 250);
  const { data: roles, isLoading, error } = useRoles(debounced);
  const selected = (roles ?? []).find((r) => r.name === role) ?? null;

  return (
    <div className="grid gap-4 pt-2 md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-2">
        <Input
          type="search"
          className="h-8"
          aria-label={t("admin.roles.searchPlaceholder")}
          placeholder={t("admin.roles.searchPlaceholder")}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <ApiErrorMessage error={error} />
        ) : (
          <ul className="flex max-h-[calc(100vh-260px)] flex-col overflow-auto rounded-md border border-border">
            {(roles ?? []).map((r) => (
              <li key={r.name} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  aria-current={r.name === role ? "true" : undefined}
                  onClick={() => onSelect(r.name)}
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/40${r.name === role ? " bg-primary/10" : ""}`}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className="truncate font-medium">{roleDisplayName(r)}</span>
                    {r.builtin ? (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                        {t("admin.roles.builtin")}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.label ? `${r.name} · ` : ""}
                    {t("admin.roles.policyCount", { count: r.policyCount })} ·{" "}
                    {t("admin.roles.memberCount", { count: r.userCount })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="min-w-0">
        {selected ? (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-base font-semibold">{roleDisplayName(selected)}</h3>
              {selected.label ? (
                <code className="text-xs text-muted-foreground">{selected.name}</code>
              ) : null}
            </div>
            {selected.description ? (
              <p className="text-sm text-muted-foreground">{selected.description}</p>
            ) : null}
            <RolePermissionsEditor
              key={selected.name}
              role={selected}
              groupFor={permissionGroups}
              advancedHref={(entity) => policiesEntityHref(entity, "advanced")}
            />
          </>
        ) : (
          <p className="pt-2 text-sm text-muted-foreground">
            {t("admin.policies.selectRoleFirst")}
          </p>
        )}
      </section>
    </div>
  );
}

/** "By entity": who may do what on one entity (read-only, roles link back to the role view), plus
 *  that entity's advanced (conditional / field / deny) policies, which are edited here. */
function EntityView({
  entityName,
  tab,
  onEntity,
  onTab,
}: {
  entityName: string;
  tab: "basic" | "advanced";
  onEntity: (name: string) => void;
  onTab: (tab: "basic" | "advanced") => void;
}) {
  const { t } = useTranslation();
  const { data: entities } = useEntities();
  const entity = (entities ?? []).find((e) => e.name === entityName) ?? null;
  // Live count of advanced rows, so the tab always says whether any exist for the entity.
  const { data: policies } = useAdminPolicies(entity?.name, entity !== null);
  const advancedCount = entity ? (policies ?? []).filter((p) => !isBasicShapedRow(p)).length : 0;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PermissionSearch />
      <div className="max-w-sm">
        <Select
          label={t("admin.policies.entity")}
          options={(entities ?? []).map((e) => ({ value: e.name, label: e.label }))}
          value={entityName || undefined}
          onValueChange={onEntity}
          placeholder={t("admin.policies.entityPlaceholder")}
        />
      </div>
      {entity ? (
        <Tabs
          value={tab}
          onValueChange={(value) => onTab(value === "advanced" ? "advanced" : "basic")}
        >
          <TabsList>
            <TabsTrigger value="basic">{t("admin.policies.basicTab")}</TabsTrigger>
            <TabsTrigger value="advanced">
              {t("admin.policies.advancedTab", { count: advancedCount })}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="basic">
            <EntityAccessView entity={entity} roleHref={policiesRoleHref} />
          </TabsContent>
          <TabsContent value="advanced">
            <AdvancedPoliciesPanel entity={entity} />
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-sm text-muted-foreground">{t("admin.policies.selectEntityFirst")}</p>
      )}
    </div>
  );
}

/**
 * Permissions, two ways in (roadmap 114): **by role** — pick a role, edit what it may do on every
 * entity at once (`RolePermissionsEditor`) — and **by entity** — who may do what on one entity
 * (read-only) plus its advanced ABAC policies (`AdvancedPoliciesPanel`), mirroring how the backend
 * models a policy row as an optional `roles` gate plus an optional `condition` gate. The URL holds
 * the view and selection (`?view=roles&role=…`, `?view=entity&entity=…&tab=…`), so other screens
 * link straight in; an `?entity=` without a view opens the entity view.
 */
function PoliciesAdminPageContent({ permissionGroups }: PoliciesAdminPageProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: View =
    searchParams.get("view") === "entity" ||
    (!searchParams.get("view") && searchParams.get("entity"))
      ? "entity"
      : "roles";
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="flex flex-col gap-3 py-2">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        {t("admin.policies.title")}
      </h2>
      <Tabs value={view} onValueChange={(value) => update({ view: value })}>
        <TabsList>
          <TabsTrigger value="roles">{t("admin.policies.byRole")}</TabsTrigger>
          <TabsTrigger value="entity">{t("admin.policies.byEntity")}</TabsTrigger>
        </TabsList>
        {/* Kept mounted so an unsaved role edit survives a look at the entity view. */}
        <TabsContent value="roles" forceMount className="data-[state=inactive]:hidden">
          <RolesView
            role={searchParams.get("role")}
            onSelect={(role) => update({ role })}
            permissionGroups={permissionGroups}
          />
        </TabsContent>
        <TabsContent value="entity">
          <EntityView
            entityName={searchParams.get("entity") ?? ""}
            tab={searchParams.get("tab") === "advanced" ? "advanced" : "basic"}
            onEntity={(entity) => update({ entity })}
            onTab={(tab) => update({ tab })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Self-gated on the `admin` role rather than trusting every consumer to gate the route: the
 * content fires admin-only requests from its very first render, so an ungated non-admin would
 * otherwise watch the page assemble itself and then fill with 403 alerts. `AdminOnly` keeps it
 * unmounted until roles resolve and pass (`docs/audits/02-auth-permission-workflow-diagram-audit.md`
 * finding B6). */
export function PoliciesAdminPage(props: PoliciesAdminPageProps) {
  return (
    <AdminOnly>
      <PoliciesAdminPageContent {...props} />
    </AdminOnly>
  );
}
