import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import { apiFetch, ApiError } from "../api/client";
import { useEntityLabels } from "../i18n/useEntityLabels";
import type { EntityWorkflow } from "../metadata/types";
import type { RecordCapabilities } from "../detail/recordCapabilities";
import { computeLevels, groupByLevel } from "./layout";
import { TransitionButtons } from "./TransitionButtons";
import { WorkflowDiagram } from "./WorkflowDiagram";

type RecordDto = { id: string; version: number; data: Record<string, unknown> };

/** Renders inside a `TooltipProvider` — see `field/FieldValue`'s doc comment. */
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
  const { token } = useAuth();
  const [showBar, setShowBar] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  // `computeLevels` is a BFS over `workflow.transitions` — cheap for today's small graphs, but
  // was re-running on every render (including e.g. `pendingAction`/`showBar` changes that have
  // nothing to do with the workflow) before this `useMemo`. See
  // `platform-ui/docs/audits/01-frontend-performance-audit.md` finding #3.
  const columns = useMemo(() => groupByLevel(computeLevels(workflow)), [workflow]);
  const terminalStates = useMemo(() => new Set(workflow.terminalStates), [workflow]);
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
        token,
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
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setShowBar((v) => !v)}>
          {showBar ? t("workflow.hide") : t("workflow.show")}
        </Button>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
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
      </div>

      {showBar ? (
        <div className="flex items-start gap-8">
          {columns.map((states, index) => (
            <div key={index} className="flex flex-col gap-2">
              {states.map((state) => (
                <Badge
                  key={state}
                  variant={
                    state === currentState
                      ? "default"
                      : terminalStates.has(state)
                        ? "outline"
                        : "secondary"
                  }
                >
                  {state}
                </Badge>
              ))}
            </div>
          ))}
        </div>
      ) : null}

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
