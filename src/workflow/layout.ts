import type { EntityWorkflow } from "../metadata/types";

/** BFS column index for each state from `workflow.initialState` — shared by `WorkflowActionBar`'s
 * flat badge row and `WorkflowDiagram`'s canvas so the two views can never disagree on layout. */
export function computeLevels(workflow: EntityWorkflow): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  for (const transition of workflow.transitions) {
    const list = adjacency.get(transition.from) ?? [];
    list.push(transition.to);
    adjacency.set(transition.from, list);
  }

  const levels = new Map<string, number>();
  levels.set(workflow.initialState, 0);
  const queue: string[] = [workflow.initialState];

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

  return levels;
}

export function groupByLevel(levels: Map<string, number>): string[][] {
  const maxLevel = Math.max(...levels.values());
  const columns: string[][] = Array.from({ length: maxLevel + 1 }, (): string[] => []);
  for (const [state, level] of levels) {
    columns[level]?.push(state);
  }
  return columns;
}
