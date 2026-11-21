import type { EntitySummary } from "../../metadata/types";
import type { RoleGrant } from "../roleAdminApi";

/** The base actions every entity offers, in column order. `transition` = every workflow action. */
export const BASE_ACTIONS = ["read", "create", "update", "delete"] as const;
export const TRANSITION = "transition";
const TRANSITION_PREFIX = "transition:";

export type Preset = "none" | "read" | "write" | "full";

/** What each preset grants. "write" includes running workflow actions; only "full" deletes. */
const PRESET_ACTIONS: Record<Preset, string[]> = {
  none: [],
  read: ["read"],
  write: ["read", "create", "update", TRANSITION],
  full: ["read", "create", "update", "delete", TRANSITION],
};

/** `"entity action"` — one grant as a set key. */
export function grantKey(entity: string, action: string): string {
  return `${entity} ${action}`;
}

export function toGrantSet(grants: RoleGrant[]): Set<string> {
  return new Set(grants.map((g) => grantKey(g.entity, g.action)));
}

export function fromGrantSet(set: Set<string>): RoleGrant[] {
  return [...set].sort().map((key) => {
    const i = key.indexOf(" ");
    return { entity: key.slice(0, i), action: key.slice(i + 1) };
  });
}

// The matrix asks for an entity's workflow actions and action keys many times per render (every
// row, every cell); they depend only on the entity's metadata, so compute them once per entity
// object. The results are shared: callers must not mutate them.
const workflowActionsCache = new WeakMap<EntitySummary, { action: string; label: string }[]>();
const actionKeysCache = new WeakMap<EntitySummary, readonly string[]>();

export function workflowActions(entity: EntitySummary): { action: string; label: string }[] {
  const cached = workflowActionsCache.get(entity);
  if (cached) return cached;
  const seen = new Map<string, string>();
  for (const t of entity.workflow?.transitions ?? []) {
    if (!seen.has(t.action)) seen.set(t.action, t.label || t.action);
  }
  const actions = [...seen].map(([action, label]) => ({ action, label }));
  workflowActionsCache.set(entity, actions);
  return actions;
}

export function transitionAction(action: string): string {
  return TRANSITION_PREFIX + action;
}

/** Every action key an entity can be granted: base actions, plus `transition` and one
 *  `transition:<action>` per workflow action when it has a workflow. */
export function entityActionKeys(entity: EntitySummary): readonly string[] {
  const cached = actionKeysCache.get(entity);
  if (cached) return cached;
  const keys: string[] = [...BASE_ACTIONS];
  if (entity.workflow) {
    keys.push(TRANSITION, ...workflowActions(entity).map((w) => transitionAction(w.action)));
  }
  actionKeysCache.set(entity, keys);
  return keys;
}

/** Which of an entity's grants are held, as a string: two sets with the same signature for an
 *  entity render that entity's row identically, so a row can skip rendering when it is unchanged
 *  (the grant set itself is a new object on every edit, whichever row it touched). */
export function entityGrantSignature(set: Set<string>, entity: EntitySummary): string {
  let signature = "";
  for (const action of entityActionKeys(entity)) {
    signature += set.has(grantKey(entity.name, action)) ? "1" : "0";
  }
  return signature;
}

/** How many of an entity's workflow actions are allowed: all when `transition` is granted. */
export function workflowCoverage(
  set: Set<string>,
  entity: EntitySummary,
): { allowed: number; total: number } {
  const actions = workflowActions(entity);
  if (set.has(grantKey(entity.name, TRANSITION)))
    return { allowed: actions.length, total: actions.length };
  const allowed = actions.filter((w) =>
    set.has(grantKey(entity.name, transitionAction(w.action))),
  ).length;
  return { allowed, total: actions.length };
}

/** Sets an entity to a preset: clears everything it had, then grants the preset's actions. */
export function applyPreset(set: Set<string>, entity: EntitySummary, preset: Preset): Set<string> {
  const next = new Set(set);
  for (const key of entityActionKeys(entity)) next.delete(grantKey(entity.name, key));
  for (const action of PRESET_ACTIONS[preset]) {
    if (action === TRANSITION && !entity.workflow) continue;
    next.add(grantKey(entity.name, action));
  }
  return next;
}

