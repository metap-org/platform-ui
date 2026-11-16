import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { relativeTime } from "../lib/dates";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { useEntityLabels } from "../i18n/useEntityLabels";
import { useTenantUsers } from "../auth/useTenantUsers";
import { useLocale } from "../i18n/LocaleProvider";
import { useAuditFeed, type AuditFeedFilters, type AuditTrailEntryDto } from "./useAuditEvents";

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

const ACTION_TONE: Record<
  AuditTrailEntryDto["action"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  create: "default",
  update: "secondary",
  delete: "destructive",
  transition: "outline",
};

const ALL = "all";

/**
 * A record's audit history as a compact, filterable table — one ~36px row per entry (time,
 * actor, action, object, changed fields), a click opens that entry's field-by-field diff, and
 * history loads one server page at a time ("Load more", keyset cursor). With `includeChildren`
 * the record's children (entities whose `audit.parent` points at it, e.g. a zone's rules) are in
 * the same feed, deleted ones included, with an object column and filter. Permission and field
 * masking are the server's: rows and diff keys the caller may not see never arrive.
 *
 * `objectLabel` names an entry's entity in the object column (default: the entity name), and
 * `fieldLabel` a field in a diff (default: the record entity's field labels, raw names for
 * children).
 */
export function AuditLog({
  entityName,
  recordId,
  includeChildren = false,
  objectLabel = (entry) => entry.entity,
  fieldLabel,
  pageSize = 50,
}: {
  entityName: string;
  recordId: string;
  includeChildren?: boolean;
  objectLabel?: (entry: AuditTrailEntryDto) => string;
  fieldLabel?: (field: string, entry: AuditTrailEntryDto) => string;
  pageSize?: number;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const users = useTenantUsers();
  const labels = useEntityLabels(entityName);
  const [action, setAction] = useState<string>(ALL);
  const [actor, setActor] = useState<string>(ALL);
  const [object, setObject] = useState<string>(ALL);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const filters = useMemo<AuditFeedFilters>(
    () => ({
      includeChildren,
      actions: action === ALL ? undefined : [action as AuditTrailEntryDto["action"]],
      actorUserId: actor === ALL ? undefined : actor,
      entities: object === ALL ? undefined : [object],
    }),
    [includeChildren, action, actor, object],
  );
  const feed = useAuditFeed(entityName, recordId, filters, true, pageSize);
  const events = useMemo(() => feed.data?.pages.flatMap((page) => page.data) ?? [], [feed.data]);

  // Object filter options: the record's own entity, every entity on the loaded rows, and the one
  // currently filtered on (so the filter always shows its own value; pick "all" to see others).
  const objectOptions = useMemo(() => {
    const map = new Map<string, string>([[entityName, entityName]]);
    for (const event of events) {
      if (!map.has(event.entity)) map.set(event.entity, objectLabel(event));
    }
    if (object !== ALL && !map.has(object)) map.set(object, object);
    return [...map].map(([value, label]) => ({ value, label }));
  }, [entityName, events, object, objectLabel]);

  const labelOf = (field: string, entry: AuditTrailEntryDto) =>
    fieldLabel
      ? fieldLabel(field, entry)
      : entry.entity === entityName
        ? labels.fieldLabel(field, field)
        : field;
  const actorOf = (entry: AuditTrailEntryDto) =>
    entry.actorUserId
      ? (users.find((u) => u.id === entry.actorUserId)?.email ?? entry.actorUserId)
      : t("detail.auditSystemActor");

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const columnCount = includeChildren ? 5 : 4;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="h-8 w-44 text-xs"
          aria-label={t("detail.auditColAction")}
          value={action}
          onValueChange={(value) => setAction(value ?? ALL)}
          options={[
            { value: ALL, label: t("detail.auditAllActions") },
            ...(Object.keys(AUDIT_ACTION_KEY) as AuditTrailEntryDto["action"][]).map((a) => ({
              value: a,
              label: t(AUDIT_ACTION_KEY[a]),
            })),
          ]}
        />
        <Select
          className="h-8 w-56 text-xs"
          aria-label={t("detail.auditColActor")}
          value={actor}
          onValueChange={(value) => setActor(value ?? ALL)}
          options={[
            { value: ALL, label: t("detail.auditAllActors") },
            ...users.map((u) => ({ value: u.id, label: u.email ?? u.id })),
          ]}
        />
        {includeChildren ? (
          <Select
            className="h-8 w-48 text-xs"
            aria-label={t("detail.auditColObject")}
            value={object}
            onValueChange={(value) => setObject(value ?? ALL)}
            options={[{ value: ALL, label: t("detail.auditAllObjects") }, ...objectOptions]}
          />
        ) : null}
        {feed.isFetching && !feed.isFetchingNextPage ? <Spinner size="sm" /> : null}
      </div>

      {feed.error ? (
        <ApiErrorMessage error={feed.error} />
      ) : feed.isLoading ? (
        <Spinner size="sm" />
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("detail.auditEmpty")}</p>
      ) : (
        <div className="rounded-md border border-border">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 w-36 px-3">{t("detail.auditColTime")}</TableHead>
                <TableHead className="h-8 w-52 px-3">{t("detail.auditColActor")}</TableHead>
                <TableHead className="h-8 w-32 px-3">{t("detail.auditColAction")}</TableHead>
                {includeChildren ? (
                  <TableHead className="h-8 w-48 px-3">{t("detail.auditColObject")}</TableHead>
                ) : null}
                <TableHead className="h-8 px-3">{t("detail.auditColChanges")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((entry) => {
                const changes = Object.entries(entry.diff);
                const open = expanded.has(entry.id);
                const canOpen = changes.length > 0 || Boolean(entry.reason);
                return (
                  <Fragment key={entry.id}>
                    <TableRow
                      className={canOpen ? "cursor-pointer" : undefined}
                      onClick={canOpen ? () => toggle(entry.id) : undefined}
                      aria-expanded={canOpen ? open : undefined}
                    >
                      <TableCell
                        className="whitespace-nowrap px-3 py-1.5 text-muted-foreground"
                        title={new Date(entry.occurredAt).toLocaleString(locale)}
                      >
                        {relativeTime(entry.occurredAt, locale)}
                      </TableCell>
                      <TableCell className="max-w-[13rem] truncate px-3 py-1.5">
                        {actorOf(entry)}
                      </TableCell>
                      <TableCell className="px-3 py-1.5">
                        <Badge variant={ACTION_TONE[entry.action]} className="font-normal">
                          {t(AUDIT_ACTION_KEY[entry.action])}
                          {entry.transitionAction ? ` · ${entry.transitionAction}` : ""}
                        </Badge>
                      </TableCell>
                      {includeChildren ? (
                        <TableCell className="px-3 py-1.5">
                          <span className="flex items-center gap-1.5">
                            <Badge variant="outline" className="font-normal">
                              {objectLabel(entry)}
                            </Badge>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {entry.recordId.slice(0, 8)}
                            </span>
                          </span>
                        </TableCell>
                      ) : null}
                      <TableCell className="max-w-0 px-3 py-1.5">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-muted-foreground">
                            {changes.length > 0
                              ? changes.map(([field]) => labelOf(field, entry)).join(", ")
                              : t("detail.auditNoFieldChanges")}
                          </span>
                          {changes.length > 0 ? (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {t("detail.auditFieldsChanged", { count: changes.length })}
                            </span>
                          ) : null}
                          {canOpen ? (
                            <span aria-hidden className="ml-auto shrink-0 text-muted-foreground">
                              {open ? "▾" : "▸"}
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                    </TableRow>
                    {open ? (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={columnCount} className="px-3 py-2">
                          {entry.reason ? (
                            <p className="mb-1 text-muted-foreground">
                              {t("detail.auditReason", { reason: entry.reason })}
                            </p>
                          ) : null}
                          {changes.length > 0 ? (
                            <div className="grid grid-cols-[minmax(8rem,auto)_1fr_1fr] gap-x-4 gap-y-0.5">
                              <span className="font-medium text-muted-foreground">
                                {t("detail.auditField")}
                              </span>
                              <span className="font-medium text-muted-foreground">
                                {t("detail.auditBefore")}
                              </span>
                              <span className="font-medium text-muted-foreground">
                                {t("detail.auditAfter")}
                              </span>
                              {changes.map(([field, { before, after }]) => (
                                <Fragment key={field}>
                                  <span>{labelOf(field, entry)}</span>
                                  <span className="break-all font-mono text-[11px] text-muted-foreground">
                                    {formatDiffValue(before)}
                                  </span>
                                  <span className="break-all font-mono text-[11px]">
                                    {formatDiffValue(after)}
                                  </span>
                                </Fragment>
                              ))}
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {events.length > 0 ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("detail.auditShown", { count: events.length })}</span>
          {feed.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              loading={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
            >
              {t("detail.auditLoadMore")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Full create/update/delete/transition history for one record — the paged, filterable
 * `AuditLog` for that record alone. A standalone, composable building block, not tied to
 * `RecordDetail`'s tab layout: `RecordDetail` uses it for any entity whose generic detail page it
 * renders, and a host app with its own detail screen imports it the same way. Only mount this when
 * the entity is actually known to have opted in (`entity.audit?.enabled`, from `useEntity`) — it
 * does not check that itself. For a record that owns others (a zone and its rules), use
 * `AuditLog` with `includeChildren`.
 */
export function AuditTrail({ entityName, recordId }: { entityName: string; recordId: string }) {
  return <AuditLog entityName={entityName} recordId={recordId} />;
}
