import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { apiFetch, ApiError } from "../api/client";
import { useEntityLabels } from "../i18n/useEntityLabels";
import type { EntityWorkflow } from "../metadata/types";
import type { RecordCapabilities } from "../detail/recordCapabilities";
import { TransitionButtons } from "./TransitionButtons";
import { WorkflowDiagram } from "./WorkflowDiagram";

type RecordDto = { id: string; version: number; data: Record<string, unknown> };

/** The transition *actions* for a record — available-transition buttons, the "Visualize workflow"
 * dialog trigger, and the error from a failed transition attempt. The passive "which state is
 * this record in, and what's the whole sequence" display used to live here too (a togglable grid
 * of disconnected badges) but moved to `WorkflowStepper`, rendered at the top of `RecordDetail`
 * instead — always visible, not something a caller could hide, which a status indicator shouldn't
 * be. Renders inside a `TooltipProvider` — see `field/FieldValue`'s doc comment. */
export function WorkflowActionBar({
  entityName,
  recordId,
  version,
  workflow,
  currentState,
  capabilities,
  onTransitioned,
}: {
  entityName: string;
  recordId: string;
  version: number;
  workflow: EntityWorkflow;
  currentState: string;
  capabilities: RecordCapabilities;
  onTransitioned: (record: RecordDto) => void;
}) {
  const { t } = useTranslation();
  const { transitionLabel } = useEntityLabels(entityName);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const availableTransitions = useMemo(
    () => workflow.transitions.filter((t) => t.from === currentState),
    [workflow, currentState],
  );
  const transitionInfo = useMemo(
    () => new Map(capabilities.transitions.map((t) => [t.action, t])),
    [capabilities],
  );

  async function handleTransition(action: string) {
    setActionError(null);
    setPendingAction(action);
    try {
      const response = await apiFetch<{ data: RecordDto }>(
        `/api/${entityName}/${recordId}/transitions/${action}`,
        {
          method: "POST",
          body: JSON.stringify({ version }),
        },
      );
      onTransitioned(response.data);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : t("common.somethingWentWrong"));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-fit">
            {t("workflow.visualize")}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("workflow.visualize")}</DialogTitle>
          </DialogHeader>
          <WorkflowDiagram
            workflow={workflow}
            currentState={currentState}
            availableTransitions={availableTransitions}
            transitionInfo={transitionInfo}
            pendingAction={pendingAction}
            onTransition={(action) => void handleTransition(action)}
            transitionLabel={transitionLabel}
          />
        </DialogContent>
      </Dialog>

      {actionError ? <Alert variant="destructive">{actionError}</Alert> : null}

      <TransitionButtons
        availableTransitions={availableTransitions}
        transitionInfo={transitionInfo}
        pendingAction={pendingAction}
        onTransition={(action) => void handleTransition(action)}
        transitionLabel={transitionLabel}
      />
    </div>
  );
}
