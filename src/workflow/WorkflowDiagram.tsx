import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { EntityWorkflow, WorkflowTransition } from "../metadata/types";
import type { TransitionAvailability } from "../detail/recordCapabilities";
import { computeLevels, groupByLevel } from "./layout";
import { TransitionButtons } from "./TransitionButtons";

const COLUMN_WIDTH = 220;
const ROW_HEIGHT = 76;
const NODE_WIDTH = 168;
const NODE_HEIGHT = 40;
const PADDING_X = 56;
const PADDING_Y = 28;

type NodePosition = { x: number; y: number; col: number };

/** Canvas view of a workflow: nodes laid out in `layout.ts`'s BFS columns, edges drawn per
 * `workflow.transitions`. Distinct from `WorkflowActionBar`'s flat badge row — this is the "draw
 * step -> step, start, end, blocked" view requested on top of it, not a replacement (the flat row
 * stays for the common case; this is behind an explicit "visualize" trigger). Renders inside a
 * `TooltipProvider` — see `field/FieldValue`'s doc comment (inherited via `TransitionButtons`). */
export function WorkflowDiagram({
  workflow,
  currentState,
  availableTransitions,
  transitionInfo,
  pendingAction,
  onTransition,
  transitionLabel,
}: {
  workflow: EntityWorkflow;
  currentState: string;
  availableTransitions: WorkflowTransition[];
  transitionInfo: Map<string, TransitionAvailability>;
  pendingAction: string | null;
  onTransition: (action: string) => void;
  transitionLabel: (action: string, fallback: string) => string;
}) {
  const { t } = useTranslation();
  const terminalStates = useMemo(() => new Set(workflow.terminalStates), [workflow]);

  const { positions, width, height } = useMemo(() => {
    const columns = groupByLevel(computeLevels(workflow));
    const map = new Map<string, NodePosition>();
    let maxRows = 1;
    columns.forEach((states, col) => {
      maxRows = Math.max(maxRows, states.length);
      states.forEach((state, row) => {
        map.set(state, {
          x: PADDING_X + col * COLUMN_WIDTH,
          y: PADDING_Y + row * ROW_HEIGHT,
          col,
        });
      });
    });
    return {
      positions: map,
      width: PADDING_X + columns.length * COLUMN_WIDTH,
      height: PADDING_Y + maxRows * ROW_HEIGHT,
    };
  }, [workflow]);

  const blockedActions = useMemo(() => {
    const blocked = new Set<string>();
    for (const [action, info] of transitionInfo) {
      if (!info.available) {
        blocked.add(action);
      }
    }
    return blocked;
  }, [transitionInfo]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <LegendSwatch
          className="border-2 border-foreground bg-background"
          label={t("workflow.legendStart")}
        />
        <LegendSwatch className="bg-primary" label={t("workflow.legendCurrent")} />
        <LegendSwatch
          className="border-2 border-foreground bg-background ring-2 ring-inset ring-background"
          label={t("workflow.legendEnd")}
        />
        <LegendSwatch
          className="border-2 border-dashed border-destructive bg-background"
          label={t("workflow.legendBlocked")}
        />
      </div>

      <div className="overflow-auto rounded-md border border-border">
        <svg width={width} height={height} role="img" aria-label={t("workflow.visualize")}>
          <defs>
            <marker
              id="workflow-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
            </marker>
            <marker
              id="workflow-arrow-blocked"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className="fill-destructive" />
            </marker>
          </defs>

          {workflow.transitions.map((transition) => {
            const from = positions.get(transition.from);
            const to = positions.get(transition.to);
            if (!from || !to) {
              return null;
            }
            const isFromCurrentState = transition.from === currentState;
            const blocked = isFromCurrentState && blockedActions.has(transition.action);
            return (
              <Edge
                key={transition.action}
                from={from}
                to={to}
                label={transitionLabel(transition.action, transition.label)}
                blocked={blocked}
                reason={blocked ? transitionInfo.get(transition.action)?.reason : undefined}
              />
            );
          })}

          {Array.from(positions.entries()).map(([state, pos]) => (
            <Node
              key={state}
              state={state}
              pos={pos}
              isCurrent={state === currentState}
              isInitial={state === workflow.initialState}
              isTerminal={terminalStates.has(state)}
            />
          ))}
        </svg>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          {t("workflow.currentStateActions", { state: currentState })}
        </p>
        <TransitionButtons
          availableTransitions={availableTransitions}
          transitionInfo={transitionInfo}
          pendingAction={pendingAction}
          onTransition={onTransition}
          transitionLabel={transitionLabel}
        />
      </div>
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

function Node({
  state,
  pos,
  isCurrent,
  isInitial,
  isTerminal,
}: {
  state: string;
  pos: NodePosition;
  isCurrent: boolean;
  isInitial: boolean;
  isTerminal: boolean;
}) {
  const rectClassName = isCurrent
    ? "fill-primary stroke-primary"
    : "fill-background stroke-foreground";
  const textClassName = isCurrent ? "fill-primary-foreground" : "fill-foreground";

  return (
    <g>
      {isInitial ? (
        <>
          <circle
            cx={pos.x - 24}
            cy={pos.y + NODE_HEIGHT / 2}
            r={3}
            className="fill-muted-foreground"
          />
          <line
            x1={pos.x - 24}
            y1={pos.y + NODE_HEIGHT / 2}
            x2={pos.x - 2}
            y2={pos.y + NODE_HEIGHT / 2}
            className="stroke-muted-foreground"
            strokeWidth={1.5}
            markerEnd="url(#workflow-arrow)"
          />
        </>
      ) : null}

      <rect
        x={pos.x}
        y={pos.y}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={6}
        strokeWidth={isCurrent ? 2.5 : 1.5}
        className={rectClassName}
      />
      {isTerminal ? (
        <rect
          x={pos.x + 4}
          y={pos.y + 4}
          width={NODE_WIDTH - 8}
          height={NODE_HEIGHT - 8}
          rx={4}
          fill="none"
          strokeWidth={1.5}
          className={isCurrent ? "stroke-primary-foreground" : "stroke-foreground"}
        />
      ) : null}
      <text
        x={pos.x + NODE_WIDTH / 2}
        y={pos.y + NODE_HEIGHT / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={12}
        fontWeight={isCurrent ? 600 : 400}
        className={textClassName}
      >
        {state}
      </text>
    </g>
  );
}

function Edge({
  from,
  to,
  label,
  blocked,
  reason,
}: {
  from: NodePosition;
  to: NodePosition;
  label: string;
  blocked: boolean;
  reason?: string;
}) {
  const forward = to.col > from.col;
  const x1 = forward ? from.x + NODE_WIDTH : from.x + NODE_WIDTH / 2;
  const y1 = forward ? from.y + NODE_HEIGHT / 2 : from.y + NODE_HEIGHT;
  const x2 = forward ? to.x : to.x + NODE_WIDTH / 2;
  const y2 = forward ? to.y + NODE_HEIGHT / 2 : to.y;
  const midX = forward ? (x1 + x2) / 2 : x1 + 60;
  const path = `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;

  const labelX = (x1 + x2) / 2;
  const labelY = (y1 + y2) / 2 - (forward ? 6 : 0);

  return (
    <g>
      {reason ? <title>{reason}</title> : null}
      <path
        d={path}
        fill="none"
        strokeWidth={1.5}
        strokeDasharray={blocked ? "4 3" : undefined}
        className={blocked ? "stroke-destructive" : "stroke-muted-foreground"}
        markerEnd={blocked ? "url(#workflow-arrow-blocked)" : "url(#workflow-arrow)"}
      />
      <rect
        x={labelX - label.length * 3 - 4}
        y={labelY - 8}
        width={label.length * 6 + 8}
        height={14}
        className="fill-background"
      />
      <text
        x={labelX}
        y={labelY - 1}
        textAnchor="middle"
        fontSize={10}
        className={blocked ? "fill-destructive" : "fill-muted-foreground"}
      >
        {label}
      </text>
    </g>
  );
}
