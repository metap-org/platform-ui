import { useState } from "react";
import { Select, Tabs, TabsContent, TabsList, TabsTrigger } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useEntities } from "../metadata/useEntities";
import { useAdminPolicies } from "./adminApi";
import { isBasicShapedRow } from "./policyCondition";
import { PermissionMatrix } from "./policies/PermissionMatrix";
import { AdvancedPoliciesPanel } from "./policies/AdvancedPoliciesPanel";
import { PermissionSearch } from "./policies/PermissionSearch";
import { AdminOnly } from "../auth/AdminOnly";

/**
 * Thin orchestrator: an entity picker shared by both tabs, plus the RBAC "basic" matrix
 * (`PermissionMatrix`) and the ABAC "advanced" condition-based policies (`AdvancedPoliciesPanel`)
 * — the conceptual RBAC-vs-ABAC split the project owner asked for, mirroring how the backend
 * itself models one policy row as an optional `roles` gate plus an optional `condition` gate
 * (`crates/metap-permission/src/policy_store.rs`). Passes the whole `EntitySummary`, not just its
 * name, down to both children — they each need `entity.workflow`/`entity.fields` too.
 */
function PoliciesAdminPageContent() {
  const { t } = useTranslation();
  const { data: entities } = useEntities();
  const [entityName, setEntityName] = useState("");
  const entity = (entities ?? []).find((e) => e.name === entityName) ?? null;

  // Live count of non-matrix-shaped rows for the selected entity, so an admin looking at the
  // matrix always knows whether hidden advanced rules exist for it — never silently lost.
  const { data: policies } = useAdminPolicies(entity?.name, entity !== null);
  const advancedCount = entity ? (policies ?? []).filter((p) => !isBasicShapedRow(p)).length : 0;

  return (
    <div className="py-8">
      <h2 className="mb-4 text-xl font-semibold text-foreground">{t("admin.policies.title")}</h2>

      <PermissionSearch />

      <div className="mb-6 max-w-sm">
        <Select
          label={t("admin.policies.entity")}
          options={(entities ?? []).map((e) => ({ value: e.name, label: e.label }))}
          value={entityName || undefined}
          onValueChange={setEntityName}
          placeholder={t("admin.policies.entityPlaceholder")}
        />
      </div>

      {entity ? (
        <Tabs defaultValue="basic">
          <TabsList>
            <TabsTrigger value="basic">{t("admin.policies.basicTab")}</TabsTrigger>
            <TabsTrigger value="advanced">
              {t("admin.policies.advancedTab", { count: advancedCount })}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="basic">
            <PermissionMatrix entity={entity} />
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

/** Self-gated on the `admin` role rather than trusting every consumer to gate the route: the
 * `PoliciesAdminPageContent` body below fires `/admin/*` requests from its very first render, so an
 * ungated non-admin would otherwise watch the page assemble itself and then fill with 403 alerts.
 * `AdminOnly` keeps that body unmounted entirely until roles resolve and pass
 * (`docs/audits/02-auth-permission-workflow-diagram-audit.md` finding B6). */
export function PoliciesAdminPage() {
  return (
    <AdminOnly>
      <PoliciesAdminPageContent />
    </AdminOnly>
  );
}
