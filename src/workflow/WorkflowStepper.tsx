import { Fragment, useMemo } from "react";
import { Stepper, StepperGroup, StepperItem, StepperConnector } from "@metap/ui";
import type { EntityWorkflow } from "../metadata/types";
import { computeLevels, groupByLevel } from "./layout";

/**
 * The always-visible "where is this record in its process" strip — separate from
 * `WorkflowActionBar` (the transition buttons + "Visualize workflow" dialog trigger) on purpose:
 * this is a passive status display meant to sit at the top of `RecordDetail`, right under the
 * title, not buried below the field list where the record used to only show a single
 * `<Badge>{currentState}</Badge>` with no sense of what came before or could come next.
 *
 * Previously this same sequence rendered inside `WorkflowActionBar` as a plain grid of
 * disconnected `Badge`s, and could be toggled hidden entirely (`workflow.hide`/`workflow.show`) —
 * both dropped here: a status indicator that can be hidden isn't really "always visible", and a
 * grid with gaps between columns doesn't read as one connected sequence the way `Stepper`'s
 * connectors do.
 *
 * Reuses `layout.ts`'s BFS-column grouping — the exact same columns `WorkflowDiagram`'s canvas
 * lays out nodes into, so this strip and the full canvas can never disagree about ordering.
 */
export function WorkflowStepper({
  workflow,
  currentState,
}: {
  workflow: EntityWorkflow;
  currentState: string;
}) {
  const columns = useMemo(() => groupByLevel(computeLevels(workflow)), [workflow]);
  const terminalStates = useMemo(() => new Set(workflow.terminalStates), [workflow]);

  return (
    <Stepper aria-label="workflow">
      {columns.map((states, index) => (
        <Fragment key={index}>
          {index > 0 ? <StepperConnector /> : null}
          <StepperGroup>
            {states.map((state) => (
              <StepperItem
                key={state}
                variant={
                  state === currentState
                    ? "current"
                    : terminalStates.has(state)
                      ? "terminal"
                      : "default"
                }
              >
                {state}
              </StepperItem>
            ))}
          </StepperGroup>
        </Fragment>
      ))}
    </Stepper>
  );
}
