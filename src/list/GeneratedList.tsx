import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import {
  Alert,
  buttonVariants,
  Button,
  Card,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Pagination,
  Select,
  Spinner,
  toast,
} from "@metap/ui";
import {
  deleteGraphQLRecord,
  fetchAllGraphQLRecords,
  useGraphQLRecordPage,
  useInvalidateGraphQLRecords,
  type GraphQLRecord,
} from "../api/graphqlRecords";
import { GraphQLError } from "../api/graphqlClient";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { ReferencedByErrorMessage } from "../api/ReferencedByErrorMessage";
import { FieldValue } from "../field/FieldValue";
import { useEntity } from "../metadata/useEntity";
import type { EntityField } from "../metadata/types";
import { useEntityLabels } from "../i18n/useEntityLabels";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type RecordDto = GraphQLRecord;

type SortState = { field: string; descending: boolean } | null;

/** Page sizes offered in the footer; only those the list view's `maxLimit` allows are shown. */
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 25;
/** URL params this list owns besides per-field filters, so hydration never mistakes them for one. */
const RESERVED_URL_PARAMS = new Set(["sort", "limit", "cursor", "q", "page", "size", "tab"]);

/** Initial estimate only — `measureElement` (below) corrects this to each row's *real* rendered
 *  height once it mounts. A plain `40` here used to be treated as the row's actual height (rows
 *  positioned via `transform: translateY(index * 40px)`, never re-measured), but `TableCell`'s own
 *  `p-md` (1rem) top+bottom padding plus `text-sm` line-height renders closer to ~52px — every row
 *  was packed ~12px too close to the next, so each one's bottom edge sat under the row below it
 *  (found live 2026-09-05, reported as rows "overlapping"/"cut off"). Kept close to that real
 *  number so the very first paint (before any row has been measured) doesn't visibly jump. */
const ROW_HEIGHT = 52;
/** Fixed width for the trailing "actions" column — everything else divides the remaining space
 *  evenly. `table-fixed` layout (below) only reads *this* row's cell widths to size every
 *  column; body cells don't need matching widths. */
const ACTIONS_COLUMN_WIDTH = 140;
/** Fixed width for the leading row-selection checkbox column, same reasoning as
 *  `ACTIONS_COLUMN_WIDTH` above. */
const SELECTION_COLUMN_WIDTH = 40;

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Bumped from h-4 w-4 (found live 2026-09-06 — read as too small next to the row it sits
      // in) to h-5 w-5, matching TrashIcon right beside it so the pair stays visually balanced.
      className="h-5 w-5"
    >
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Matches EyeIcon right beside it — see that icon's doc comment.
      className="h-5 w-5"
    >
      <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6h16z" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M4 4h16l-6 8v6l-4 2v-8z" />
    </svg>
  );
}

function ColumnsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  );
}

/** Per-entity, per-list-view — a hidden set saved under one entity's `"default"` view would
 *  otherwise leak into a different view sharing that same name on another entity. */
function hiddenColumnsStorageKey(entityName: string, listViewName: string): string {
  return `platform-ui.list.hiddenColumns.${entityName}.${listViewName}`;
}

/** Stores the *hidden* set, not the visible one — a field the entity's metadata adds to this list
 *  view later (never seen by an old save) comes back as shown by default, same as if the toggle
 *  had never been touched at all, rather than silently staying hidden. Swallows a blocked/private
 *  `localStorage` (Safari private mode, `storage` disabled) — the toggle just doesn't persist. */
function loadHiddenColumns(entityName: string, listViewName: string): Set<string> {
  try {
    const raw = localStorage.getItem(hiddenColumnsStorageKey(entityName, listViewName));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function saveHiddenColumns(entityName: string, listViewName: string, hidden: Set<string>): void {
  try {
    localStorage.setItem(
      hiddenColumnsStorageKey(entityName, listViewName),
      JSON.stringify([...hidden]),
    );
  } catch {
    // best-effort only, see loadHiddenColumns's doc comment
  }
}

function SortIndicator({ direction }: { direction: "asc" | "desc" }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`ml-1 inline h-3 w-3 align-middle${direction === "asc" ? " rotate-180" : ""}`}
    >
      <path d="M3 5l3 3 3-3" />
    </svg>
  );
}

/** CSV cell escaping (RFC 4180-ish, enough for the ASCII-heavy metadata-driven values this
 *  produces): quote a value that contains a comma/quote/newline, doubling any embedded quote. */