/** The preset an entity's current grants match exactly, or null for a custom mix. */
export function matchingPreset(set: Set<string>, entity: EntitySummary): Preset | null {
  const has = (action: string) => set.has(grantKey(entity.name, action));
  const granted = entityActionKeys(entity).filter(has);
  for (const preset of ["none", "read", "write", "full"] as Preset[]) {
    const want = PRESET_ACTIONS[preset].filter((a) => a !== TRANSITION || entity.workflow);
    if (want.length === granted.length && want.every(has)) return preset;
  }
  return null;
}

/** Toggling the whole-workflow cell: on grants `transition` and drops the single-action grants it
 *  now covers; off drops both. */
export function setWorkflowAll(set: Set<string>, entity: EntitySummary, on: boolean): Set<string> {
  const next = new Set(set);
  for (const w of workflowActions(entity))
    next.delete(grantKey(entity.name, transitionAction(w.action)));
  if (on) next.add(grantKey(entity.name, TRANSITION));
  else next.delete(grantKey(entity.name, TRANSITION));
  return next;
}

/** Toggling one workflow action. Turning one off while `transition` covers all of them expands
 *  `transition` into the other single actions, so the rest stay allowed. */
export function setWorkflowAction(
  set: Set<string>,
  entity: EntitySummary,
  action: string,
  on: boolean,
): Set<string> {
  const next = new Set(set);
  const all = grantKey(entity.name, TRANSITION);
  if (next.has(all)) {
    next.delete(all);
    for (const w of workflowActions(entity))
      next.add(grantKey(entity.name, transitionAction(w.action)));
  }
  const key = grantKey(entity.name, transitionAction(action));
  if (on) next.add(key);
  else next.delete(key);
  // Every single action on is the same as `transition`: store the short form.
  const actions = workflowActions(entity);
  if (
    actions.length > 0 &&
    actions.every((w) => next.has(grantKey(entity.name, transitionAction(w.action))))
  ) {
    return setWorkflowAll(next, entity, true);
  }
  return next;
}

/** Grants or revokes one base action across several entities (a group's column header). */
export function setColumn(
  set: Set<string>,
  entities: EntitySummary[],
  action: string,
  on: boolean,
): Set<string> {
  let next = new Set(set);
  for (const e of entities) {
    if (action === TRANSITION) {
      if (e.workflow) next = setWorkflowAll(next, e, on);
      continue;
    }
    if (on) next.add(grantKey(e.name, action));
    else next.delete(grantKey(e.name, action));
  }
  return next;
}

/** `true`, `false` or `"mixed"` for a column over several entities (entities without a workflow
 *  don't count for the transition column). */
export function columnState(
  set: Set<string>,
  entities: EntitySummary[],
  action: string,
): boolean | "mixed" {
  const relevant = action === TRANSITION ? entities.filter((e) => e.workflow) : entities;
  if (relevant.length === 0) return false;
  const on = relevant.filter((e) =>
    action === TRANSITION
      ? set.has(grantKey(e.name, TRANSITION))
      : set.has(grantKey(e.name, action)),
  ).length;
  if (on === 0) {
    if (action === TRANSITION && relevant.some((e) => workflowCoverage(set, e).allowed > 0))
      return "mixed";
    return false;
  }
  return on === relevant.length ? true : "mixed";
}

/** Grants added and removed going from `saved` to `draft`. */
export function changeCount(saved: Set<string>, draft: Set<string>): number {
  let n = 0;
  for (const k of draft) if (!saved.has(k)) n++;
  for (const k of saved) if (!draft.has(k)) n++;
  return n;
}

/** Default grouping when the app gives none: the entity name's namespace (`waf.zones` → `waf`). */
export function defaultGroupFor(entity: EntitySummary): string {
  const i = entity.name.indexOf(".");
  return i > 0 ? entity.name.slice(0, i) : entity.name;
}
