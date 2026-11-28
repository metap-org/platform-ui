import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useConfirm } from "../shell/useConfirm";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Alert,
  buttonVariants,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Select,
  Spinner,
  toast,
} from "@metap/ui";
import {
  deleteRecord,
  fetchAllRecords,
  useRecordPage,
  useInvalidateRecords,
  type ApiRecord,
} from "../api/records";
import { ApiError } from "../api/client";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { ReferencedByErrorMessage } from "../api/ReferencedByErrorMessage";
import { FieldValue } from "../field/FieldValue";
import { useEntity } from "../metadata/useEntity";
import { useEntityLabels } from "../i18n/useEntityLabels";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { DataList, type DataListColumn, type DataListSort } from "./DataList";

type RecordDto = ApiRecord;

type SortState = DataListSort;

/** Page sizes offered in the footer; only those the list view's `maxLimit` allows are shown. */
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 25;
/** URL params this list owns besides per-field filters, so hydration never mistakes them for one. */
const RESERVED_URL_PARAMS = new Set(["sort", "limit", "cursor", "q", "page", "size", "tab"]);

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
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
      className="h-5 w-5"
    >
      <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6h16z" />
    </svg>
  );
}

/** Same key as before `DataList` existed, so columns a user already hid stay hidden. Per entity
 *  and list view: a hidden set saved under one entity's `"default"` view must not leak into
 *  another entity's view of the same name. */
