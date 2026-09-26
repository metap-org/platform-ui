import { useGraphQLRecord } from "../api/graphqlRecords";
import type { EntityField } from "../metadata/types";
import { useNavigationAdapter } from "../navigation/NavigationContext";

/**
 * `batchMode` (set by `FieldValue` whenever a caller passes any `relatedDisplay` map, i.e.
 * `GeneratedList`) skips the per-record fetch entirely and trusts `displayValue` — the backend
 * (`crates/metap-crud/src/crud_service.rs`'s `hydrate_related_display`) already batch-resolves
 * every reference column for a whole list page in one `WHERE id = ANY($1)` query per field, so
 * fetching again here per cell would silently reintroduce the exact N+1 that hydration exists to
 * avoid. A missing `displayValue` in batch mode (masked field, dangling reference, or the caller
 * lacks read permission on the related record) falls back to showing the raw id rather than
 * firing a request — the same "additive, never required" contract the backend doc comment
 * describes. Outside batch mode (`RecordDetail`'s single-record view, which has no page of rows
 * to batch across) this still fetches directly, exactly as before.
 *
 * `interactive` (from `FieldValue`'s `entityLayout.ts` lookup, default `true`) wraps the display
 * text in `navAdapter.Link` to the referenced record's own detail page — this field already knows
 * `refEntity`+`id`, so not linking it was a gap, not a deliberate choice. A dangling/masked
 * reference (no `id`, handled above) is never a link regardless of `interactive`.
 */
export function ReferenceFieldValue({
  field,
  value,
  displayValue,
  batchMode = false,
  interactive = true,
}: {
  field: EntityField;
  value: unknown;
  displayValue?: string;
  batchMode?: boolean;
  interactive?: boolean;
}) {
  const refEntity = field.refEntity;
  const id = typeof value === "string" ? value : undefined;
  const navAdapter = useNavigationAdapter();

  // `/api/${refEntity}/${id}` (REST) doesn't exist since Phase 90 removed REST entity CRUD —
  // found live 2026-09-26, this component was never migrated in Phase 93. `useGraphQLRecord`
  // fetches the same full record GraphQL's `{entity}(id)` returns; more than this component
  // strictly needs (just `refDisplayField`), but that's exactly what the REST call it replaces
  // already fetched too, so no new cost.
  const shouldFetch = Boolean(refEntity && id) && !batchMode;
  const { data: record } = useGraphQLRecord(refEntity ?? "", shouldFetch ? id : undefined);

  if (!id) {
    return <>—</>;
  }

  const raw =
    !batchMode && record && field.refDisplayField ? record.data[field.refDisplayField] : undefined;
  const label = batchMode ? (displayValue ?? id) : typeof raw === "string" ? raw : id;

  if (interactive && refEntity) {
    return (
      <navAdapter.Link
        to={navAdapter.toRecordDetail(refEntity, id)}
        className="text-primary underline-offset-4 hover:underline"
      >
        {label}
      </navAdapter.Link>
    );
  }

  return <>{label}</>;
}
