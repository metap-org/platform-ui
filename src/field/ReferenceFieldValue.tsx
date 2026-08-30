import { useApiQuery } from "../api/useApiQuery";
import type { EntityField } from "../metadata/types";

type RecordDto = {
  id: string;
  code: string | null;
  status: string | null;
  version: number;
  data: Record<string, unknown>;
};

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
 */
export function ReferenceFieldValue({
  field,
  value,
  displayValue,
  batchMode = false,
}: {
  field: EntityField;
  value: unknown;
  displayValue?: string;
  batchMode?: boolean;
}) {
  const refEntity = field.refEntity;
  const id = typeof value === "string" ? value : undefined;

  const { data: record } = useApiQuery<{ data: RecordDto }, RecordDto>(
    ["record", refEntity, id],
    `/api/${refEntity}/${id}`,
    (response) => response.data,
    Boolean(refEntity && id) && !batchMode,
  );

  if (!id) {
    return <>—</>;
  }

  if (batchMode) {
    return <>{displayValue ?? id}</>;
  }

  const raw = record && field.refDisplayField ? record.data[field.refDisplayField] : undefined;
  return <>{typeof raw === "string" ? raw : id}</>;
}
