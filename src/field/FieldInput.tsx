import type { ReactElement } from "react";
import {
  Autocomplete,
  Checkbox,
  DatePicker,
  DateTimePicker,
  Input,
  MultiSelect,
  NumberInput,
  RadioGroup,
  RadioGroupItem,
  Select,
  TagsInput,
  Textarea,
  Toggle,
} from "@metap/ui";
import type { EntityField, FieldKind } from "../metadata/types";
import { ReferenceFieldInput } from "./ReferenceFieldInput";

/** Converts between this package's ISO-string field values and `DatePicker`/`DateTimePicker`'s
 * own `Date | null`. `"datetime"` fields use `DateTimePicker` (added to `@metap/ui` 2026-08-31)
 * instead of `DatePicker` — previously both kinds shared `DatePicker`, silently losing the
 * time-of-day portion on every round trip for `"datetime"` fields. */
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

function messageBelow(error: string | undefined, helperText: string | undefined) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : (
    helperText && <p className="text-sm text-muted-foreground">{helperText}</p>
  );
}

/** A multi-value field's value is a JSON array of strings; anything else reads as empty. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function enumOptions(field: EntityField) {
  return (field.enumValues ?? []).map((v) => ({ value: v, label: v }));
}

function renderSwitchInput({
  label,
  value,
  onChange,
  disabled,
  error,
  helperText,
}: FieldInputRendererProps) {
  return (
    <div className="flex flex-col gap-1">
      <Toggle
        label={label}
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(checked)}
        disabled={disabled}
      />
      {messageBelow(error, helperText)}
    </div>
  );
}

function renderRadioInput({
  field,
  label,
  value,
  onChange,
  disabled,
  error,
  helperText,
}: FieldInputRendererProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <RadioGroup
        name={field.name}
        value={typeof value === "string" ? value : ""}
        onValueChange={(v) => onChange(v)}
        aria-label={label}
      >
        {enumOptions(field).map((o) => (
          <RadioGroupItem key={o.value} value={o.value} label={o.label} disabled={disabled} />
        ))}
      </RadioGroup>
      {messageBelow(error, helperText)}
    </div>
  );
}

/** Type-to-filter picker over a closed enum list (a reference field already is one, see
 *  `ReferenceFieldInput`). */
function renderEnumComboboxInput({
  field,
  label,
  helperText,
  value,
  onChange,
  error,
  disabled,
}: FieldInputRendererProps) {
  return (
    <Autocomplete
      label={label}
      helperText={helperText}
      options={enumOptions(field)}
      value={typeof value === "string" ? value : undefined}
      onValueChange={(v) => onChange(v ?? undefined)}
      error={error}
      disabled={disabled}
    />
  );
}

function renderTextareaInput({
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
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.currentTarget.value)}
      error={error}
      disabled={disabled}
    />
  );
}

function renderMultiSelectInput({
  field,
  label,
  helperText,
  value,
  onChange,
  error,
  disabled,
}: FieldInputRendererProps) {
  // `MultiSelect` has no `disabled` prop; a read-only field is never edited, so show it as tags.
  if (disabled) {
    return (
      <TagsInput
        label={label}
        helperText={helperText}
        value={stringArray(value)}
        onChange={() => {}}
        disabled
      />
    );
  }
  return (
    <MultiSelect
      label={label}
      helperText={helperText}
      options={enumOptions(field)}
      value={stringArray(value)}
      onChange={(next) => onChange(next)}
      error={error}
    />
  );
}

function renderCheckboxGroupInput({
  field,
  label,
  value,
  onChange,
  error,
  disabled,
  helperText,
}: FieldInputRendererProps) {
  const selected = stringArray(value);
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {enumOptions(field).map((o) => (
        <Checkbox
          key={o.value}
          label={o.label}
          checked={selected.includes(o.value)}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange(
              checked
                ? [...selected, o.value]
                : selected.filter((existing) => existing !== o.value),
            )
          }
        />
      ))}
      {messageBelow(error, helperText)}
    </div>
  );
}

function renderTagsInput({
  label,
  helperText,
  value,
  onChange,
  error,
  disabled,
}: FieldInputRendererProps) {
  return (
    <TagsInput
      label={label}
      helperText={helperText}
      value={stringArray(value)}
      onChange={(next) => onChange(next)}
      error={error}
      disabled={disabled}
    />
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

function renderDateTimeInput({
  label,
  helperText,
  value,
  onChange,
  error,
  disabled,
}: FieldInputRendererProps) {
  return (
    <DateTimePicker
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
  datetime: renderDateTimeInput,
  enum: renderEnumInput,
  json: renderJsonInput,
  string: renderStringInput,
  reference: renderReferenceInput,
};

/** Widget overrides — a field's declared `widget` (metadata) wins over its kind's default
 *  renderer. Same map-not-switch shape, so a form builder can enumerate the available controls. */
const WIDGET_RENDERERS: Record<
  NonNullable<EntityField["widget"]>,
  (props: FieldInputRendererProps) => ReactElement | null
> = {
  switch: renderSwitchInput,
  checkbox: renderBooleanInput,
  select: renderEnumInput,
  radio: renderRadioInput,
  combobox: renderEnumComboboxInput,
  textarea: renderTextareaInput,
  multiselect: renderMultiSelectInput,
  checkboxGroup: renderCheckboxGroupInput,
  tags: renderTagsInput,
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

  // A `reference` field is already a type-to-filter combobox, so `select`/`combobox` on one keep
  // its own renderer rather than the enum-based ones.
  const widgetRender =
    field.widget && field.kind !== "reference" ? WIDGET_RENDERERS[field.widget] : undefined;
  const render = widgetRender ?? FIELD_INPUT_RENDERERS[field.kind];
  return render({ field, value, onChange, error, disabled, label, helperText });
}