function hiddenColumnsStorageKey(entityName: string, listViewName: string): string {
  return `platform-ui.list.hiddenColumns.${entityName}.${listViewName}`;
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
 *  via `fetchAllRecords` (cursor pagination at the server's own max page size, 200, until
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
  const allRecords = await fetchAllRecords(entityName, filters, sortParam, onProgress);
  formatAndDownloadRecords(format, entityName, fields, allRecords);
}

/** `sort`/filter params double as this route's shareable URL state (feature 23,
 *  `docs/features/23-ux-infrastructure-core.md`) — same key names the list query itself
 *  already uses, so there's one shape, not two. `limit`/`cursor` are deliberately excluded —
 *  scroll position isn't part of "deep link to this view". */
function parseSortParam(value: string | null): SortState {
  if (!value) return null;
  const descending = value.startsWith("-");
  const field = descending ? value.slice(1) : value;
  return field ? { field, descending } : null;
}

/** `SortState` -> the `"field"`/`"-field"` string convention every list-query call site
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
  /** Where the row's primary cell links to; turns the first visible column into a link. It is also
   *  where the row's "view" icon goes, so an entity with its own detail page never falls back to
   *  the generic record screen (and its generic edit form). */
  rowHref?: (record: ApiRecord) => string;
  /** Per-column cell renderers keyed by field name — a derived or styled cell without leaving the
   *  generated list. Return `undefined` to fall back to the default rendering for that row. */
  cellRenderers?: Record<string, (record: ApiRecord) => ReactNode | undefined>;
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
  const { confirm, confirmDialog } = useConfirm();
  const { entityLabel, fieldLabel } = useEntityLabels(entityName);
  const navAdapter = useNavigationAdapter();
  const invalidateRecords = useInvalidateRecords();
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
  const [deleteError, setDeleteError] = useState<ApiError | Error | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Selection is scoped to the rows on screen only, not "every record matching the current
  // filter": silently expanding a bulk delete to rows the user has never seen would be a surprise.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // "Export all" fetches from the API instead of using the loaded rows; `exportingAllFormat`
  // doubles as "is an export in flight" and "which format".
  const [exportingAllFormat, setExportingAllFormat] = useState<"csv" | "json" | null>(null);
  const [exportedSoFar, setExportedSoFar] = useState(0);

  const listView = entity?.listViews[0];
  const fieldsByName = useMemo(
    () => new Map((entity?.fields ?? []).map((field) => [field.name, field])),
    [entity],
  );

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
    // Only the list view's own filters: the server refuses any other, so a stray parameter in a
    // link (a tracking tag, a filter removed since) must not become one.
    const filterable = new Set(entity.listViews[0]?.filters ?? []);
    for (const [key, value] of searchParams.entries()) {
      if (RESERVED_URL_PARAMS.has(key) || !filterable.has(key)) continue;
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
  } = useRecordPage<Record<string, unknown>>(entityName, {
    filters: queryFilters,
    search: debouncedSearch,
    sort: sortParam,
    limit,
    page,
    enabled: Boolean(entity && listView),
  });

  const records = useMemo(() => pageData?.records ?? [], [pageData]);
  const total = pageData?.total ?? null;
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

  // Narrowed to plain values here, outside any nested function — TS's control-flow narrowing of
  // `listView`/`entity` from the guards above doesn't extend into nested closures.
  const listViewFields = listView.fields;
  const fieldDisplayHints = entity.fieldDisplayHints;
  const requiredFieldNames = new Set(listView.requiredFields ?? []);

  async function handleDelete(record: RecordDto) {
    if (!(await confirm(t("common.deleteConfirm")))) {
      return;
    }

    setDeleteError(null);
    setPendingDeleteId(record.id);
    try {
      await deleteRecord(entityName, record.id, record.version);
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

  async function handleBulkDelete() {
    if (!(await confirm(t("common.bulkDeleteConfirm", { count: selectedIds.size })))) {
      return;
    }

    // Only records still actually loaded — a selection surviving from before a refetch is dropped
    // rather than sent with a stale version.
    const targets = records.filter((record) => selectedIds.has(record.id));

    setDeleteError(null);
    setBulkDeleting(true);
    const results = await Promise.allSettled(
      targets.map((record) => deleteRecord(entityName, record.id, record.version)),
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
      const detail = reason instanceof ApiError ? reason.message : t("common.somethingWentWrong");
      setDeleteError(
        new Error(t("common.bulkDeletePartialError", { failed, total: results.length, detail })),
      );
    }

    // Clear regardless of partial failure — a failed row is still visible in the list (refetch
    // below), so the user can retry it individually.
    setSelectedIds(new Set());
    invalidateRecords();
    await refetch();
  }

  async function handleExportAll(format: "csv" | "json") {
    setDeleteError(null);
    setExportingAllFormat(format);
    setExportedSoFar(0);
    // Local, not just the `exportedSoFar` state: the `catch` below needs the count at the moment
    // of failure, which a state variable read from this closure would not have.
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
      const detail = error instanceof ApiError ? error.message : t("common.somethingWentWrong");
      toast(t("common.exportAllError", { count: fetchedCount, detail }), {
        variant: "destructive",
      });
    } finally {
      setExportingAllFormat(null);
      setExportedSoFar(0);
    }
  }

  function columnFilter(fieldName: string): ReactNode | undefined {
    if (!listViewFields.includes(fieldName) || !listView?.filters.includes(fieldName)) {
      return undefined;
    }
    const field = fieldsByName.get(fieldName);
    if (field?.kind === "enum") {
      return (
        <Select
          className="h-8 px-2 text-xs"
          placeholder={t("common.any")}
          options={(field.enumValues ?? []).map((value) => ({ value, label: value }))}
          value={enumFilters[fieldName] || undefined}
          onValueChange={(value) => {
            setEnumFilters((prev) => ({ ...prev, [fieldName]: value ?? "" }));
            setPage(1);
          }}
        />
      );
    }
    return (
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
    );
  }

  const columns: DataListColumn<RecordDto>[] = listViewFields.map((fieldName) => {
    const field = fieldsByName.get(fieldName);
    return {
      key: fieldName,
      header: field ? fieldLabel(field.name, field.label) : "",
      label: field ? fieldLabel(field.name, field.label) : fieldName,
      sortable: Boolean(field?.sortable),
      required: requiredFieldNames.has(fieldName),
      filter: columnFilter(fieldName),
      cell: (record) => {
        const custom = cellRenderers?.[fieldName]?.(record);
        if (custom !== undefined) return custom;
        return field ? (
          <FieldValue
            field={field}
            value={record.data[fieldName]}
            relatedDisplay={record.relatedDisplay}
            entityName={entityName}
            fieldDisplayHints={fieldDisplayHints}
          />
        ) : null;
      },
    };
  });

  const recordDeletable = (record: RecordDto) =>
    canDelete && record.capabilities?.canDelete !== false;

  return (
    <>
      <DataList
        title={title ?? entityLabel(entity.label)}
        rows={records}
        getRowId={(record) => record.id}
        columns={columns}
        loading={recordsLoading}
        error={recordsError}
        search={
          hasSearch
            ? {
                value: searchInput,
                onChange: (value) => {
                  setSearchInput(value);
                  setPage(1);
                },
              }
            : undefined
        }
        filtersActive={Object.keys(activeFilters).length > 0}
        onRefresh={() => void refetch()}
        refreshing={isFetching}
        columnVisibilityKey={hiddenColumnsStorageKey(entityName, listView.name)}
        sort={sort}
        onSortChange={(next) => {
          setPage(1);
          setSort(next);
        }}
        toolbar={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* `title` states the "loaded rows only" scope up front. */}
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
                  onSelect={() => exportLoadedRecords("csv", entityName, listViewFields, records)}
                >
                  {t("common.exportCsv")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={exportingAllFormat !== null}
                  onSelect={() => exportLoadedRecords("json", entityName, listViewFields, records)}
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
          </>
        }
        banner={
          deleteError ? (
            <Alert variant="destructive" className="flex items-start justify-between gap-2">
              {deleteError instanceof ApiError &&
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
          ) : null
        }
        selection={{
          selectedIds,
          onChange: setSelectedIds,
          isSelectable: recordDeletable,
          actions: (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              loading={bulkDeleting}
              onClick={() => void handleBulkDelete()}
            >
              {t("common.bulkDelete", { count: selectedIds.size })}
            </Button>
          ),
        }}
        rowActions={(record) => {
          const deleting = pendingDeleteId === record.id;
          return (
            <>
              {/* A router link styled as a ghost icon button; `!`-important because the classes are
                concatenated after `buttonVariants` without `cn()`'s conflict resolution. */}
              <navAdapter.Link
                to={rowHref ? rowHref(record) : navAdapter.toRecordDetail(entityName, record.id)}
                className={`${buttonVariants({ variant: "ghost" })} !h-7 !w-7 !p-0`}
                aria-label={t("common.view")}
                title={t("common.view")}
              >
                <EyeIcon />
              </navAdapter.Link>
              {recordDeletable(record) ? (
                <IconButton
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  aria-label={t("common.delete")}
                  title={t("common.delete")}
                  disabled={pendingDeleteId !== null && !deleting}
                  onClick={() => void handleDelete(record)}
                  icon={deleting ? <Spinner size="sm" /> : <TrashIcon />}
                />
              ) : null}
            </>
          );
        }}
        wrapPrimaryCell={
          rowHref
            ? (record, cell) => (
                <navAdapter.Link to={rowHref(record)} className="font-medium hover:underline">
                  {cell}
                </navAdapter.Link>
              )
            : undefined
        }
        paging={{
          page,
          pageSize: limit,
          total,
          onPageChange: setPage,
          pageSizeOptions,
          onPageSizeChange: (size) => {
            setPageSize(size);
            setPage(1);
          },
        }}
      />
      {confirmDialog}
    </>
  );
}
