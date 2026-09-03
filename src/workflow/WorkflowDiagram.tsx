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
/** Tall enough to clear a self-loop's arc plus its label, which are drawn above the node's top
 * edge (see `selfLoopGeometry`). */
const PADDING_Y = 48;

/** Free space between two columns' node boxes (`220 - 168`) and between two rows' (`76 - 40`).
 * Every edge that can't run straight is routed through one of these gutters rather than across a
 * node — see `edgeGeometry`. */
const COLUMN_GAP = COLUMN_WIDTH - NODE_WIDTH;
const ROW_GAP = ROW_HEIGHT - NODE_HEIGHT;

type NodePosition = { x: number; y: number; col: number };
type Point = { x: number; y: number };
type EdgeGeometry = { path: string; labelX: number; labelY: number };

/** Canvas view of a workflow: nodes laid out in `layout.ts`'s BFS columns, edges drawn per
 * `workflow.transitions`. Distinct from `WorkflowActionBar`'s flat badge row — this is the "draw
 * step -> step, start, end, blocked" view requested on top of it, not a replacement (the flat row
 * stays for the common case; this is behind an explicit "visualize" trigger). Renders inside a
 * `TooltipProvider` — see `field/FieldValue`'s doc comment (inherited via `TransitionButtons`).
 *
 * Edge rendering is deliberately structured in three passes — every path, then every label, then
 * every node — because SVG has no `z-index`: paint order *is* stacking order. An earlier version
 * drew each edge's path and an opaque label background together in one pass, before the nodes,
 * which meant a later edge's label box erased an earlier edge's arrow and every node erased any
 * edge crossing it (`docs/audits/02-auth-permission-workflow-diagram-audit.md`, findings A1-A5).
 */
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

  /** One entry per transition, geometry resolved. `spread` fans apart transitions that share the
   * same `(from, to)` pair — without it they resolve to byte-identical paths and labels, so N
   * parallel transitions look like exactly one (finding A5). */
  const edges = useMemo(() => {
    // Keyed on the UNORDERED pair: `a -> b` and `b -> a` between two nodes in the same column both
    // resolve to the same sideways bow, so grouping by the ordered pair would leave each thinking
    // it was the only one and draw the two on top of each other, mirrored.
    const pairKey = (transition: WorkflowTransition) =>
      transition.from < transition.to
        ? `${transition.from}|${transition.to}`
        : `${transition.to}|${transition.from}`;

    const pairCounts = new Map<string, number>();
    for (const transition of workflow.transitions) {
      const pair = pairKey(transition);
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    }

    const pairSeen = new Map<string, number>();
    return workflow.transitions.flatMap((transition) => {
      const from = positions.get(transition.from);
      const to = positions.get(transition.to);
      if (!from || !to) {
        return [];
      }

      const pair = pairKey(transition);
      const seen = pairSeen.get(pair) ?? 0;
      pairSeen.set(pair, seen + 1);
      const spread = seen - ((pairCounts.get(pair) ?? 1) - 1) / 2;

      return [
        {
          // `action` alone is NOT unique across a workflow — the backend resolves a transition by
          // `(action, from_state)` (`metap-workflow`'s `find_transition`, and its
          // `find_transition_matches_on_action_and_from_state` test), so the same action name may
          // legitimately fire from several states (finding A6).
          key: `${transition.from}|${transition.to}|${transition.action}`,
          transition,
          geometry: edgeGeometry(from, to, spread, seen),
        },
      ];
    });
  }, [workflow, positions]);

  const blockedActions = useMemo(() => {
    const blocked = new Set<string>();
    for (const [action, info] of transitionInfo) {
      if (!info.available) {
        blocked.add(action);
      }
    }
    return blocked;
  }, [transitionInfo]);

  const isBlocked = (transition: WorkflowTransition) =>
    transition.from === currentState && blockedActions.has(transition.action);

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
        <svg
          // `viewBox` (plus the intrinsic size as a `max-width`) lets a wide graph scale down to
          // the dialog instead of only ever being reachable by horizontal scrolling.
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          style={{ maxWidth: "100%", height: "auto" }}
          role="group"
          aria-label={t("workflow.visualize")}
        >
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

          {/* Pass 1 — every arrow, so no label or node can cut one in half. */}
          {edges.map(({ key, transition, geometry }) => {
            const blocked = isBlocked(transition);
            return (
              <g key={key} role="img" aria-label={`${transition.from} → ${transition.to}`}>
                {blocked ? <title>{transitionInfo.get(transition.action)?.reason}</title> : null}
                <path
                  d={geometry.path}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray={blocked ? "4 3" : undefined}
                  className={blocked ? "stroke-destructive" : "stroke-muted-foreground"}
                  markerEnd={blocked ? "url(#workflow-arrow-blocked)" : "url(#workflow-arrow)"}
                />
              </g>
            );
          })}

          {/* Pass 2 — labels. A halo (`paintOrder="stroke"`) rather than an opaque background box:
              it hugs the glyphs instead of blanking out a 14px band, so an arrow passing under a
              label stays readable on both sides of it. */}
          {edges.map(({ key, transition, geometry }) => (
            <text
              key={key}
              x={geometry.labelX}
              y={geometry.labelY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={10}
              strokeWidth={3}
              paintOrder="stroke"
              strokeLinejoin="round"
              className={`stroke-background ${
                isBlocked(transition) ? "fill-destructive" : "fill-muted-foreground"
              }`}
            >
              {transitionLabel(transition.action, transition.label)}
            </text>
          ))}

          {/* Pass 3 — nodes last, so a box never swallows the arrow that points into it. */}
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

/** Point at `t=0.5` on a cubic Bézier — where a label sits so it tracks the curve it belongs to
 * instead of the straight line between the endpoints (which, for a routed edge, is nowhere near
 * the drawn path). */
function cubicMidpoint(p0: Point, c1: Point, c2: Point, p3: Point): Point {
  return {
    x: 0.125 * p0.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p3.x,
    y: 0.125 * p0.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p3.y,
  };
}

function curve(p0: Point, c1: Point, c2: Point, p3: Point, labelDy: number): EdgeGeometry {
  const mid = cubicMidpoint(p0, c1, c2, p3);
  return {
    path: `M${p0.x},${p0.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p3.x},${p3.y}`,
    labelX: mid.x,
    labelY: mid.y + labelDy,
  };
}

/**
 * Routes one edge so that no part of it is drawn over a node box. Four cases, picked by how the
 * two nodes sit relative to each other — the previous single formula had a backward edge's control
 * point at `from.x + 144` against a node `168` wide, i.e. *inside* the box it started from, which
 * put ~93% of that edge under a node (finding A2).
 *
 * Parallel edges (same `from` and `to`) are fanned apart by two different measures, because the
 * four routes are not all symmetric: `spread` is centred on `0` (`±0.5`, `±1`, ... outward both
 * ways) and suits the straight-across case, while `ordinal` counts `0, 1, 2, ...` and is what the
 * one-sided routes need — a bow that only ever bulges right, or a dip that only ever drops below,
 * would map `spread` `-0.5` and `+0.5` onto the very same curve if it took the magnitude.
 */
function edgeGeometry(
  from: NodePosition,
  to: NodePosition,
  spread: number,
  ordinal: number,
): EdgeGeometry {
  const selfLoop = from.x === to.x && from.y === to.y;

  if (selfLoop) {
    // Arc over the top of the node. The old code sent this through the backward-edge branch, where
    // it collapsed into the node's own bounding box and vanished completely (finding A3).
    const lift = 26 + ordinal * 10;
    const left = from.x + NODE_WIDTH * 0.32;
    const right = from.x + NODE_WIDTH * 0.68;
    return curve(
      { x: left, y: from.y },
      { x: left, y: from.y - lift },
      { x: right, y: from.y - lift },
      { x: right, y: from.y },
      -6,
    );
  }

  if (to.col === from.col) {
    // Same column: bow out to the right, staying inside the inter-column gutter so the bulge can't
    // reach the next column's nodes.
    const bow = Math.min(COLUMN_GAP - 6, 30 + ordinal * 10);
    const x1 = from.x + NODE_WIDTH;
    const x2 = to.x + NODE_WIDTH;
    const y1 = from.y + NODE_HEIGHT / 2;
    const y2 = to.y + NODE_HEIGHT / 2;
    return curve(
      { x: x1, y: y1 },
      { x: x1 + bow, y: y1 },
      { x: x2 + bow, y: y2 },
      { x: x2, y: y2 },
      // Successive bows differ by only 10px horizontally, which is not enough to keep their
      // labels apart — separate those vertically instead.
      ordinal * 13,
    );
  }

  if (to.col === from.col + 1) {
    // Adjacent columns: straight across the gutter. Both control points sit strictly between the
    // two node boxes, so this case was already safe — only the parallel-edge offset is new.
    const x1 = from.x + NODE_WIDTH;
    const x2 = to.x;
    const y1 = from.y + NODE_HEIGHT / 2;
    const y2 = to.y + NODE_HEIGHT / 2;
    const midX = (x1 + x2) / 2;
    const offset = spread * 12;
    return curve(
      { x: x1, y: y1 },
      { x: midX, y: y1 + offset },
      { x: midX, y: y2 + offset },
      { x: x2, y: y2 },
      -7,
    );
  }

  // Everything else — a backward edge, or a forward one that skips a column (which used to run
  // dead straight through whatever node sat in between, finding A4). Drop into the row gutter
  // below both nodes, run across, come back up into the target's bottom edge. Leaving and entering
  // through the bottom keeps the whole curve clear of both boxes.
  const dip = Math.max(from.y, to.y) + NODE_HEIGHT + ROW_GAP / 2 + ordinal * 8;
  const x1 = from.x + NODE_WIDTH / 2;
  const x2 = to.x + NODE_WIDTH / 2;
  return curve(
    { x: x1, y: from.y + NODE_HEIGHT },
    { x: x1, y: dip },
    { x: x2, y: dip },
    { x: x2, y: to.y + NODE_HEIGHT },
    // Pushed clear of the adjacent-column route's own label, which can land at a very similar
    // point when a forward edge and a return edge share the same column pair.
    12,
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
