import { create, useStore } from "zustand";
import { devtools } from "zustand/middleware";
import { temporal } from "zundo";

/**
 * Empty scaffold for the future low-code UI builder's canvas/selection/drag state — no builder UI
 * exists yet, this only lays the store foundation so that work has somewhere to land.
 *
 * Why Zustand here and not the rest of `platform-ui` (React Query + `useState`, no global store —
 * see `docs/architectures/04-strategy.md`'s ADR): the admin CRUD screens this package already
 * ships stay exactly as they are, untouched by this file. The builder's canvas/selection/drag
 * state is a different shape entirely — it needs per-field subscription to avoid re-rendering the
 * whole canvas tree during a 60fps drag, which plain Context can't give cheaply. Confirmed with
 * the project owner 2026-08-29 (`docs/audits/01-frontend-performance-audit.md`'s "Ghi chú định
 * hướng" section) and again 2026-08-31 (Redux was considered and rejected — Zustand needs no
 * `<Provider>`, so bundling it into this package doesn't force every consuming app, e.g.
 * `apps/crm-fe`/`apps/jira-fe`, to wire one up just to get the builder).
 *
 * `temporal` (zundo) gives undo/redo for free instead of a hand-rolled history stack; `devtools`
 * wires this into the Redux DevTools browser extension (works for any store, not just Redux) so
 * builder state is inspectable/time-travelable the same way a Redux store would have been.
 */
export type BuilderState = {
  // Canvas/selection/drag fields land here once the builder is actually built — intentionally
  // empty until there's a real consumer, same order `metap-storage`/`metap-cache` were added
  // ahead of their first concrete consumer in the backend.
};

const initialState: BuilderState = {};

export const useBuilderStore = create<BuilderState>()(
  devtools(
    temporal(() => initialState),
    { name: "builder-store" },
  ),
);

/** Reactive access to zundo's undo/redo controls (`undo`/`redo`/`clear`/`pastStates`/
 *  `futureStates`) — `useBuilderStore.temporal` is itself a vanilla Zustand store, so it's read
 *  through the library's own generic `useStore`, not a bespoke hook. */
export function useBuilderTemporalStore<T>(
  selector: (state: ReturnType<typeof useBuilderStore.temporal.getState>) => T,
): T {
  return useStore(useBuilderStore.temporal, selector);
}
