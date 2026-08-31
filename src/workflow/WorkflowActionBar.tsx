import { useMemo, useState } from "react";
import { Alert, Badge, Button, Tooltip, TooltipContent, TooltipTrigger } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import { apiFetch, ApiError } from "../api/client";
import { useEntityLabels } from "../i18n/useEntityLabels";
import type { EntityWorkflow } from "../metadata/types";
import type { RecordCapabilities } from "../detail/recordCapabilities";

type RecordDto = { id: string; version: number; data: Record<string, unknown> };

function computeLevels(workflow: EntityWorkflow): Map<string, number> {
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

function groupByLevel(levels: Map<string, number>): string[][] {
  const maxLevel = Math.max(...levels.values());
  const columns: string[][] = Array.from({ length: maxLevel + 1 }, (): string[] => []);
  for (const [state, level] of levels) {
    columns[level]?.push(state);
  }
  return columns;
}

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
      <Button variant="ghost" size="sm" onClick={() => setShowBar((v) => !v)}>
        {showBar ? t("workflow.hide") : t("workflow.show")}
      </Button>

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

      {availableTransitions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("workflow.noActions")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {availableTransitions.map((transition) => {
            const info = transitionInfo.get(transition.action);
            const blocked = info ? !info.available : false;
            const pending = pendingAction === transition.action;
            const button = (
              <Button
                onClick={() => void handleTransition(transition.action)}
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
      )}
    </div>
  );
}
