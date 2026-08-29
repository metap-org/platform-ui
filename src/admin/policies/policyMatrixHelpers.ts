import type { AdminPolicy } from "../adminApi";
import { isBasicShapedRow } from "../policyCondition";

/** Sentinel row-key for policies with `roles: null`/`[]` — "open to everyone", pinned as the
 *  matrix's first row rather than hidden (project decision). Never a real role name (role names
 *  come from free text an admin types, but nothing stops someone from typing this exact string;
 *  collision risk is accepted as harmless — both cases already mean "no role restriction"). */
export const EVERYONE_ROLE = "__everyone__";

/** `{entity}_{action}` — a display/search label only (e.g. `jira.worklogs_read`), not a stored
 *  identifier: the wire model stays the existing `(entity, action)` pair
 *  (`crates/metap-permission/src/policy_store.rs`'s `PolicyRow`). Shared between the matrix's
 *  column headers (`PermissionMatrix`) and the cross-entity search results (`PermissionSearch`)
 *  so the same permission always reads the same way in both places. */
export function permissionLabel(entity: string, action: string): string {
  return `${entity}_${action}`;
}

function cellKey(role: string, action: string): string {
  return `${role}::${action}`;
}

export function isChecked(desired: Set<string>, role: string, action: string): boolean {
  return desired.has(cellKey(role, action));
}

export function toggleCell(
  desired: Set<string>,
  role: string,
  action: string,
  checked: boolean,
): Set<string> {
  const next = new Set(desired);
  const key = cellKey(role, action);
  if (checked) next.add(key);
  else next.delete(key);
  return next;
}

export function toggleRow(
  desired: Set<string>,
  role: string,
  actions: string[],
  checked: boolean,
): Set<string> {
  const next = new Set(desired);
  for (const action of actions) {
    const key = cellKey(role, action);
    if (checked) next.add(key);
    else next.delete(key);
  }
  return next;
}

export function toggleColumn(
  desired: Set<string>,
  action: string,
  roles: string[],
  checked: boolean,
): Set<string> {
  const next = new Set(desired);
  for (const role of roles) {
    const key = cellKey(role, action);
    if (checked) next.add(key);
    else next.delete(key);
  }
  return next;
}

export function checkedCountForRole(desired: Set<string>, role: string, actions: string[]): number {
  return actions.filter((action) => isChecked(desired, role, action)).length;
}

export function checkedCountForAction(
  desired: Set<string>,
  action: string,
  roles: string[],
): number {
  return roles.filter((role) => isChecked(desired, role, action)).length;
}

/** The desired-state `Set` a freshly loaded `policies` list seeds the matrix's local editing
 *  state with — one `"role::action"` key per basic-shaped grant (`isBasicShapedRow`), with a
 *  `roles: null`/`[]` row expanding to `EVERYONE_ROLE`, and any other row expanding to one key
 *  per role in its `roles` array (a legacy hand-authored row can still have more than one). */
export function initialDesiredCells(policies: AdminPolicy[]): Set<string> {
  const set = new Set<string>();
  for (const p of policies) {
    if (!isBasicShapedRow(p)) continue;
    const roles = p.roles ?? [];
    if (roles.length === 0) {
      set.add(cellKey(EVERYONE_ROLE, p.action));
    } else {
      for (const role of roles) set.add(cellKey(role, p.action));
    }
  }
  return set;
}

/** The exact request body `PUT /admin/policies/matrix` (`useSyncMatrixPolicies`) expects —
 *  `EVERYONE_ROLE` becomes `role: null` on the wire (`crates/metap-permission/src/policy_store.rs`'s
 *  `sync_basic_policies` treats `None` as the open/Everyone grant). */
export function toGrants(desired: Set<string>): { role: string | null; action: string }[] {
  return [...desired].map((key) => {
    // Split on the *first* "::" only (not `.split`, which returns an unbounded — to TypeScript,
    // possibly-empty — array) — safe because `action` always comes from the fixed known-actions
    // list and never contains "::", even if a free-text role name theoretically did.
    const separatorIndex = key.indexOf("::");
    const role = key.slice(0, separatorIndex);
    const action = key.slice(separatorIndex + 2);
    return { role: role === EVERYONE_ROLE ? null : role, action };
  });
}

export function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** Every role this matrix should show a row for: roles assigned to at least one user, roles
 *  referenced by at least one existing policy (so a policy-only role isn't invisible), plus
 *  `manualRoles` (added via the matrix's own "+ Add role" row, not yet backed by any policy).
 *  Free-text, no backend catalog — deliberate, see `docs` in `PermissionMatrix.tsx`. */
export function collectKnownRoles(
  users: { roles: string[] }[],
  policies: AdminPolicy[],
  manualRoles: string[],
): string[] {
  const set = new Set<string>();
  for (const u of users) for (const r of u.roles) set.add(r);
  for (const p of policies) for (const r of p.roles ?? []) set.add(r);
  for (const r of manualRoles) set.add(r);
  return [...set].sort((a, b) => a.localeCompare(b));
}
