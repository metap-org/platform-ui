import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@metap/ui";
import type { EntityField } from "../metadata/types";
import { formatFieldValue } from "./fieldKindConfig";
import { ReferenceFieldValue } from "./ReferenceFieldValue";

/** Renders inside a `TooltipProvider` — the consuming app mounts one once near its root (see
 * `@metap/ui`'s `TooltipProvider`), same as every other `Tooltip` use in this package. */
export function FieldValue({ field, value }: { field: EntityField; value: unknown }) {
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
    return <ReferenceFieldValue field={field} value={value} />;
  }

  const formatted = formatFieldValue(field.kind, value) ?? "—";

  if (field.kind === "enum") {
    return <Badge variant="secondary">{formatted}</Badge>;
  }

  return <>{formatted}</>;
}
