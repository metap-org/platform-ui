import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@metap/ui";
import { WorkflowDiagram } from "./WorkflowDiagram";
import type { TransitionAvailability } from "../detail/recordCapabilities";
import type { EntityWorkflow, WorkflowTransition } from "../metadata/types";

/** The "Visualize workflow" trigger + `max-w-3xl` dialog wrapping `WorkflowDiagram` — same block
 *  found lduplicated verbatim across `metap-demo-waf`'s `ZoneDetailPage.tsx`/
 *  `IncidentDetailPage.tsx` (`platform-ui/docs/audits/03-waf-demo-component-placement-audit.md`
 *  finding #7, `docs/features/28-workflow-visualize-dialog.md`). `label` is used for both the
 *  trigger button's text and the dialog title — both call sites already passed the same string
 *  to both, so this doesn't lose anything by not taking 2 separate props. */
export function WorkflowVisualizeDialog({
  label,
  workflow,
  currentState,
  availableTransitions,
  transitionInfo,
  pendingAction,
  onTransition,
  transitionLabel,
}: {
  label: string;
  workflow: EntityWorkflow;
  currentState: string;
  availableTransitions: WorkflowTransition[];
  transitionInfo: Map<string, TransitionAvailability>;
  pendingAction: string | null;
  onTransition: (action: string) => void;
  transitionLabel: (action: string, fallback: string) => string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <WorkflowDiagram
          workflow={workflow}
          currentState={currentState}
          availableTransitions={availableTransitions}
          transitionInfo={transitionInfo}
          pendingAction={pendingAction}
          onTransition={onTransition}
          transitionLabel={transitionLabel}
        />
      </DialogContent>
    </Dialog>
  );
}
