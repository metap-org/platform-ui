import { Checkbox, DatePicker, Input, NumberInput, Select, Textarea } from "@ui/ui-lib";
import type { EntityField } from "../metadata/types";
import { ReferenceFieldInput } from "./ReferenceFieldInput";

/** `@ui/ui-lib`'s `DatePicker` is date-only (no time-of-day component yet, tracked as a real gap
 * — see README.md) — `"datetime"` fields use it too, losing the time portion `@mantine/dates`'s
 * `DateTimePicker` kept. Converts between this package's ISO-string field values and the
 * component's own `Date | null`. */
function isoDateToDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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

  switch (field.kind) {
    case "id":
      return null;
    case "boolean":
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
    case "number":
    case "money":
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
    case "date":
    case "datetime":
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
    case "enum":
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
    case "json":
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
    case "string":
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
    case "reference":
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
}
