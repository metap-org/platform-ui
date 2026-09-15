import type { ReactNode } from "react";
import { Spinner } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { useEntityLabels } from "../i18n/useEntityLabels";
import { useTenantUsers } from "../auth/useTenantUsers";
import { useAuditEvents, type AuditTrailEntryDto } from "./useAuditEvents";

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

const AUDIT_ACTION_KEY: Record<AuditTrailEntryDto["action"], string> = {
  create: "detail.auditActionCreate",
  update: "detail.auditActionUpdate",
  delete: "detail.auditActionDelete",
  transition: "detail.auditActionTransition",
};

/**
 * Pure rendering of an already-fetched audit-entry list — split out of `AuditTrail` so a caller
 * that fans out across *several* records (a zone-centric hub combining its own history with every
 * DdosPolicy/FirewallRule/... it owns, via `useAuditEventsForRecords`) can render one merged feed
 * with this same list markup, instead of one `AuditTrail` block per record. `fieldLabel` defaults
 * to the raw field name (no translation) since a merged multi-entity feed has no single entity to
 * resolve labels against; `AuditTrail` below passes a real per-entity resolver. `renderBadge` is
 * how a multi-entity caller marks which entity/record each entry belongs to — omitted for the
 * common single-record case, where every entry is obviously about the same record.
 */
export function AuditTrailList({
  events,
  fieldLabel = (field) => field,
  renderBadge,
}: {
  events: AuditTrailEntryDto[];
  fieldLabel?: (field: string, entry: AuditTrailEntryDto) => string;
  renderBadge?: (entry: AuditTrailEntryDto) => ReactNode;
}) {
  const { t } = useTranslation();
  const users = useTenantUsers();

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("detail.auditEmpty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => {
        const actorEmail = event.actorUserId
          ? (users.find((u) => u.id === event.actorUserId)?.email ?? event.actorUserId)
          : null;
        const changedFields = Object.entries(event.diff);
        return (
          <li
            key={event.id}
            className="flex flex-col gap-1 border-b border-border pb-3 last:border-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                {renderBadge?.(event)}
                {t(AUDIT_ACTION_KEY[event.action])}
                {event.transitionAction ? ` (${event.transitionAction})` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(event.occurredAt).toLocaleString()}
                {actorEmail ? ` · ${t("detail.auditBy", { actor: actorEmail })}` : ""}
              </span>
            </div>
            {changedFields.length > 0 ? (
              <ul className="flex flex-col gap-0.5 pl-3">
                {changedFields.map(([field, { before, after }]) => (
                  <li key={field} className="text-xs text-muted-foreground">
                    {t("detail.auditFieldChange", {
                      field: fieldLabel(field, event),
                      before: formatDiffValue(before),
                      after: formatDiffValue(after),
                    })}
                  </li>
                ))}
              </ul>
            ) : null}
            {event.reason ? (
              <p className="pl-3 text-xs text-muted-foreground">
                {t("detail.auditReason", { reason: event.reason })}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Full create/update/delete/transition history for one record (`metap-audit`, `GET
 * /api/{entity}/{id}/audit-events`) — a standalone, composable building block, not tied to
 * `RecordDetail`'s tab layout. `RecordDetail` uses this directly for any entity whose generic
 * detail page it renders; a host app with its own custom, hand-built detail screen (zone-centric
 * hubs, incident pages, ...) imports this the same way to add an audit tab/section to a record it
 * already has the id for, without reimplementing the fetch/render logic. Only mount this when the
 * entity is actually known to have opted in (`entity.audit?.enabled`, from `useEntity`) — it does
 * not check that itself, since a host page already has that entity metadata loaded for other
 * reasons and re-fetching it here would be redundant.
 *
 * For a hub record that also wants its *owned* child records' history merged into one feed (not
 * just this one record's own), fetch with `useAuditEventsForRecords` instead and render the
 * result with `AuditTrailList` directly — this component only ever covers a single (entity, id).
 */
export function AuditTrail({
  entityName,
  recordId,
}: {
  entityName: string;
  recordId: string;
}) {
  const { fieldLabel } = useEntityLabels(entityName);
  const { data: events, isLoading, error } = useAuditEvents(entityName, recordId, true);

  if (isLoading) {
    return <Spinner size="sm" />;
  }
  if (error) {
    return <ApiErrorMessage error={error} />;
  }

  return (
    <AuditTrailList events={events ?? []} fieldLabel={(field) => fieldLabel(field, field)} />
  );
}
