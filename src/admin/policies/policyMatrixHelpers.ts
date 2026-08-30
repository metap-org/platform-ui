import type { AdminPolicy } from "../adminApi";
import { isBasicShapedRow } from "../policyCondition";

/** Sentinel row-key for policies with `roles: null`/`[]` — "open to everyone", pinned as the
 *  matrix's first row rather than hidden (project decision). Never a real role name (role names
 *  come from free text an admin types, but nothing stops someone from typing this exact string;
 *  collision risk is accepted as harmless — both cases already mean "no role restriction"). */
export const EVERYONE_ROLE = "__everyone__";

/** Per-role checked-action state, keyed by role name. Chosen over a single flat
 *  `Set<"role::action">` (the earlier shape) specifically so toggling one role's cell only ever
 *  replaces *that* role's `Set` — every other role's `Set` keeps its old reference, which lets
 *  `PermissionMatrix`'s row component be `memo`-wrapped without re-rendering the whole matrix per
 *  checkbox click (audit `platform-ui/docs/audits/01-frontend-performance-audit.md`, finding #2:
 *  a few dozen roles × ~10 actions worth of checkboxes were all re-rendering on every click). */
export type DesiredState = Map<string, Set<string>>;

/** Stable shared reference for "this role has nothing checked" — never mutated, only ever read,
 *  so a row whose role isn't in the map yet doesn't get a fresh empty `Set` (and therefore a
 *  fresh prop reference) on every render. */
export const EMPTY_ACTION_SET: ReadonlySet<string> = new Set();

/** `{entity}_{action}` — a display/search label only (e.g. `jira.worklogs_read`), not a stored
 *  identifier: the wire model stays the existing `(entity, action)` pair
 *  (`crates/metap-permission/src/policy_store.rs`'s `PolicyRow`). Shared between the matrix's
 *  column headers (`PermissionMatrix`) and the cross-entity search results (`PermissionSearch`)
 *  so the same permission always reads the same way in both places. */
export function permissionLabel(entity: string, action: string): string {
  return `${entity}_${action}`;
}

export function isChecked(desired: DesiredState, role: string, action: string): boolean {
  return (desired.get(role) ?? EMPTY_ACTION_SET).has(action);
}

export function toggleCell(
  desired: DesiredState,
  role: string,
  action: string,
  checked: boolean,
): DesiredState {
  const next = new Map(desired);
  const roleActions = new Set(next.get(role) ?? EMPTY_ACTION_SET);
  if (checked) roleActions.add(action);
  else roleActions.delete(action);
  next.set(role, roleActions);
  return next;
}

export function toggleRow(
  desired: DesiredState,
  role: string,
  actions: string[],
  checked: boolean,
): DesiredState {
  const next = new Map(desired);
  const roleActions = new Set(next.get(role) ?? EMPTY_ACTION_SET);
  for (const action of actions) {
    if (checked) roleActions.add(action);
    else roleActions.delete(action);
  }
  next.set(role, roleActions);
  return next;
}

/** The one toggle that legitimately touches every role's `Set` — a column header checkbox
 *  affects every row in that column, so every row genuinely needs to re-render here. */
export function toggleColumn(
  desired: DesiredState,
  action: string,
  roles: string[],
  checked: boolean,
): DesiredState {
  const next = new Map(desired);
  for (const role of roles) {
    const roleActions = new Set(next.get(role) ?? EMPTY_ACTION_SET);
    if (checked) roleActions.add(action);
    else roleActions.delete(action);
    next.set(role, roleActions);
  }
  return next;
}

export function checkedCountForRole(
  desired: DesiredState,
  role: string,
  actions: string[],
): number {
  const roleActions = desired.get(role) ?? EMPTY_ACTION_SET;
  return actions.filter((action) => roleActions.has(action)).length;
}

export function checkedCountForAction(
  desired: DesiredState,
  action: string,
  roles: string[],
): number {
  return roles.filter((role) => isChecked(desired, role, action)).length;
}

/** The desired-state map a freshly loaded `policies` list seeds the matrix's local editing state
 *  with — one role -> action-set entry per basic-shaped grant (`isBasicShapedRow`), with a
 *  `roles: null`/`[]` row expanding to `EVERYONE_ROLE`, and any other row expanding to every role
 *  in its `roles` array (a legacy hand-authored row can still have more than one). */
export function initialDesiredCells(policies: AdminPolicy[]): DesiredState {
  const map: DesiredState = new Map();
  for (const p of policies) {
    if (!isBasicShapedRow(p)) continue;
    const roles = p.roles ?? [];
    const roleKeys = roles.length === 0 ? [EVERYONE_ROLE] : roles;
    for (const role of roleKeys) {
      const roleActions = map.get(role) ?? new Set<string>();
      roleActions.add(p.action);
      map.set(role, roleActions);
    }
  }
  return map;
}

/** The exact request body `PUT /admin/policies/matrix` (`useSyncMatrixPolicies`) expects —
 *  `EVERYONE_ROLE` becomes `role: null` on the wire (`crates/metap-permission/src/policy_store.rs`'s
 *  `sync_basic_policies` treats `None` as the open/Everyone grant). */
export function toGrants(desired: DesiredState): { role: string | null; action: string }[] {
  const grants: { role: string | null; action: string }[] = [];
  for (const [role, actions] of desired) {
    for (const action of actions) {
      grants.push({ role: role === EVERYONE_ROLE ? null : role, action });
    }
  }
  return grants;
}

export function desiredEqual(a: DesiredState, b: DesiredState): boolean {
  const roles = new Set([...a.keys(), ...b.keys()]);
  for (const role of roles) {
    const setA = a.get(role) ?? EMPTY_ACTION_SET;
    const setB = b.get(role) ?? EMPTY_ACTION_SET;
    if (setA.size !== setB.size) return false;
    for (const action of setA) if (!setB.has(action)) return false;
  }
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
