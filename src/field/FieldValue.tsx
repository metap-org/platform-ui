import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@metap/ui";
import type { BadgeProps } from "@metap/ui";
import type { EntityField, FieldDisplayHint } from "../metadata/types";
import { getFieldLayoutHint } from "../metadata/entityLayout";
import { formatFieldValue } from "./fieldKindConfig";
import { ReferenceFieldValue } from "./ReferenceFieldValue";
import { UserFieldValue } from "./UserFieldValue";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

// `FieldDisplayHint.enumTones`'s values are a plain `Record<string, string>` on the wire (see
// that type's doc comment, `metap-metadata`) — an app's own metadata can't guarantee it only ever
// names a variant this version of `@metap/ui` actually has, so an unrecognized string falls back
// to the same `"secondary"` this renderer always used, rather than passing it through to `Badge`
// unchecked.
const BADGE_VARIANTS: readonly BadgeVariant[] = [
  "default",
  "secondary",
  "destructive",
  "outline",
  "success",
  "warning",
];

function asBadgeVariant(value: string | undefined): BadgeVariant {
  return value && (BADGE_VARIANTS as readonly string[]).includes(value)
    ? (value as BadgeVariant)
    : "secondary";
}

/** Renders inside a `TooltipProvider` — the consuming app mounts one once near its root (see
 * `@metap/ui`'s `TooltipProvider`), same as every other `Tooltip` use in this package.
 *
 * `relatedDisplay` (present only when the caller has a batch-resolved map, i.e. `GeneratedList`
 * passing a list row's `RecordDto.relatedDisplay`) switches `reference` fields into "batch mode":
 * no per-cell request is made at all, even for a field this specific map has no entry for (a
 * masked/dangling/unresolvable relation just falls back to showing the raw id) — see
 * `ReferenceFieldValue`'s doc comment for why refetching per cell is never the right fallback
 * here. Omit it (as `RecordDetail`'s single-record view does) to keep the previous one-request-
 * per-field behavior, which is fine at that scale (one record, not a page of rows).
 *
 * `entityName` (the entity *containing* this field, not `field.refEntity`) looks up this field's
 * `entityLayout.ts` hint — omit it to always get the default hint (e.g. a caller that doesn't
 * have an entity context to declare against yet).
 *
 * `fieldDisplayHints` (the entity's own `EntitySummary.fieldDisplayHints`) carries two independent
 * hints, matched by `field.name` — see `FieldDisplayHint`'s doc comment (`metap-metadata`) for
 * both: `resolveVia` resolves a plain `string` field that holds an id from a platform-level
 * collection this entity's metadata can't see (e.g. a user id), and `enumTones` maps an `enum`
 * field's values onto a semantic `Badge` tone instead of the flat `variant="secondary"` every enum
 * value gets by default. Omit it to skip both and get the pre-hint behavior (raw value / flat
 * `"secondary"`), same fallback shape as omitting `relatedDisplay`. */
export function FieldValue({
  field,
  value,
  relatedDisplay,
  entityName,
  fieldDisplayHints,
}: {
  field: EntityField;
  value: unknown;
  relatedDisplay?: Record<string, string>;
  entityName?: string;
  fieldDisplayHints?: FieldDisplayHint[];
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

  const displayHint = fieldDisplayHints?.find((h) => h.field === field.name);
  if (displayHint?.resolveVia === "users") {
    return <UserFieldValue value={value} />;
  }

  if (field.kind === "reference") {
    const hint = getFieldLayoutHint(entityName ?? "", field.name);
    return (
      <ReferenceFieldValue
        field={field}
        value={value}
        displayValue={relatedDisplay?.[field.name]}
        batchMode={relatedDisplay !== undefined}
        interactive={hint.interactive ?? true}
      />
    );
  }

  const formatted = formatFieldValue(field.kind, value) ?? "—";

  if (field.kind === "enum") {
    const tone = displayHint?.enumTones?.[String(value)];
    return <Badge variant={asBadgeVariant(tone)}>{formatted}</Badge>;
  }

  return <>{formatted}</>;
}
