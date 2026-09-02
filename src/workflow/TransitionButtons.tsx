import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@metap/ui";
import { useTranslation } from "react-i18next";
import type { WorkflowTransition } from "../metadata/types";
import type { TransitionAvailability } from "../detail/recordCapabilities";

/** The row of "from → to" transition buttons — extracted out of `WorkflowActionBar` so
 * `WorkflowDiagram`'s dialog can show the exact same buttons (same disabled/tooltip logic) next
 * to the canvas instead of re-deriving it. Renders inside a `TooltipProvider` — see
 * `field/FieldValue`'s doc comment. */
export function TransitionButtons({
  availableTransitions,
  transitionInfo,
  pendingAction,
  onTransition,
  transitionLabel,
}: {
  availableTransitions: WorkflowTransition[];
  transitionInfo: Map<string, TransitionAvailability>;
  pendingAction: string | null;
  onTransition: (action: string) => void;
  transitionLabel: (action: string, fallback: string) => string;
}) {
  const { t } = useTranslation();

  if (availableTransitions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("workflow.noActions")}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {availableTransitions.map((transition) => {
        const info = transitionInfo.get(transition.action);
        const blocked = info ? !info.available : false;
        const pending = pendingAction === transition.action;
        const button = (
          <Button
            onClick={() => onTransition(transition.action)}
            disabled={blocked || (pendingAction !== null && !pending)}
            loading={pending}
          >
            {transitionLabel(transition.action, transition.label)} ({transition.from} →{" "}
            {transition.to})
          </Button>
        );

        if (!info || info.available) {
          return <span key={transition.action}>{button}</span>;
        }

        return (
          <Tooltip key={transition.action}>
            <TooltipTrigger asChild>
              <span>{button}</span>
            </TooltipTrigger>
            <TooltipContent>{info.reason ?? ""}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
