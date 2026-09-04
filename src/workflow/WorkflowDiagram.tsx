import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@metap/ui";
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

/** Fixed CSS pixel height of the pan/zoom viewport — the canvas used to be `height: auto` (grow
 * to fit every row), which stopped working once nodes can be dragged anywhere: a viewport that
 * resizes to its content can't have panning, there'd be nothing to pan within. `width` stays
 * responsive (`100%` of the dialog), only `height` is fixed. */
const VIEWPORT_HEIGHT = 420;
const MIN_SCALE = 0.3;
const MAX_SCALE = 3;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

type ViewTransform = { scale: number; tx: number; ty: number };

/** Keeps the diagram's `(width, height)` box centred and fully visible in a `containerWidth x
 * VIEWPORT_HEIGHT` viewport, never upscaled past 1:1 — same fit `maxWidth: 100%` used to give a
 * static SVG, recomputed here so the "reset view" button can restore it after a pan/zoom/drag. */
function fitView(
  containerWidth: number,
  diagramWidth: number,
  diagramHeight: number,
): ViewTransform {
  const scale = Math.min(1, containerWidth / diagramWidth, VIEWPORT_HEIGHT / diagramHeight);
  return {
    scale,
    tx: (containerWidth - diagramWidth * scale) / 2,
    ty: (VIEWPORT_HEIGHT - diagramHeight * scale) / 2,
  };
}

/** Rescales `view` so the world point under `(px, py)` (viewport-local CSS pixels) stays under
 * the cursor after the zoom — the standard "zoom to cursor" formula, used by both wheel-zoom and
 * the +/- buttons (which zoom around the viewport's centre instead of a cursor position). */
function zoomAt(view: ViewTransform, px: number, py: number, factor: number): ViewTransform {
  const nextScale = clampScale(view.scale * factor);
  const worldX = (px - view.tx) / view.scale;
  const worldY = (py - view.ty) / view.scale;
  return { scale: nextScale, tx: px - worldX * nextScale, ty: py - worldY * nextScale };
}

