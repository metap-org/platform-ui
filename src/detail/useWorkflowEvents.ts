import { useApiQuery } from "../api/useApiQuery";

/** Wire shape is snake_case — unlike every other JSON surface `@metap/platform-ui` consumes.
 *  Deliberate, documented exception: `crates/metap-http/src/routes/workflow_events.rs`'s own
 *  `WorkflowEvent` still serializes its Rust field names verbatim, because
 *  `../metap-demo-jira/web/src/pages/SprintReportPage.tsx` is a real, already-shipped consumer of
 *  this exact route reading these exact keys — camelCasing it here would mean the backend and
 *  this new caller disagree, not fix an inconsistency. See that route's own top-of-file note
 *  (`docs/features/20-record-detail-audit-trail-and-tabs.md`). */
export type WorkflowEventDto = {
  id: string;
  entity: string;
  record_id: string;
  action: string;
  from_state: string;
  to_state: string;
  actor: string | null;
  created_at: string;
};

type WorkflowEventsResponse = { data: WorkflowEventDto[] };

/** Transition history for one record — `GET /api/{entity}/{id}/workflow-events`
 *  (`crates/metap-http/src/routes/workflow_events.rs`). `enabled` should be `false` for an entity
 *  with no workflow configured at all (no `stateField`), so `RecordDetail`'s "History" tab never
 *  fires this request for a non-workflow entity. Backend returns rows oldest-first; reversed here
 *  so the tab reads newest-first, the natural order for "what just happened to this record". */
export function useWorkflowEvents(entityName: string, recordId: string, enabled: boolean) {
  const { data, ...rest } = useApiQuery<WorkflowEventsResponse, WorkflowEventDto[]>(
    ["workflow-events", entityName, recordId],
    `/api/${entityName}/${recordId}/workflow-events`,
    (response) => response.data,
    enabled,
  );
  return { data: data ? [...data].reverse() : data, ...rest };
}
