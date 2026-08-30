import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@metap/ui";
import type { EntityField } from "../metadata/types";
import { formatFieldValue } from "./fieldKindConfig";
import { ReferenceFieldValue } from "./ReferenceFieldValue";

/** Renders inside a `TooltipProvider` — the consuming app mounts one once near its root (see
 * `@metap/ui`'s `TooltipProvider`), same as every other `Tooltip` use in this package.
 *
 * `relatedDisplay` (present only when the caller has a batch-resolved map, i.e. `GeneratedList`
 * passing a list row's `RecordDto.relatedDisplay`) switches `reference` fields into "batch mode":
 * no per-cell request is made at all, even for a field this specific map has no entry for (a
 * masked/dangling/unresolvable relation just falls back to showing the raw id) — see
 * `ReferenceFieldValue`'s doc comment for why refetching per cell is never the right fallback
 * here. Omit it (as `RecordDetail`'s single-record view does) to keep the previous one-request-
 * per-field behavior, which is fine at that scale (one record, not a page of rows). */
export function FieldValue({
  field,
  value,
  relatedDisplay,
}: {
  field: EntityField;
  value: unknown;
  relatedDisplay?: Record<string, string>;
}) {
  if (value === null || value === undefined) {
    if (field.required) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline">Masked</Badge>
          </TooltipTrigger>
          <TooltipContent>You don't have permission to view this field</TooltipContent>
        </Tooltip>
      );
    }
    return <>—</>;
  }

  if (field.kind === "reference") {
    return (
      <ReferenceFieldValue
        field={field}
        value={value}
        displayValue={relatedDisplay?.[field.name]}
        batchMode={relatedDisplay !== undefined}
      />
    );
  }

  const formatted = formatFieldValue(field.kind, value) ?? "—";

  if (field.kind === "enum") {
    return <Badge variant="secondary">{formatted}</Badge>;
  }

  return <>{formatted}</>;
}
