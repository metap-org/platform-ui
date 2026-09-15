import { useQueries } from "@tanstack/react-query";
import { useApiQuery } from "../api/useApiQuery";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../api/client";

/** Wire shape is camelCase — `crates/metap-audit/src/entry.rs`'s `AuditTrailEntryRow` derives
 *  `#[serde(rename_all = "camelCase")]`, matching the rest of this crate's JSON surfaces (unlike
 *  `WorkflowEventDto`, which stays snake_case for an existing consumer — see that type's own
 *  comment; this route has no such consumer to preserve). `diff` is `{field: {before, after}}`,
 *  changed keys only — empty for a `delete` entry, since there is no "after" to diff against. */
export type AuditTrailEntryDto = {
  id: string;
  tenantId: string;
  entity: string;
  recordId: string;
  action: "create" | "update" | "delete" | "transition";
  transitionAction: string | null;
  actorUserId: string | null;
  reason: string | null;
  diff: Record<string, { before: unknown; after: unknown }>;
  versionAfter: number | null;
  occurredAt: string;
};

type AuditEventsResponse = { data: AuditTrailEntryDto[] };

/** Create/update/delete/transition history for one record — `GET
 *  /api/{entity}/{id}/audit-events` (`crates/metap-http/src/routes/audit_events.rs`). Distinct
 *  from `useWorkflowEvents` (state-machine transitions only) — `enabled` should be `false` unless
 *  `entity.audit?.enabled` is true, so `RecordDetail`'s "Audit" tab never fires this request for
 *  an entity that never opted into the audit trail. Backend already returns newest-first
 *  (`ORDER BY occurred_at DESC`), unlike `useWorkflowEvents`, so no client-side reverse needed. */
export function useAuditEvents(entityName: string, recordId: string, enabled: boolean) {
  return useApiQuery<AuditEventsResponse, AuditTrailEntryDto[]>(
    ["audit-events", entityName, recordId],
    `/api/${entityName}/${recordId}/audit-events`,
    (response) => response.data,
    enabled,
  );
}

/**
 * Merged, newest-first audit history across several records at once — the cross-entity aggregate
 * a "hub record + everything it owns" custom screen needs (e.g. a zone's own history plus every
 * DdosPolicy/FirewallRule/... that references it), where the exact set of child records is only
 * known at render time. `useAuditEvents` is a fixed one-hook-per-record shape and can't be called
 * in a loop for a dynamic list, so this fans out via `useQueries` instead of `useApiQuery` —
 * same query key shape (`["audit-events", entityName, recordId]`) as `useAuditEvents` uses for a
 * single record, so a record fetched both ways shares one cache entry, not two.
 *
 * Each returned entry already carries its own `entity` field (from the wire shape), so the caller
 * can label/badge/link it per source without this hook needing any business-entity knowledge of
 * its own — it only ever sees "a list of (entity, id) pairs".
 */
export function useAuditEventsForRecords(
  records: { entityName: string; recordId: string }[],
  enabled: boolean,
) {
  const { status } = useAuth();
  const results = useQueries({
    queries: records.map(({ entityName, recordId }) => ({
      queryKey: ["audit-events", entityName, recordId],
      queryFn: () => apiFetch<AuditEventsResponse>(`/api/${entityName}/${recordId}/audit-events`),
      enabled: status === "authenticated" && enabled,
    })),
  });

  const isLoading = enabled && results.some((r) => r.isLoading);
  const error = results.find((r) => r.error)?.error ?? null;
  const data = results.every((r) => r.data)
    ? results
        .flatMap((r) => r.data?.data ?? [])
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    : undefined;

  return { data, isLoading, error };
}
