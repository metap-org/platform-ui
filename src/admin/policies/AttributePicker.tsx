import { Select, SuggestInput } from "@metap/ui";
import { useTranslation } from "react-i18next";
import type { EntitySummary } from "../../metadata/types";

/** The only universally-guaranteed `RequestContext` keys (`crates/metap-permission/src/
 *  context.rs`) — anything else (`AUTH_CONTEXT_ENTITY`'s dynamic attributes) is a per-tenant
 *  server config the frontend has no way to enumerate, so this stays a fixed quick-fill list,
 *  not a real catalog. */
const CONTEXT_QUICK_FILLS = ["tenantId", "userId", "roles", "functionId"];

/**
 * Picks the attribute path a `PolicyCondition::Attribute` compares. Implements the record-vs-
 * context asymmetry in `crates/metap-permission/src/policy_condition/evaluate.rs`/`resolve.rs`:
 * a `subject: "record"` condition's attribute resolves against the record being acted on (a
 * closed set — the entity's own fields), while `subject: "context"` resolves against the
 * caller's `RequestContext` (an open set — free text, since dynamic context attributes aren't
 * enumerable from here). Not `Autocomplete`: confirmed it only ever commits a value by picking a
 * listed option or clearing, so typed free text that matches nothing is silently dropped — it
 * can't accept a context key this component doesn't already know about.
 */
export function AttributePicker({
  subject,
  entity,
  value,
  onChange,
}: {
  subject: "context" | "record";
  entity: Pick<EntitySummary, "fields">;
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation();

  if (subject === "record") {
    return (
      <Select
        placeholder={t("admin.policies.builder.attributePlaceholder")}
        options={entity.fields.map((f) => ({ value: f.name, label: f.label }))}
        value={value || undefined}
        onValueChange={onChange}
      />
    );
  }

  return (
    <SuggestInput
      placeholder={t("admin.policies.builder.contextAttributePlaceholder")}
      value={value}
      onChange={onChange}
      suggestions={CONTEXT_QUICK_FILLS}
    />
  );
}