type DragState =
  | { kind: "pan"; startClientX: number; startClientY: number; startTx: number; startTy: number }
  | { kind: "node"; state: string; startClientX: number; startClientY: number; startOffset: Point };

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

  const {
    positions: basePositions,
    width,
    height,
  } = useMemo(() => {
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

  // A per-node drag nudges it off `basePositions`' BFS-column layout — reset whenever the
  // workflow itself changes so a stale offset from a previous entity's diagram can't leak in.
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, Point>>({});
  useEffect(() => setNodeOffsets({}), [workflow]);

  const positions = useMemo(() => {
    const map = new Map<string, NodePosition>();
    basePositions.forEach((pos, state) => {
      const offset = nodeOffsets[state];
      map.set(state, offset ? { x: pos.x + offset.x, y: pos.y + offset.y, col: pos.col } : pos);
    });
    return map;
  }, [basePositions, nodeOffsets]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef<DragState | null>(null);

  // Hovering a node or an edge highlights the pair — the node plus every edge touching it (and
  // each edge's own other endpoint), or an edge plus its 2 endpoints. Mutually exclusive: only 1
  // of the 2 is ever non-null, whichever the pointer is currently over.
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);

  // Fits the whole diagram in the viewport on first render and whenever the workflow's own size
  // changes (a different entity, or a transition/state added to this one) — same "reset view" the
  // toolbar button below offers, just automatic the moment there's a new layout to show.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    setView(fitView(el.clientWidth, width, height));
  }, [width, height]);

  // Native (non-React) listener: a synthetic React `onWheel` handler can't reliably
  // `preventDefault` a wheel event, since some browsers treat React's delegated listener as
  // passive — without it, zooming the diagram would also scroll the dialog behind it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setView((prev) => zoomAt(prev, e.clientX - rect.left, e.clientY - rect.top, factor));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  function zoomByButton(factor: number) {
    const el = containerRef.current;
    const cx = el ? el.clientWidth / 2 : 0;
    setView((prev) => zoomAt(prev, cx, VIEWPORT_HEIGHT / 2, factor));
  }

  function resetView() {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    setView(fitView(el.clientWidth, width, height));
  }

  // Pan: pointer-down on the canvas background (a node's own handler below calls
  // `stopPropagation`, so this only fires for the background itself).
  function handleCanvasPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "pan",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startTx: view.tx,
      startTy: view.ty,
    };
  }

  function handleCanvasPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== "pan") {
      return;
    }
    const tx = drag.startTx + (e.clientX - drag.startClientX);
    const ty = drag.startTy + (e.clientY - drag.startClientY);
    setView((prev) => ({ ...prev, tx, ty }));
  }

  function handleCanvasPointerUp() {
    if (dragRef.current?.kind === "pan") {
      dragRef.current = null;
    }
  }

  // Drag one node: screen-pixel delta is divided by the current zoom `scale` to get the diagram's
  // own coordinate units, so a drag tracks the cursor 1:1 regardless of zoom level.
  function handleNodePointerDown(e: React.PointerEvent<SVGGElement>, state: string) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "node",
      state,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffset: nodeOffsets[state] ?? { x: 0, y: 0 },
    };
  }

  function handleNodePointerMove(e: React.PointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== "node") {
      return;
    }
    e.stopPropagation();
    const dx = (e.clientX - drag.startClientX) / view.scale;
    const dy = (e.clientY - drag.startClientY) / view.scale;
    setNodeOffsets((prev) => ({
      ...prev,
      [drag.state]: { x: drag.startOffset.x + dx, y: drag.startOffset.y + dy },
    }));
  }

  function handleNodePointerUp(e: React.PointerEvent<SVGGElement>) {
    e.stopPropagation();
    if (dragRef.current?.kind === "node") {
      dragRef.current = null;
    }
  }

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

  /** `null` means nothing hovered — every node/edge renders at full opacity. Otherwise the exact
   * set to keep at full opacity; everything else dims (see the render passes below). */
  const highlight = useMemo(() => {
    if (hoveredNode) {
      const nodes = new Set<string>([hoveredNode]);
      const edgeKeys = new Set<string>();
      edges.forEach(({ key, transition }) => {
        if (transition.from === hoveredNode || transition.to === hoveredNode) {
          edgeKeys.add(key);
          nodes.add(transition.from);
          nodes.add(transition.to);
        }
      });
      return { nodes, edgeKeys };
    }
    if (hoveredEdgeKey) {
      const hovered = edges.find((edge) => edge.key === hoveredEdgeKey);
      if (!hovered) {
        return null;
      }
      return {
        nodes: new Set([hovered.transition.from, hovered.transition.to]),
        edgeKeys: new Set([hoveredEdgeKey]),
      };
    }
    return null;
  }, [hoveredNode, hoveredEdgeKey, edges]);

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

      <div
        ref={containerRef}
        className="relative touch-none overflow-hidden rounded-md border border-border"
        style={{ height: VIEWPORT_HEIGHT }}
      >
        <div className="absolute right-2 top-2 z-10 flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={t("workflow.zoomIn")}
            onClick={() => zoomByButton(1.2)}
          >
            +
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={t("workflow.zoomOut")}
            onClick={() => zoomByButton(1 / 1.2)}
          >
            −
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            aria-label={t("workflow.resetView")}
            onClick={resetView}
          >
            {t("workflow.resetView")}
          </Button>
        </div>

        {/* No `viewBox` — 1 SVG user unit = 1 CSS pixel, so screen-space pointer deltas from the
            pan/zoom/drag handlers need no extra unit conversion beyond dividing by `view.scale`.
            `width`/`height` here are the fixed viewport's, not the diagram's own (that's the `<g>`
            transform's job now, not the intrinsic SVG size). */}
        <svg
          width="100%"
          height={VIEWPORT_HEIGHT}
          className="block cursor-grab active:cursor-grabbing"
          role="group"
          aria-label={t("workflow.visualize")}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
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

          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
            {/* Pass 1 — every arrow, so no label or node can cut one in half. Each edge also
                carries an invisible, fatter `stroke="transparent"` copy of its own path purely as
                a hover hit-area — the visible line is only 1.5px wide, far too thin to reliably
                point at. */}
            {edges.map(({ key, transition, geometry }) => {
              const blocked = isBlocked(transition);
              const related = highlight ? highlight.edgeKeys.has(key) : true;
              return (
                <g
                  key={key}
                  role="img"
                  aria-label={`${transition.from} → ${transition.to}`}
                  className="cursor-pointer transition-opacity"
                  style={{ opacity: related ? 1 : 0.25 }}
                  onMouseEnter={() => setHoveredEdgeKey(key)}
                  onMouseLeave={() => setHoveredEdgeKey((prev) => (prev === key ? null : prev))}
                >
                  {blocked ? <title>{transitionInfo.get(transition.action)?.reason}</title> : null}
                  <path d={geometry.path} fill="none" stroke="transparent" strokeWidth={12} />
                  <path
                    d={geometry.path}
                    fill="none"
                    strokeWidth={hoveredEdgeKey === key ? 2.5 : 1.5}
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
                style={{ opacity: highlight && !highlight.edgeKeys.has(key) ? 0.25 : 1 }}
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
                dimmed={highlight ? !highlight.nodes.has(state) : false}
                onPointerDown={(e) => handleNodePointerDown(e, state)}
                onPointerMove={handleNodePointerMove}
                onPointerUp={handleNodePointerUp}
                onMouseEnter={() => setHoveredNode(state)}
                onMouseLeave={() => setHoveredNode((prev) => (prev === state ? null : prev))}
              />
            ))}
          </g>
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

/** 4-point orthogonal (Manhattan) route: straight from `p0` to `c1`, straight to `c2`, straight
 * to `p3` — no diagonals, only right angles, requested in place of the earlier cubic-Bézier
 * version (`docs/roadmap/xx-workflow-diagram-orthogonal-routing.md`). Each `edgeGeometry` case
 * below already places `c1`/`c2` so that every one of the 3 segments is purely horizontal or
 * purely vertical (same waypoints a curve would have used as control points, just connected with
 * straight lines instead of a spline) — this function itself has no opinion on that, it only
 * turns 4 points into an SVG path. Label sits at the midpoint of the `c1`-`c2` run (the one
 * segment that's usually clear of both node boxes), `labelDy` nudges it off the line itself. */
function orthogonal(p0: Point, c1: Point, c2: Point, p3: Point, labelDy: number): EdgeGeometry {
  const mid = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
  return {
    path: `M${p0.x},${p0.y} L${c1.x},${c1.y} L${c2.x},${c2.y} L${p3.x},${p3.y}`,
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
    // Rectangular loop over the top of the node: up from the top edge, across, back down —
    // already 3 axis-aligned segments, nothing to change for orthogonal routing. The old code
    // sent this through the backward-edge branch, where it collapsed into the node's own
    // bounding box and vanished completely (finding A3).
    const lift = 26 + ordinal * 10;
    const left = from.x + NODE_WIDTH * 0.32;
    const right = from.x + NODE_WIDTH * 0.68;
    return orthogonal(
      { x: left, y: from.y },
      { x: left, y: from.y - lift },
      { x: right, y: from.y - lift },
      { x: right, y: from.y },
      -6,
    );
  }

  if (to.col === from.col) {
    // Same column: out to the right, straight down/up through the inter-column gutter, back in —
    // the gutter offset keeps this clear of the next column's nodes, same as before.
    const gutterOffset = Math.min(COLUMN_GAP - 6, 30 + ordinal * 10);
    const x1 = from.x + NODE_WIDTH;
    const x2 = to.x + NODE_WIDTH;
    const y1 = from.y + NODE_HEIGHT / 2;
    const y2 = to.y + NODE_HEIGHT / 2;
    return orthogonal(
      { x: x1, y: y1 },
      { x: x1 + gutterOffset, y: y1 },
      { x: x2 + gutterOffset, y: y2 },
      { x: x2, y: y2 },
      // Successive routes differ by only 10px horizontally, which is not enough to keep their
      // labels apart — separate those vertically instead.
      ordinal * 13,
    );
  }

  if (to.col === from.col + 1) {
    // Adjacent columns: across, straight down/up through the gutter, across again. Parallel
    // edges used to fan out by nudging the middle run's Y off `y1`/`y2` (a gentle S-curve) — for
    // straight lines that would tilt the first/last segment off-axis, so they fan out along X
    // (where the vertical run sits inside the gutter) instead; each still lands on a distinct,
    // fully axis-aligned 3-segment path.
    const x1 = from.x + NODE_WIDTH;
    const x2 = to.x;
    const y1 = from.y + NODE_HEIGHT / 2;
    const y2 = to.y + NODE_HEIGHT / 2;
    const midX = (x1 + x2) / 2 + spread * Math.min(10, (COLUMN_GAP - 8) / 2);
    return orthogonal(
      { x: x1, y: y1 },
      { x: midX, y: y1 },
      { x: midX, y: y2 },
      { x: x2, y: y2 },
      -7,
    );
  }

  // Everything else — a backward edge, or a forward one that skips a column (which used to run
  // dead straight through whatever node sat in between, finding A4). Drop into the row gutter
  // below both nodes, run across, come back up into the target's bottom edge. Leaving and entering
  // through the bottom keeps the whole route clear of both boxes — already 3 axis-aligned
  // segments (down, across, up), nothing to change here either.
  const dip = Math.max(from.y, to.y) + NODE_HEIGHT + ROW_GAP / 2 + ordinal * 8;
  const x1 = from.x + NODE_WIDTH / 2;
  const x2 = to.x + NODE_WIDTH / 2;
  return orthogonal(
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
  dimmed,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onMouseEnter,
  onMouseLeave,
}: {
  state: string;
  pos: NodePosition;
  isCurrent: boolean;
  isInitial: boolean;
  isTerminal: boolean;
  dimmed: boolean;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGGElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const rectClassName = isCurrent
    ? "fill-primary stroke-primary"
    : "fill-background stroke-foreground";
  const textClassName = isCurrent ? "fill-primary-foreground" : "fill-foreground";

  return (
    <g
      className="cursor-grab transition-opacity active:cursor-grabbing"
      style={{ opacity: dimmed ? 0.3 : 1 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
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
