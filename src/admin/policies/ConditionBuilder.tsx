import { Button } from "@metap/ui";
import { useTranslation } from "react-i18next";
import type { EntitySummary } from "../../metadata/types";
import { ConditionNodeEditor } from "./ConditionNodeEditor";
import { emptyAttributeCondition, type PolicyCondition } from "../policyCondition";

/**
 * Root of the ABAC "advanced permissions" condition editor — replaces the old raw-JSON
 * `Textarea` in `AdvancedPoliciesPanel`'s create-form. `null` means no condition at all (a plain
 * RBAC-or-open policy); adding one starts from a single empty attribute comparison.
 */
export function ConditionBuilder({
  value,
  onChange,
  subject,
  entity,
}: {
  value: PolicyCondition | null;
  onChange: (next: PolicyCondition | null) => void;
  subject: "context" | "record";
  entity: EntitySummary;
}) {
  const { t } = useTranslation();

  if (value === null) {
    return (
      <Button variant="outline" size="sm" onClick={() => onChange(emptyAttributeCondition())}>
        {t("admin.policies.builder.addCondition")}
      </Button>
    );
  }

  return (
    <ConditionNodeEditor
      node={value}
      onReplace={onChange}
      onRemove={() => onChange(null)}
      subject={subject}
      entity={entity}
      depth={0}
    />
  );
}
