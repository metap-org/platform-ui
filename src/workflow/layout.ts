import type { EntityWorkflow } from "../metadata/types";

/** Every state the workflow mentions anywhere, in a stable order. `EntityWorkflow` has no explicit
 * `states` array — a state exists only by being named as `initialState`, as a transition's
 * `from`/`to`, or in `terminalStates` — so this is the only complete list available. */
function allStates(workflow: EntityWorkflow): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const add = (state: string) => {
    if (state && !seen.has(state)) {
      seen.add(state);
      ordered.push(state);
    }
  };

  add(workflow.initialState);
  for (const transition of workflow.transitions) {
    add(transition.from);
    add(transition.to);
  }
  for (const state of workflow.terminalStates) {
    add(state);
  }

  return ordered;
}

/** BFS column index for each state from `workflow.initialState` — shared by `WorkflowActionBar`'s
 * flat badge row and `WorkflowDiagram`'s canvas so the two views can never disagree on layout.
 *
 * A state the BFS can't reach (a disconnected component, or a `terminalStates` entry no reachable
 * transition points at) is **not** dropped — it lands in one extra trailing column. Dropping it is
 * what the previous version did, and it silently hid part of the workflow from both views: no
 * position meant no node rendered and every edge touching it skipped without a word
 * (`docs/audits/02-auth-permission-workflow-diagram-audit.md` finding A7). */
export function computeLevels(workflow: EntityWorkflow): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  for (const transition of workflow.transitions) {
    const list = adjacency.get(transition.from) ?? [];
    list.push(transition.to);
    adjacency.set(transition.from, list);
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];

  // Guarded: an entity can carry a workflow with an empty `initialState` (nothing validates it
  // client-side), and seeding the BFS with `""` would put a phantom state at level 0.
  if (workflow.initialState) {
    levels.set(workflow.initialState, 0);
    queue.push(workflow.initialState);
  }

  while (queue.length > 0) {
    const state = queue.shift();
    if (state === undefined) {
      break;
    }
    const level = levels.get(state) ?? 0;
    for (const next of adjacency.get(state) ?? []) {
      if (!levels.has(next)) {
        levels.set(next, level + 1);
        queue.push(next);
      }
    }
  }

  const unreachableLevel = levels.size > 0 ? Math.max(...levels.values()) + 1 : 0;
  for (const state of allStates(workflow)) {
    if (!levels.has(state)) {
      levels.set(state, unreachableLevel);
    }
  }

  return levels;
}

export function groupByLevel(levels: Map<string, number>): string[][] {
  // `Math.max()` of nothing is `-Infinity`; `Array.from({ length: -Infinity })` happens to yield
  // `[]` rather than throwing, but that is luck, not intent — bail explicitly instead.
  if (levels.size === 0) {
    return [];
  }

  const maxLevel = Math.max(...levels.values());
  const columns: string[][] = Array.from({ length: maxLevel + 1 }, (): string[] => []);
  for (const [state, level] of levels) {
    columns[level]?.push(state);
  }
  return columns;
}
