import {
  Input,
  NumberInput,
  RadioGroup,
  RadioGroupItem,
  Select,
  DatePicker,
  TagsInput,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import type { EntitySummary } from "../../metadata/types";
import { AttributePicker } from "./AttributePicker";
import { isFromContext, isLiteral, type ConditionOp, type PolicyValue } from "../policyCondition";

/** Same ISO-string <-> `Date` conversion `field/FieldInput.tsx` uses for `DatePicker` — small
 *  enough to duplicate rather than share (see that file's own copy for why: `@metap/ui`'s
 *  `DatePicker` is date-only, no time-of-day component yet). */
function isoDateToDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isNumericKind(kind: string | undefined): boolean {
  return kind === "number" || kind === "money";
}

/**
 * Edits a `PolicyCondition::Attribute`'s `value` — the Literal/FromContext choice
 * (`PolicyValue`) plus a type-aware literal control. `attribute`/`subject`/`entity` are only
 * used to look up the field's `kind` for the literal control's shape when `subject === "record"`
 * (a context attribute has no declared type, so it always falls back to plain text).
 */
export function ValueEditor({
  subject,
  entity,
  attribute,
  op,
  value,
  onChange,
}: {
  subject: "context" | "record";
  entity: Pick<EntitySummary, "fields">;
  attribute: string;
  op: ConditionOp;
  value: PolicyValue;
  onChange: (next: PolicyValue) => void;
}) {
  const { t } = useTranslation();
  const mode = isFromContext(value) ? "fromContext" : "literal";
  const field = subject === "record" ? entity.fields.find((f) => f.name === attribute) : undefined;
  const isMultiValue = op === "in" || op === "notIn";
  const literal = isLiteral(value) ? value.literal : undefined;

  function setLiteral(next: unknown) {
    onChange({ literal: next });
  }

  return (
    <div className="flex flex-col gap-1">
      <RadioGroup
        value={mode}
        onValueChange={(next) =>
          onChange(next === "fromContext" ? { fromContext: "" } : { literal: "" })
        }
        className="flex-row gap-4"
      >
        <RadioGroupItem value="literal" label={t("admin.policies.builder.valueLiteral")} />
        <RadioGroupItem value="fromContext" label={t("admin.policies.builder.valueFromContext")} />
      </RadioGroup>

      {isFromContext(value) ? (
        <AttributePicker
          subject="context"
          entity={entity}
          value={value.fromContext}
          onChange={(next) => onChange({ fromContext: next })}
        />
      ) : isMultiValue ? (
        <TagsInput
          value={Array.isArray(literal) ? literal.map(String) : []}
          onChange={(tags) => setLiteral(isNumericKind(field?.kind) ? tags.map(Number) : tags)}
          placeholder={t("admin.policies.builder.valuesPlaceholder")}
        />
      ) : field?.kind === "enum" ? (
        <Select
          options={(field.enumValues ?? []).map((v) => ({ value: v, label: v }))}
          value={typeof literal === "string" ? literal : undefined}
          onValueChange={setLiteral}
        />
      ) : isNumericKind(field?.kind) ? (
        <NumberInput
          value={typeof literal === "number" ? literal : undefined}
          onChange={setLiteral}
        />
      ) : field?.kind === "boolean" ? (
        <Select
          options={[
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ]}
          value={typeof literal === "boolean" ? String(literal) : undefined}
          onValueChange={(v) => setLiteral(v === "true")}
        />
      ) : field?.kind === "date" || field?.kind === "datetime" ? (
        <DatePicker
          value={isoDateToDate(literal)}
          onValueChange={(d) => setLiteral(d ? d.toISOString() : null)}
        />
      ) : (
        <Input
          value={typeof literal === "string" || typeof literal === "number" ? String(literal) : ""}
          onChange={(e) => setLiteral(e.currentTarget.value)}
        />
      )}
    </div>
  );
}
