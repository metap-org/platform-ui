import type { ReactElement } from "react";
import { Checkbox, DatePicker, Input, NumberInput, Select, Textarea } from "@metap/ui";
import type { EntityField, FieldKind } from "../metadata/types";
import { ReferenceFieldInput } from "./ReferenceFieldInput";

/** `@metap/ui`'s `DatePicker` is date-only (no time-of-day component yet, tracked as a real gap
 * — see README.md) — `"datetime"` fields use it too, losing the time portion `@mantine/dates`'s
 * `DateTimePicker` kept. Converts between this package's ISO-string field values and the
 * component's own `Date | null`. */
function isoDateToDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type FieldInputRendererProps = {
  field: EntityField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  disabled?: boolean;
  label: string;
  helperText?: string;
};

function renderBooleanInput({
  label,
  value,
  onChange,
  disabled,
  error,
  helperText,
}: FieldInputRendererProps) {
  return (
    <div className="flex flex-col gap-1">
      <Checkbox
        label={label}
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(checked)}
        disabled={disabled}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        helperText && <p className="text-sm text-muted-foreground">{helperText}</p>
      )}
    </div>
  );
}

function renderNumberInput({
  label,
  helperText,
  value,
  onChange,
  error,
  disabled,
}: FieldInputRendererProps) {
  return (
    <NumberInput
      label={label}
      helperText={helperText}
      value={typeof value === "number" ? value : undefined}
      onChange={(v) => onChange(v)}
      error={error}
      disabled={disabled}
    />
  );
}

function renderDateInput({
  label,
  helperText,
  value,
  onChange,
  error,
  disabled,
}: FieldInputRendererProps) {
  return (
    <DatePicker
      label={label}
      helperText={helperText}
      value={isoDateToDate(value)}
      onValueChange={(d) => onChange(d ? d.toISOString() : undefined)}
      error={error}
      disabled={disabled}
    />
  );
}

function renderEnumInput({
  field,
  label,
  helperText,
  value,
  onChange,
  error,
  disabled,
}: FieldInputRendererProps) {
  return (
    <Select
      label={label}
      helperText={helperText}
      options={(field.enumValues ?? []).map((v) => ({ value: v, label: v }))}
      value={typeof value === "string" ? value : undefined}
      onValueChange={(v) => onChange(v)}
      error={error}
      disabled={disabled}
    />
  );
}

function renderJsonInput({
  label,
  helperText,
  value,
  onChange,
  error,
  disabled,
}: FieldInputRendererProps) {
  return (
    <Textarea
      label={label}
      helperText={helperText}
      value={typeof value === "string" ? value : value ? JSON.stringify(value) : ""}
      onChange={(event) => onChange(event.currentTarget.value)}
      error={error}
      disabled={disabled}
    />
  );
}

function renderStringInput({
  label,
  helperText,
  value,
  onChange,
  error,
  disabled,
}: FieldInputRendererProps) {
  return (
    <Input
      label={label}
      helperText={helperText}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.currentTarget.value)}
      error={error}
      disabled={disabled}
    />
  );
}

function renderReferenceInput({
  field,
  value,
  onChange,
  error,
  disabled,
}: FieldInputRendererProps) {
  return (
    <ReferenceFieldInput
      field={field}
      value={value}
      onChange={onChange}
      error={error}
      disabled={disabled}
    />
  );
}

/** A `FieldKind -> renderer` map rather than a `switch` — same reasoning as
 *  `fieldKindConfig.ts`'s `FORMATTERS`: adding a new `FieldKind` means adding one entry here, and
 *  a future low-code UI builder can enumerate this map's keys to list "available widgets"
 *  instead of parsing a `switch`. See
 *  `platform-ui/docs/audits/01-frontend-performance-audit.md` finding #7. */
const FIELD_INPUT_RENDERERS: Record<
  FieldKind,
  (props: FieldInputRendererProps) => ReactElement | null
> = {
  id: () => null,
  boolean: renderBooleanInput,
  number: renderNumberInput,
  money: renderNumberInput,
  date: renderDateInput,
  datetime: renderDateInput,
  enum: renderEnumInput,
  json: renderJsonInput,
  string: renderStringInput,
  reference: renderReferenceInput,
};

export function FieldInput({
  field,
  value,
  onChange,
  error,
  disabled,
  label: labelOverride,
}: {
  field: EntityField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  disabled?: boolean;
  /** Overrides `field.label` (e.g. a translated label) — the required-field `" *"` suffix is
   *  still appended here either way. */
  label?: string;
}) {
  const label = (labelOverride ?? field.label) + (field.required ? " *" : "");
  const helperText = disabled ? "You can't edit this field" : undefined;

  const render = FIELD_INPUT_RENDERERS[field.kind];
  return render({ field, value, onChange, error, disabled, label, helperText });
}
