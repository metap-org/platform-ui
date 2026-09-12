import { Badge, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { useLowCodeAuditEvents, useLowCodeRecentAudit } from "./lowCodeControlPlane";
import type { LowCodeAuditAction } from "./lowCodeControlPlane";

const ACTION_BADGE_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive"> = {
  draft_saved: "secondary",
  published: "success",
  rolled_back: "warning",
  enabled: "success",
  disabled: "secondary",
  table_migrated: "warning",
};

/**
 * Audit feed table backed by the new `control-plane-graphql` gateway's `lowCodeAuditEvents(name)`
 * (per-entity, when `entityName` is passed) / `lowCodeRecentAudit(limit)` (cross-entity, the
 * default) — see `lowCodeControlPlane.ts`. No UI existed for either endpoint before this. One
 * component serves both shapes since they return the identical `LowCodeAuditEvent[]` — the only
 * difference is which query fires and whether an "Entity" column makes sense to show.
 */
export function LowCodeAuditFeed({
  gatewayUrl,
  authTokenUrl,
  entityName,
  limit,
}: {
  gatewayUrl: string;
  authTokenUrl: string;
  /** Per-entity feed when set; cross-entity "recent audit" feed otherwise. */
  entityName?: string;
  /** Only meaningful for the cross-entity feed — ignored (the REST endpoint has no `limit` param)
   *  when `entityName` is set. Server clamps to 200 regardless of what's passed. */
  limit?: number;
}) {
  const { t } = useTranslation();
  const perEntity = useLowCodeAuditEvents(entityName ?? null, gatewayUrl, authTokenUrl, !!entityName);
  const recent = useLowCodeRecentAudit(limit, gatewayUrl, authTokenUrl, !entityName);
  const { data: events, isLoading, error } = entityName ? perEntity : recent;

  if (isLoading) {
    return <Spinner size="sm" />;
  }
  if (error) {
    return <ApiErrorMessage error={error} />;
  }

  const rows = events ?? [];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {entityName ? null : <TableHead>{t("admin.lowcode.audit.entity")}</TableHead>}
          <TableHead>{t("admin.lowcode.audit.action")}</TableHead>
          <TableHead>{t("admin.lowcode.audit.actor")}</TableHead>
          <TableHead>{t("admin.lowcode.audit.version")}</TableHead>
          <TableHead>{t("admin.lowcode.audit.occurredAt")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={entityName ? 4 : 5}>{t("common.noRecords")}</TableCell>
          </TableRow>
        ) : (
          rows.map((event, index) => (
            // No stable id on the wire (audit events aren't individually addressable) — index is
            // fine here since this list is never reordered/mutated in place, only ever refetched
            // wholesale.
            // eslint-disable-next-line react/no-array-index-key
            <TableRow key={`${event.occurredAt}-${index}`}>
              {entityName ? null : <TableCell>{event.entityName}</TableCell>}
              <TableCell>
                <Badge variant={ACTION_BADGE_VARIANT[event.action as LowCodeAuditAction] ?? "secondary"}>
                  {t(`admin.lowcode.audit.actionLabel.${event.action}`, event.action)}
                </Badge>
              </TableCell>
              <TableCell>{event.actorUserId ?? "—"}</TableCell>
              <TableCell>
                {event.versionNumber ?? "—"}
                {event.restoredFromVersion !== null
                  ? t("admin.lowcode.audit.restoredFromSuffix", {
                      version: event.restoredFromVersion,
                    })
                  : ""}
              </TableCell>
              <TableCell>{event.occurredAt}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
