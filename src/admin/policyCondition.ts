import type { AdminPolicy } from "./adminApi";

/**
 * Mirrors `crates/metap-permission/src/policy_condition/types.rs` exactly — same untagged-union
 * shape serde produces (`{attribute,op,value}` / `{all:[...]}` / `{any:[...]}` are mutually
 * exclusive by field presence, so a plain presence check is a lossless discriminator, matching
 * how serde itself disambiguates an `#[serde(untagged)]` enum on the wire).
 */
export type PolicyValue = { literal: unknown } | { fromContext: string };

export type ConditionOp = "eq" | "neq" | "in" | "notIn" | "gt" | "gte" | "lt" | "lte";

export type AttributeCondition = { attribute: string; op: ConditionOp; value: PolicyValue };
export type AllCondition = { all: PolicyCondition[] };
export type AnyCondition = { any: PolicyCondition[] };

export type PolicyCondition = AttributeCondition | AllCondition | AnyCondition;

export function isAttributeCondition(node: PolicyCondition): node is AttributeCondition {
  return "attribute" in node;
}

export function isAllCondition(node: PolicyCondition): node is AllCondition {
  return "all" in node;
}

export function isAnyCondition(node: PolicyCondition): node is AnyCondition {
  return "any" in node;
}

export function isLiteral(value: PolicyValue): value is { literal: unknown } {
  return "literal" in value;
}

export function isFromContext(value: PolicyValue): value is { fromContext: string } {
  return "fromContext" in value;
}

export function emptyAttributeCondition(): AttributeCondition {
  return { attribute: "", op: "eq", value: { literal: "" } };
}

export function emptyGroupCondition(kind: "all" | "any"): AllCondition | AnyCondition {
  return kind === "all" ? { all: [] } : { any: [] };
}

/** Immutable child-array splice — `PolicyCondition` nodes have no stable id, so index-based
 *  updates within a given parent's own children array are sufficient (edits always flow top-down
 *  from the parent that owns the array, never across parents). */
export function replaceChildAt(
  children: PolicyCondition[],
  index: number,
  next: PolicyCondition,
): PolicyCondition[] {
  return children.map((child, i) => (i === index ? next : child));
}

export function removeChildAt(children: PolicyCondition[], index: number): PolicyCondition[] {
  return children.filter((_, i) => i !== index);
}

function describeValue(value: PolicyValue): string {
  if (isFromContext(value)) return `context.${value.fromContext}`;
  const v = value.literal;
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  return JSON.stringify(v);
}

/** Short human-readable summary for the Advanced policies table's condition column — replaces
 *  the raw `JSON.stringify` dump the old raw-JSON-textarea UI used. */
export function describeCondition(node: PolicyCondition): string {
  if (isAttributeCondition(node)) {
    return `${node.attribute} ${node.op} ${describeValue(node.value)}`;
  }
  if (isAllCondition(node)) {
    return node.all.length === 0 ? "(empty AND)" : node.all.map(describeCondition).join(" AND ");
  }
  return node.any.length === 0 ? "(empty OR)" : node.any.map(describeCondition).join(" OR ");
}

/** Single source of truth for the Basic (matrix) vs. Advanced split — a policy the matrix can
 *  represent as a plain role checkbox has no condition, no field scope, checks the caller's own
 *  context (not the record), and allows (doesn't deny). Anything else is only ever shown/edited
 *  in the Advanced tab, never silently hidden by the matrix. `roles: null`/`[]` ("Everyone") still
 *  counts as basic-shaped — it just renders as a pinned row instead of one role's checkbox. */
export function isBasicShapedRow(policy: AdminPolicy): boolean {
  return (
    policy.condition === null &&
    policy.field === null &&
    policy.subject === "context" &&
    policy.effect === "allow"
  );
}
