import { Button, IconButton, RadioGroup, RadioGroupItem, Select, TreeItem } from "@metap/ui";
import { useTranslation } from "react-i18next";
import type { EntitySummary } from "../../metadata/types";
import { AttributePicker } from "./AttributePicker";
import { ValueEditor } from "./ValueEditor";
import {
  emptyAttributeCondition,
  emptyGroupCondition,
  isAllCondition,
  isAttributeCondition,
  removeChildAt,
  replaceChildAt,
  type ConditionOp,
  type PolicyCondition,
} from "../policyCondition";

const CONDITION_OPS: ConditionOp[] = ["eq", "neq", "in", "notIn", "gt", "gte", "lt", "lte"];

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <IconButton
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={onClick}
      className="text-destructive hover:text-destructive"
      icon={<span className="text-base leading-none">×</span>}
    />
  );
}

/**
 * Recursive renderer for one `PolicyCondition` node — grouping nests via `@metap/ui`'s `TreeItem`
 * (the indent + left-border shell, added 2026-08-31 once this was the confirmed gap prompting it
 * — see design-system/docs/component-status.md's TreeItem row). This component still owns the
 * recursion itself (`PolicyCondition` domain data has no counterpart in `@metap/ui`), `TreeItem`
 * only renders the per-level visual shell. `onReplace`/`onRemove` are supplied by the parent that owns
 * this node's slot (either `ConditionBuilder` for the root, or this same component for a group's
 * child), so edits always flow top-down through immutable array splicing
 * (`replaceChildAt`/`removeChildAt`) — nodes have no stable id, index-based splicing within a
 * single parent's children array is sufficient since a node is never referenced from two places.
 *
 * Known v1 limitation, accepted rather than solved: no "wrap this leaf into a new group in
 * place" — remove it and re-add inside the new group instead.
 */
export function ConditionNodeEditor({
  node,
  onReplace,
  onRemove,
  subject,
  entity,
  depth,
}: {
  node: PolicyCondition;
  onReplace: (next: PolicyCondition) => void;
  onRemove: () => void;
  subject: "context" | "record";
  entity: Pick<EntitySummary, "fields">;
  depth: number;
}) {
  const { t } = useTranslation();

  if (isAttributeCondition(node)) {
    return (
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[180px] flex-1">
          <AttributePicker
            subject={subject}
            entity={entity}
            value={node.attribute}
            onChange={(attribute) => onReplace({ ...node, attribute })}
          />
        </div>
        <div className="w-[110px]">
          <Select
            options={CONDITION_OPS.map((op) => ({ value: op, label: op }))}
            value={node.op}
            onValueChange={(op) => onReplace({ ...node, op: op as ConditionOp })}
          />
        </div>
        <div className="min-w-[180px] flex-1">
          <ValueEditor
            subject={subject}
            entity={entity}
            attribute={node.attribute}
            op={node.op}
            value={node.value}
            onChange={(value) => onReplace({ ...node, value })}
          />
        </div>
        <RemoveButton onClick={onRemove} label={t("admin.policies.builder.removeCondition")} />
      </div>
    );
  }

  const kind = isAllCondition(node) ? "all" : "any";
  const children = isAllCondition(node) ? node.all : node.any;

  function replaceChild(index: number, next: PolicyCondition) {
    onReplace({ [kind]: replaceChildAt(children, index, next) } as PolicyCondition);
  }

  function removeChild(index: number) {
    onReplace({ [kind]: removeChildAt(children, index) } as PolicyCondition);
  }

  return (
    <TreeItem depth={depth}>
      <div className="flex items-center justify-between gap-2">
        <RadioGroup
          value={kind}
          onValueChange={(next) => onReplace({ [next]: children } as PolicyCondition)}
          className="flex-row gap-4"
        >
          <RadioGroupItem value="all" label={t("admin.policies.builder.groupAll")} />
          <RadioGroupItem value="any" label={t("admin.policies.builder.groupAny")} />
        </RadioGroup>
        {depth > 0 ? (
          <RemoveButton onClick={onRemove} label={t("admin.policies.builder.removeGroup")} />
        ) : null}
      </div>

      {children.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.policies.builder.emptyGroup")}</p>
      ) : null}

      {children.map((child, index) => (
        <ConditionNodeEditor
          // eslint-disable-next-line react/no-array-index-key -- nodes have no stable id, see doc comment above
          key={index}
          node={child}
          onReplace={(next) => replaceChild(index, next)}
          onRemove={() => removeChild(index)}
          subject={subject}
          entity={entity}
          depth={depth + 1}
        />
      ))}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onReplace({ [kind]: [...children, emptyAttributeCondition()] } as PolicyCondition)
          }
        >
          {t("admin.policies.builder.addCondition")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onReplace({ [kind]: [...children, emptyGroupCondition("all")] } as PolicyCondition)
          }
        >
          {t("admin.policies.builder.addGroup")}
        </Button>
      </div>
    </TreeItem>
  );
}