function toCsvCell(value: unknown): string {
  const str =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Shared by both export modes below — `exportLoadedRecords` (rows already in memory) and
 *  `exportAllMatchingRecords` (rows fetched fresh from the server) both end up with the same
 *  `{data: Record<string, unknown>}[]` shape, so formatting/download only needs to be written once. */
function formatAndDownloadRecords(
  format: "csv" | "json",
  entityName: string,
  fields: string[],
  records: { data: Record<string, unknown> }[],
) {
  if (format === "csv") {
    const lines = [
      fields.map(toCsvCell).join(","),
      ...records.map((record) => fields.map((f) => toCsvCell(record.data[f])).join(",")),
    ];
    downloadTextFile(`${entityName}.csv`, lines.join("\n"), "text/csv;charset=utf-8;");
    return;
  }
  const rows = records.map((record) => {
    const row: Record<string, unknown> = {};
    for (const field of fields) {
      row[field] = record.data[field];
    }
    return row;
  });
  downloadTextFile(`${entityName}.json`, JSON.stringify(rows, null, 2), "application/json");
}

/** Exports exactly the rows currently loaded in the virtualizer's `records` array — same "loaded
 *  rows only" scope already established for row-selection/bulk-delete (2026-09-04), not every
 *  record matching the current filter on the server. Column order/keys follow `listView.fields`.
 *  See `exportAllMatchingRecords` below for the alternative "fetch everything from the API" mode
 *  (added 2026-09-06 — this loaded-only mode alone was surprising: "export" reads as "give me
 *  everything matching my filter", not "give me only what happened to scroll into view"). */
function exportLoadedRecords(
  format: "csv" | "json",
  entityName: string,
  fields: string[],
  records: { data: Record<string, unknown> }[],
) {
  formatAndDownloadRecords(format, entityName, fields, records);
}

/** Fetches *every* record matching the current filter/sort — not just what's scrolled into view —
 *  via `fetchAllGraphQLRecords` (cursor pagination at the server's own max page size, 200, until
 *  `nextCursor` comes back null). `onProgress` reports rows fetched so far so the caller can show
 *  something better than a frozen button on a large export. */
async function exportAllMatchingRecords(
  format: "csv" | "json",
  entityName: string,
  fields: string[],
  filters: Record<string, string | number | undefined>,
  sortParam: string | undefined,
  onProgress: (count: number) => void,
): Promise<void> {
  const allRecords = await fetchAllGraphQLRecords(entityName, filters, sortParam, onProgress);
  formatAndDownloadRecords(format, entityName, fields, allRecords);
}

/** `sort`/filter params double as this route's shareable URL state (feature 23,
 *  `docs/features/23-ux-infrastructure-core.md`) — same key names the GraphQL query itself
 *  already uses, so there's one shape, not two. `limit`/`cursor` are deliberately excluded —
 *  scroll position isn't part of "deep link to this view". */
function parseSortParam(value: string | null): SortState {
  if (!value) return null;
  const descending = value.startsWith("-");
  const field = descending ? value.slice(1) : value;
  return field ? { field, descending } : null;
}

/** `SortState` -> the `"field"`/`"-field"` string convention every GraphQL list-query call site
 *  here uses (mirrors what the URL/REST-era query param already looked like). */
function sortParamOf(sort: SortState): string | undefined {
  if (!sort) return undefined;
  return sort.descending ? `-${sort.field}` : sort.field;
}

/** What an application may customize without hand-building a list. Everything is optional: with no
 *  props the list is fully metadata-driven. Search, pagination, sorting, filters, permission-aware
 *  buttons and bulk actions stay the list's own, so an app screen never reimplements them. */
export type GeneratedListProps = {
  entityName: string;
  /** Replaces the entity label in the page heading. */
  title?: string;
  /** Extra controls in the toolbar, next to the built-in ones (e.g. an "Add zone" wizard link). */
  actions?: ReactNode;
  /** Where the row's primary cell links to; turns the first visible column into a link. */
  rowHref?: (record: GraphQLRecord) => string;
  /** Per-column cell renderers keyed by field name — a derived or styled cell without leaving the
   *  generated list. Return `undefined` to fall back to the default rendering for that row. */
  cellRenderers?: Record<string, (record: GraphQLRecord) => ReactNode | undefined>;
  /** Filters always applied (e.g. a zone's own id on its detail tab); not shown as editable. */
  baseFilters?: Record<string, string>;
  /** Where "New" goes (default: the generic create form); `null` hides it, for an entity created
   *  through its own flow (a wizard) rather than the plain form. Still permission-gated. */
  newHref?: string | null;
  /** Hides the New button and every delete control for a list that is read-only by design
   *  (e.g. a read model), independent of permissions. */
  readOnly?: boolean;
};

export function GeneratedList({
  entityName,
  title,
  actions,
  rowHref,
  cellRenderers,
  baseFilters,
  newHref,
  readOnly = false,
}: GeneratedListProps) {
  const { t } = useTranslation();
  const { entityLabel, fieldLabel } = useEntityLabels(entityName);
  const navAdapter = useNavigationAdapter();
  const invalidateRecords = useInvalidateGraphQLRecords();
  const { data: entity, isLoading: entityLoading, error: entityError } = useEntity(entityName);
  const [searchParams, setSearchParams] = useSearchParams();
  // Text filters are debounced (wait for the user to stop typing before refetching).
  const [filterInputs, setFilterInputs] = useState<Record<string, string>>({});
  // Enum filters come from a Select, not free text, so they refetch immediately on change.
  const [enumFilters, setEnumFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState>(null);
  // Gates the URL->state write-back effect below until the one-time state<-URL hydration for
  // *this* entity has actually run — without it, the write-back effect's first pass (same commit
  // as the hydration effect, before its `setState` calls have re-rendered) would clobber the URL
  // with the pre-hydration empty state. Reset per entity so navigating between 2 different
  // `/records/:entityName` routes re-hydrates from that entity's own URL instead of carrying the
  // previous entity's filters over.
  const [hydratedFromUrl, setHydratedFromUrl] = useState(false);
  const debouncedTextFilters = useDebouncedValue(filterInputs, 400);
  // Free-text search over the entity's searchable fields (server-side `search`), debounced like
  // the per-column text filters; page/size drive numbered pagination.
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 400).trim();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [deleteError, setDeleteError] = useState<GraphQLError | Error | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Selection is scoped to *loaded* rows only, not "every record matching the current filter" —
  // there is no server-side "select all N across pages" concept, and silently expanding a
  // selection to rows the user has never seen (via infinite scroll) is exactly the kind of
  // surprise a bulk-delete action shouldn't have.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Filter row starts collapsed — always-visible per-column filter inputs (found live 2026-09-05,
  // reported as "rườm rà"/cluttered) took a whole row of screen space and visual weight even when
  // nobody was filtering. Toggled from the toolbar; filtering itself (state, URL sync, the API
  // query) is unaffected by this — collapsing the row only hides the inputs, it doesn't clear them.
  const [showFilters, setShowFilters] = useState(false);
  // "Export all" (2026-09-06) fetches from the API instead of using the already-loaded `records`
  // array — `exportingAllFormat` doubles as both "is an export in flight" and "which format", so
  // the two menu items can independently show their own progress/spinner instead of one shared
  // boolean leaving it ambiguous which one is running.
  const [exportingAllFormat, setExportingAllFormat] = useState<"csv" | "json" | null>(null);
  const [exportedSoFar, setExportedSoFar] = useState(0);
  // Column-visibility toggle (2026-09-06, `docs/features/32-generated-list-column-visibility.md`)
  // — which of `listView.fields` the *user* has chosen to hide, persisted client-side only (never
  // synced to the backend/`preferences`, unlike locale). `requiredFields` (entity metadata) always
  // wins over this regardless of what's stored — see `visibleFields` below.
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(() => new Set());

  const listView = entity?.listViews[0];
  const fieldsByName = useMemo(
    () => new Map((entity?.fields ?? []).map((field) => [field.name, field])),
    [entity],
  );

  // Re-loads whenever the entity/list-view changes — a fresh `Set` per entity, not the previous
  // entity's hidden columns carried over by accident.
  useEffect(() => {
    if (!listView) return;
    setHiddenFields(loadHiddenColumns(entityName, listView.name));
  }, [entityName, listView]);

  const requiredFieldNames = useMemo(() => new Set(listView?.requiredFields ?? []), [listView]);

  // `requiredFieldNames.has(f)` overrides a stale/hand-edited `hiddenFields` entry — e.g. an
  // entity that adds a field to `requiredFields` after a user already hid it client-side.
  const visibleFields = useMemo(
    () => (listView?.fields ?? []).filter((f) => requiredFieldNames.has(f) || !hiddenFields.has(f)),
    [listView, requiredFieldNames, hiddenFields],
  );

  function toggleColumnVisibility(fieldName: string) {
    if (requiredFieldNames.has(fieldName) || !listView) return;
    setHiddenFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldName)) {
        next.delete(fieldName);
      } else {
        next.add(fieldName);
      }
      saveHiddenColumns(entityName, listView.name, next);
      return next;
    });
  }

  const activeFilters = useMemo(() => {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(debouncedTextFilters)) {
      if (value.trim().length > 0) {
        result[key] = value.trim();
      }
    }
    for (const [key, value] of Object.entries(enumFilters)) {
      if (value.trim().length > 0) {
        result[key] = value.trim();
      }
    }
    return result;
  }, [debouncedTextFilters, enumFilters]);

  // Filters the caller always applies, merged under what the user typed. Keyed by content so an
  // inline object literal from the caller does not look like a new filter set on every render.
  const baseFiltersKey = JSON.stringify(baseFilters ?? {});
  const queryFilters = useMemo(
    () => ({ ...(JSON.parse(baseFiltersKey) as Record<string, string>), ...activeFilters }),
    [baseFiltersKey, activeFilters],
  );

  // A different entity, or the same one under different base filters (another record's tab in a
  // `RecordWorkspace`), starts on page 1. This runs before the URL hydration effect below, so a
  // `?page=` in the URL still wins on first load.
  useEffect(() => {
    setHydratedFromUrl(false);
    setPage(1);
  }, [entityName, baseFiltersKey]);

  // One-time restore of sort/filter from the URL for this entity — needs `entity.fields` to know
  // which filter keys are enum (routes into `enumFilters`, a `Select`) vs. text (`filterInputs`,
  // debounced). Runs once per entity (`hydratedFromUrl` guard) so it never fights the write-back
  // effect below or re-runs on every subsequent `searchParams` change it itself causes.
  useEffect(() => {
    if (!entity || hydratedFromUrl) return;

    const sortFromUrl = parseSortParam(searchParams.get("sort"));
    if (sortFromUrl) {
      setSort(sortFromUrl);
    }

    setSearchInput(searchParams.get("q") ?? "");
    const pageFromUrl = Number(searchParams.get("page"));
    if (Number.isInteger(pageFromUrl) && pageFromUrl > 1) setPage(pageFromUrl);
    const sizeFromUrl = Number(searchParams.get("size"));
    if (PAGE_SIZE_OPTIONS.includes(sizeFromUrl)) setPageSize(sizeFromUrl);

    const textFromUrl: Record<string, string> = {};
    const enumFromUrl: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (RESERVED_URL_PARAMS.has(key)) continue;
      const field = entity.fields.find((f) => f.name === key);
      if (field?.kind === "enum") {
        enumFromUrl[key] = value;
      } else {
        textFromUrl[key] = value;
      }
    }
    if (Object.keys(textFromUrl).length > 0) {
      setFilterInputs(textFromUrl);
    }
    if (Object.keys(enumFromUrl).length > 0) {
      setEnumFilters(enumFromUrl);
    }
    setHydratedFromUrl(true);
  }, [entity, hydratedFromUrl, searchParams]);

  // Reflect current sort/filter into the URL once hydration above has settled — deep linking +
  // F5-survives-filter (`docs/features/23-ux-infrastructure-core.md`). Deliberately a plain push
  // (react-router's default), not `{ replace: true }`, so Back/Forward step through filter
  // history rather than skip it — filter changes are already debounced 400ms, so this doesn't
  // spam history per keystroke.
  useEffect(() => {
    if (!hydratedFromUrl) return;
    const next = new URLSearchParams();
    // `tab` belongs to a surrounding `RecordWorkspace`; rewriting the URL must not drop it.
    const tab = searchParams.get("tab");
    if (tab) next.set("tab", tab);
    if (sort) {
      next.set("sort", sort.descending ? `-${sort.field}` : sort.field);
    }
    for (const [key, value] of Object.entries(activeFilters)) {
      next.set(key, value);
    }
    if (debouncedSearch) next.set("q", debouncedSearch);
    if (page > 1) next.set("page", String(page));
    if (pageSize !== DEFAULT_PAGE_SIZE) next.set("size", String(pageSize));
    setSearchParams(next);
    // `setSearchParams` intentionally excluded below: react-router hands back a new function
    // identity on every navigation, which would otherwise re-run this effect on the very write
    // it just performed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, activeFilters, debouncedSearch, page, pageSize, hydratedFromUrl]);

  const sortParam = sortParamOf(sort);
  const maxLimit = listView?.maxLimit ?? 30;
  const pageSizeOptions = PAGE_SIZE_OPTIONS.filter((n) => n <= maxLimit);
  const limit = Math.min(pageSize, maxLimit);

  // A different search/filter/sort/size means a different row set, so each control that changes
  // one goes back to page 1 in its own handler. Not an effect on those values: the URL hydration
  // above sets them too, and an effect would then throw away the `?page=` it just restored.

  const {
    data: pageData,
    isLoading: recordsLoading,
    error: recordsError,
    isFetching,
    refetch,
  } = useGraphQLRecordPage<Record<string, unknown>>(entityName, {
    filters: queryFilters,
    search: debouncedSearch,
    sort: sortParam,
    limit,
    page,
    enabled: Boolean(entity && listView),
  });

  const records = useMemo(() => pageData?.records ?? [], [pageData]);
  const total = pageData?.total ?? null;
  const totalPages = total === null ? 1 : Math.max(1, Math.ceil(total / limit));
  // Entity-level permission from the list response: until it arrives nothing destructive is
  // offered. UI-only gating — the server re-checks every write regardless.
  const canCreate = !readOnly && newHref !== null && (pageData?.capabilities.canCreate ?? false);
  const canDelete = !readOnly && (pageData?.capabilities.canDelete ?? false);
  const hasSearch = (entity?.fields ?? []).some(
    (f) => f.searchable && (f.kind === "string" || f.kind === "enum"),
  );

  // A changed entity/sort/filter/search, or another page, means a different set of rows is about to
  // render — clear the selection rather than let a bulk delete reach rows no longer on screen.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [entityName, sort, queryFilters, debouncedSearch, page, pageSize]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    // Corrects `estimateSize`'s guess to each row's actual rendered height once it mounts —
    // without this, every row is packed exactly `ROW_HEIGHT` apart regardless of how tall it
    // really renders, which is what caused the overlap bug `ROW_HEIGHT`'s own doc comment
    // describes. `measureElement` (passed as `ref` below) and `data-index` (read here) are the
    // two halves of `@tanstack/react-virtual`'s own dynamic-measurement contract.
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  if (entityLoading) {
    return <Spinner />;
  }

  if (entityError) {
    return <ApiErrorMessage error={entityError} />;
  }

  if (!entity) {
    return <div>{t("common.entityNotFound")}</div>;
  }

  if (!listView) {
    return <div>{t("common.noListView", { label: entityLabel(entity.label) })}</div>;
  }

  // Narrowed to a plain `string[]` here, outside any nested function — TS's control-flow narrowing
  // of `listView` from the guard above doesn't extend into `handleExportAll`'s nested closure body.
  const listViewFields = listView.fields;

  function toggleSort(field: EntityField) {
    if (!field.sortable) {
      return;
    }

    setPage(1);
    setSort((current) => {
      if (!current || current.field !== field.name) {
        return { field: field.name, descending: false };
      }

      if (!current.descending) {
        return { field: field.name, descending: true };
      }

      return null;
    });
  }

  async function handleDelete(record: RecordDto) {
    if (!window.confirm(t("common.deleteConfirm"))) {
      return;
    }

    setDeleteError(null);
    setPendingDeleteId(record.id);
    try {
      await deleteGraphQLRecord(entityName, record.id, record.version);
      // Was silent on success (only `deleteError` below surfaced anything) — the row disappearing
      // from the list was the only feedback a delete had actually gone through.
      toast(t("common.deleteSuccess"));
      setSelectedIds((prev) => {
        if (!prev.has(record.id)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
      invalidateRecords();
      await refetch();
    } catch (error) {
      setDeleteError(error instanceof Error ? error : new Error(t("common.somethingWentWrong")));
    } finally {
      setPendingDeleteId(null);
    }
  }

  function toggleRowSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleAllLoadedSelected(checked: boolean) {
    setSelectedIds(checked ? new Set(records.map((r) => r.id)) : new Set());
  }

  async function handleBulkDelete() {
    if (!window.confirm(t("common.bulkDeleteConfirm", { count: selectedIds.size }))) {
      return;
    }

    // Only records still actually loaded — a selection surviving from before a refetch (there
    // shouldn't be one, given the effect above, but this keeps the loop from ever calling DELETE
    // with a stale/undefined version) is dropped rather than sent.
    const targets = records.filter((record) => selectedIds.has(record.id));

    setDeleteError(null);
    setBulkDeleting(true);
    const results = await Promise.allSettled(
      targets.map((record) => deleteGraphQLRecord(entityName, record.id, record.version)),
    );
    setBulkDeleting(false);

    const failed = results.filter((r) => r.status === "rejected").length;
    const succeeded = results.length - failed;

    if (succeeded > 0) {
      toast(t("common.bulkDeleteSuccess", { count: succeeded }));
    }
    if (failed > 0) {
      const firstError = results.find((r) => r.status === "rejected") as
        PromiseRejectedResult | undefined;
      const reason = firstError?.reason;
      const detail =
        reason instanceof GraphQLError ? reason.message : t("common.somethingWentWrong");
      setDeleteError(
        new Error(t("common.bulkDeletePartialError", { failed, total: results.length, detail })),
      );
    }

    // Clear regardless of partial failure — a failed row is still visible in the list (refetch
    // below), so the user can retry it individually via the row action rather than the bulk
    // selection silently narrowing to "just the ones that failed".
    setSelectedIds(new Set());
    invalidateRecords();
    await refetch();
  }

  async function handleExportAll(format: "csv" | "json") {
    setDeleteError(null);
    setExportingAllFormat(format);
    setExportedSoFar(0);
    // Local, not just the `exportedSoFar` state: the `catch` below needs the count *at the moment
    // of failure*, but a state variable read from this closure would still hold whatever it was
    // when `handleExportAll` started (0) — updates from `onProgress`'s `setExportedSoFar` calls
    // during the `await` below don't re-run this closure.
    let fetchedCount = 0;
    try {
      await exportAllMatchingRecords(
        format,
        entityName,
        listViewFields,
        queryFilters,
        sortParam,
        (count) => {
          fetchedCount = count;
          setExportedSoFar(count);
        },
      );
      toast(t("common.exportAllSuccess", { count: fetchedCount }));
    } catch (error) {
      const detail = error instanceof GraphQLError ? error.message : t("common.somethingWentWrong");
      toast(t("common.exportAllError", { count: fetchedCount, detail }), {
        variant: "destructive",
      });
    } finally {
      setExportingAllFormat(null);
      setExportedSoFar(0);
    }
  }

  // CSS Grid, not an actual `<table>` (found live 2026-09-05 — tried an explicit `calc()` width
  // on every `<td>` first, on top of the existing `table-fixed`; neither fixed it). Root cause:
  // a `<tr>`/`<td>` with `position: absolute` (required for virtualization — see the body row
  // below) is an internal-table-display box taken out of flow, which browsers "fix up" by
  // generating anonymous table wrappers around its cells — each cell effectively becomes its
  // own single-cell anonymous table, no longer sharing the real table's column grid *at all*,
  // explicit `width` or not. This is a real-table limitation, not a sizing mistake — every
  // virtualized-table implementation that needs a header to line up with absolutely-positioned
  // body rows (this library's own `react-virtual`, TanStack Table's virtualization guide) uses
  // `display: grid` rows instead of real `<table>` markup for exactly this reason: a grid child's
  // column comes from its parent's `grid-template-columns`, and unlike table layout, that isn't
  // disrupted by `position: absolute` on the child. `role="table"/"row"/"cell"` below replace the
  // semantic HTML `<table>` would otherwise have given for free.
  const gridTemplateColumns = `${SELECTION_COLUMN_WIDTH}px repeat(${visibleFields.length}, minmax(0, 1fr)) ${ACTIONS_COLUMN_WIDTH}px`;
  const allLoadedSelected = records.length > 0 && records.every((r) => selectedIds.has(r.id));
  const someLoadedSelected = records.some((r) => selectedIds.has(r.id));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {title ?? entityLabel(entity.label)}
        </h2>
        {hasSearch ? (
          <Input
            type="search"
            className="max-w-xs flex-1"
            aria-label={t("common.search")}
            placeholder={t("common.searchPlaceholder")}
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.currentTarget.value);
              setPage(1);
            }}
          />
        ) : null}
        <div className="flex items-center gap-2">
          <IconButton
            variant={showFilters || Object.keys(activeFilters).length > 0 ? "outline" : "ghost"}
            size="sm"
            aria-label={t("common.toggleFilters")}
            title={t("common.toggleFilters")}
            onClick={() => setShowFilters((prev) => !prev)}
            icon={<FilterIcon />}
          />
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={t("common.refresh")}
            disabled={isFetching}
            onClick={() => void refetch()}
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`h-4 w-4${isFetching ? " animate-spin" : ""}`}
              >
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={t("common.columns")}
                title={t("common.columns")}
                icon={<ColumnsIcon />}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("common.columns")}</DropdownMenuLabel>
              {listView.fields.map((fieldName) => {
                const field = fieldsByName.get(fieldName);
                const required = requiredFieldNames.has(fieldName);
                const label = field ? fieldLabel(field.name, field.label) : fieldName;
                return (
                  <DropdownMenuCheckboxItem
                    key={fieldName}
                    checked={!hiddenFields.has(fieldName) || required}
                    disabled={required}
                    title={required ? t("common.columnsRequiredHint", { label }) : undefined}
                    // Keeps the menu open across multiple toggles — a picker where checking one
                    // column closes the whole menu would make hiding/showing several columns in a
                    // row far more clicks than it needs to be.
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggleColumnVisibility(fieldName)}
                  >
                    {label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* `title` (not `aria-label` — the button has visible text) states the "loaded
                  rows only" scope up front, same disclosure this component already gives
                  row-selection/bulk-delete for the identical scope decision. */}
              <Button
                variant="outline"
                size="sm"
                disabled={exportingAllFormat !== null || records.length === 0}
                loading={exportingAllFormat !== null}
                title={
                  exportingAllFormat !== null
                    ? t("common.exportingAll", { count: exportedSoFar })
                    : t("common.exportScopeHint")
                }
              >
                {exportingAllFormat !== null
                  ? t("common.exportingAll", { count: exportedSoFar })
                  : t("common.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("common.exportLoadedGroup")}</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={exportingAllFormat !== null}
                onSelect={() => exportLoadedRecords("csv", entityName, listView.fields, records)}
              >
                {t("common.exportCsv")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={exportingAllFormat !== null}
                onSelect={() => exportLoadedRecords("json", entityName, listView.fields, records)}
              >
                {t("common.exportJson")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel title={t("common.exportAllScopeHint")}>
                {t("common.exportAllGroup")}
              </DropdownMenuLabel>
              <DropdownMenuItem
                disabled={exportingAllFormat !== null}
                onSelect={() => void handleExportAll("csv")}
              >
                {t("common.exportAllCsv")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={exportingAllFormat !== null}
                onSelect={() => void handleExportAll("json")}
              >
                {t("common.exportAllJson")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {actions}
          {canCreate ? (
            <navAdapter.Link
              to={newHref ?? navAdapter.toNewRecord(entityName)}
              className={buttonVariants({ variant: "default" })}
            >
              {t("common.new")}
            </navAdapter.Link>
          ) : null}
        </div>
      </div>
      {selectedIds.size > 0 ? (
        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/40 px-4 py-2">
          <span className="text-sm text-foreground">
            {t("common.selectedCount", { count: selectedIds.size })}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
              {t("common.clearSelection")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              loading={bulkDeleting}
              onClick={() => void handleBulkDelete()}
            >
              {t("common.bulkDelete", { count: selectedIds.size })}
            </Button>
          </div>
        </div>
      ) : null}
      {deleteError ? (
        <Alert variant="destructive" className="flex items-start justify-between gap-2">
          {deleteError instanceof GraphQLError &&
          deleteError.code === "record_referenced" &&
          deleteError.fieldErrors ? (
            <ReferencedByErrorMessage fieldErrors={deleteError.fieldErrors} />
          ) : (
            <span>{deleteError.message}</span>
          )}
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="Dismiss"
            onClick={() => setDeleteError(null)}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            }
          />
        </Alert>
      ) : null}
      <Card className="overflow-hidden">
        <div ref={scrollContainerRef} className="h-[calc(100vh-280px)] min-h-[420px] overflow-auto">
          {/* `min-w` forces horizontal scroll on a narrow viewport instead of every column
              squeezing unreadably thin — `docs/features/23-ux-infrastructure-core.md`'s
              responsive gap; the scroll container above already has `overflow-auto` (both axes). */}
          <div role="table" className="min-w-[720px] text-sm">
            <div role="rowgroup" className="sticky top-0 z-10 bg-card">
              <div
                role="row"
                className="grid border-b border-border"
                style={{ gridTemplateColumns }}
              >
                <div role="columnheader" className="flex h-10 items-center px-md">
                  {canDelete ? (
                    <Checkbox
                      aria-label={t("common.selectAllLoaded")}
                      checked={allLoadedSelected}
                      indeterminate={someLoadedSelected && !allLoadedSelected}
                      onCheckedChange={toggleAllLoadedSelected}
                    />
                  ) : null}
                </div>
                {visibleFields.map((fieldName) => {
                  const field = fieldsByName.get(fieldName);

                  if (!field) {
                    return <div key={fieldName} role="columnheader" className="h-10" />;
                  }

                  const active = sort?.field === fieldName;

                  return (
                    <div
                      key={fieldName}
                      role="columnheader"
                      onClick={() => toggleSort(field)}
                      className={`flex h-10 items-center truncate px-md text-xs font-semibold uppercase tracking-wide text-muted-foreground${field.sortable ? " cursor-pointer select-none hover:text-foreground" : ""}`}
                    >
                      {fieldLabel(field.name, field.label)}
                      {active ? (
                        <SortIndicator direction={sort.descending ? "desc" : "asc"} />
                      ) : null}
                    </div>
                  );
                })}
                <div
                  role="columnheader"
                  className="flex h-10 items-center px-md text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("common.actions")}
                </div>
              </div>
              {showFilters ? (
                <div
                  role="row"
                  className="grid border-b border-border bg-muted/40"
                  style={{ gridTemplateColumns }}
                >
                  <div role="columnheader" className="h-10" />
                  {visibleFields.map((fieldName) => {
                    if (!listView.filters.includes(fieldName)) {
                      return <div key={fieldName} role="columnheader" className="h-10" />;
                    }

                    const field = fieldsByName.get(fieldName);

                    if (field?.kind === "enum") {
                      return (
                        <div
                          key={fieldName}
                          role="columnheader"
                          className="flex h-10 items-center px-md"
                        >
                          <Select
                            className="h-8 px-2 text-xs"
                            placeholder={t("common.any")}
                            options={(field.enumValues ?? []).map((value) => ({
                              value,
                              label: value,
                            }))}
                            value={enumFilters[fieldName] || undefined}
                            onValueChange={(value) => {
                              setEnumFilters((prev) => ({ ...prev, [fieldName]: value ?? "" }));
                              setPage(1);
                            }}
                          />
                        </div>
                      );
                    }

                    return (
                      <div
                        key={fieldName}
                        role="columnheader"
                        className="flex h-10 items-center px-md"
                      >
                        <Input
                          className="h-8 px-2 text-xs"
                          placeholder={t("common.filterPlaceholder")}
                          value={filterInputs[fieldName] ?? ""}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setFilterInputs((prev) => ({ ...prev, [fieldName]: value }));
                            setPage(1);
                          }}
                        />
                      </div>
                    );
                  })}
                  <div role="columnheader" className="h-10" />
                </div>
              ) : null}
            </div>
            <div
              role="rowgroup"
              className="relative"
              style={{ height: rowVirtualizer.getTotalSize() }}
            >
              {recordsLoading ? (
                <div role="row">
                  <div role="cell" className="py-10 text-center">
                    <Spinner size="sm" />
                  </div>
                </div>
              ) : recordsError ? (
                <div role="row">
                  <div role="cell" className="py-10">
                    <ApiErrorMessage error={recordsError} />
                  </div>
                </div>
              ) : records.length === 0 ? (
                <div role="row">
                  <div role="cell" className="py-10 text-center text-sm text-muted-foreground">
                    {t("common.noRecords")}
                  </div>
                </div>
              ) : (
                virtualRows.map((virtualRow) => {
                  const record = records[virtualRow.index];

                  if (!record) {
                    return null;
                  }

                  const deleting = pendingDeleteId === record.id;

                  return (
                    <div
                      key={record.id}
                      role="row"
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      // Zebra striping (found live 2026-09-05 — dense generated tables were hard
                      // to scan row-to-row without one) — on top of `hover:bg-muted/30`, not
                      // instead of it, so a hovered row still reads clearly regardless of parity.
                      className={`absolute grid w-full border-b border-border transition-colors hover:bg-muted/30${virtualRow.index % 2 === 1 ? " bg-muted/10" : ""}`}
                      style={{
                        transform: `translateY(${virtualRow.start}px)`,
                        gridTemplateColumns,
                      }}
                    >
                      <div role="cell" className="flex items-center px-md py-md">
                        {canDelete && record.capabilities?.canDelete !== false ? (
                          <Checkbox
                            aria-label={t("common.selectRow")}
                            checked={selectedIds.has(record.id)}
                            onCheckedChange={(checked) => toggleRowSelected(record.id, checked)}
                          />
                        ) : null}
                      </div>
                      {visibleFields.map((fieldName) => {
                        const field = fieldsByName.get(fieldName);

                        return (
                          <div
                            key={fieldName}
                            role="cell"
                            className="flex items-center truncate px-md py-md text-sm"
                          >
                            {(() => {
                              const custom = cellRenderers?.[fieldName]?.(record);
                              const cell =
                                custom !== undefined ? (
                                  custom
                                ) : field ? (
                                  <FieldValue
                                    field={field}
                                    value={record.data[fieldName]}
                                    relatedDisplay={record.relatedDisplay}
                                    entityName={entityName}
                                    fieldDisplayHints={entity.fieldDisplayHints}
                                  />
                                ) : null;
                              return rowHref && fieldName === visibleFields[0] ? (
                                <navAdapter.Link
                                  to={rowHref(record)}
                                  className="font-medium hover:underline"
                                >
                                  {cell}
                                </navAdapter.Link>
                              ) : (
                                cell
                              );
                            })()}
                          </div>
                        );
                      })}
                      <div role="cell" className="flex items-center px-md py-md">
                        {/* Icon buttons (found live 2026-09-05 — plain "View"/"Delete" text read
                            as a bare link, not an action) — `navAdapter.Link` still does the real
                            navigation, just styled to match `IconButton`'s ghost/sm look via the
                            same `buttonVariants` this file already uses for the toolbar's "New"
                            link, since an anchor/router-Link can't itself be an `IconButton`
                            (a `<button>`). `!h-9 !w-9 !p-0` (found live 2026-09-06 — the view icon
                            rendered as a barely-visible dot, `EyeIcon` clipped down by leftover
                            padding): plain string-concatenating extra classes after
                            `buttonVariants({ variant: "ghost" })` (default size, `h-10 px-md
                            py-sm`) skips the `cn()`/`tailwind-merge` step `IconButton` itself uses
                            — exactly the class-conflict `@metap/ui`'s `cn()` doc comment warns
                            about (`px-md py-sm` losing to a later `p-0` isn't guaranteed without
                            it), so both ended up applied and the icon's actual box was
                            `h-10 px-md py-sm` squeezed down to `w-9`, not the intended `36×36,
                            no padding`. `cn()` isn't exported from `@metap/ui` to fix this the
                            same way `IconButton` does, so `!`-important is the targeted fix here
                            instead of pulling in a new public export for one call site. */}
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <navAdapter.Link
                            to={navAdapter.toRecordDetail(entityName, record.id)}
                            className={`${buttonVariants({ variant: "ghost" })} !h-9 !w-9 !p-0`}
                            aria-label={t("common.view")}
                            title={t("common.view")}
                          >
                            <EyeIcon />
                          </navAdapter.Link>
                          {canDelete && record.capabilities?.canDelete !== false ? (
                            <IconButton
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              aria-label={t("common.delete")}
                              title={t("common.delete")}
                              disabled={pendingDeleteId !== null && !deleting}
                              onClick={() => void handleDelete(record)}
                              icon={deleting ? <Spinner size="sm" /> : <TrashIcon />}
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3">
          <span className="text-sm text-muted-foreground">
            {total === null
              ? t("common.rowsShown", { count: records.length })
              : t("common.rowsTotal", {
                  from: total === 0 ? 0 : (page - 1) * limit + 1,
                  to: (page - 1) * limit + records.length,
                  total,
                })}
          </span>
          <div className="flex items-center gap-3">
            {pageSizeOptions.length > 1 ? (
              <Select
                className="h-8 w-28 px-2 text-xs"
                aria-label={t("common.pageSize")}
                options={pageSizeOptions.map((n) => ({
                  value: String(n),
                  label: t("common.perPage", { count: n }),
                }))}
                value={String(limit)}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
              />
            ) : null}
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              previousLabel={t("common.previous")}
              nextLabel={t("common.next")}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
