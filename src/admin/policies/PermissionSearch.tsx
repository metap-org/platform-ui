import { useState } from "react";
import {
  Badge,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useEntities } from "../../metadata/useEntities";
import { ApiErrorMessage } from "../../api/ApiErrorMessage";
import { useAdminPolicies } from "../adminApi";
import { isBasicShapedRow } from "../policyCondition";
import { permissionLabel } from "./policyMatrixHelpers";

/**
 * Cross-entity permission search — "what can role X do, and where" — independent of
 * `PoliciesAdminPage`'s entity picker/tabs (which are always scoped to one entity at a time).
 * Only fetches the tenant-wide policy list (`useAdminPolicies()` with no entity filter) once the
 * search box is non-empty, since that's a strictly larger request than any single-entity one
 * `PermissionMatrix`/`AdvancedPoliciesPanel` already make.
 */
export function PermissionSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const { data: entities } = useEntities();
  const { data: policies, isLoading, error } = useAdminPolicies(undefined, trimmed.length > 0);

  const entityLabels = new Map((entities ?? []).map((e) => [e.name, e.label]));

  const results = (policies ?? []).filter((p) => {
    if (trimmed.length === 0) return false;
    const needle = trimmed.toLowerCase();
    const label = permissionLabel(p.entity, p.action).toLowerCase();
    const entityLabel = (entityLabels.get(p.entity) ?? "").toLowerCase();
    return (
      label.includes(needle) ||
      p.entity.toLowerCase().includes(needle) ||
      entityLabel.includes(needle) ||
      p.action.toLowerCase().includes(needle) ||
      (p.roles ?? []).some((r) => r.toLowerCase().includes(needle))
    );
  });

  return (
    <div className="mb-6 flex flex-col gap-2">
      <Input
        label={t("admin.policies.search.label")}
        placeholder={t("admin.policies.search.placeholder")}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      {trimmed.length === 0 ? null : isLoading ? (
        <Spinner size="sm" />
      ) : error ? (
        <ApiErrorMessage error={error} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.policies.entity")}</TableHead>
              <TableHead>{t("admin.policies.search.permission")}</TableHead>
              <TableHead>{t("admin.policies.action")}</TableHead>
              <TableHead>{t("admin.users.rolesLabel")}</TableHead>
              <TableHead>{t("admin.policies.search.kind")}</TableHead>
              <TableHead>{t("admin.policies.effect")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>{t("admin.policies.search.noResults")}</TableCell>
              </TableRow>
            ) : (
              results.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{entityLabels.get(p.entity) ?? p.entity}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {permissionLabel(p.entity, p.action)}
                  </TableCell>
                  <TableCell>{p.action}</TableCell>
                  <TableCell>
                    {(p.roles ?? []).join(", ") || t("admin.policies.matrix.everyone")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {isBasicShapedRow(p)
                        ? t("admin.policies.basicTab")
                        : t("admin.policies.advancedTabShort")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.effect === "deny" ? "destructive" : "secondary"}>
                      {p.effect}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
