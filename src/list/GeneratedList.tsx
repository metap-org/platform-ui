import { useEffect, useMemo, useRef, useState } from "react";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@metap/ui";
import { useApiInfiniteQuery } from "../api/useApiInfiniteQuery";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { ApiError, apiFetch } from "../api/client";
import { FieldValue } from "../field/FieldValue";
import { useEntity } from "../metadata/useEntity";
import type { EntityField } from "../metadata/types";
import { useEntityLabels } from "../i18n/useEntityLabels";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type RecordDto = {
  id: string;
  code: string | null;
  status: string | null;
  version: number;
  data: Record<string, unknown>;
  /** Batch-resolved reference display labels for this row (`crates/metap-crud/src/dto.rs`'s
   *  `RecordDto.related_display`) — present only on a `list` response, keyed by reference field
   *  name. Passed straight through to `FieldValue` so a reference column never fires its own
   *  per-cell request; see `ReferenceFieldValue`'s doc comment for why. */
  relatedDisplay?: Record<string, string>;
};

type ListPage = {
  data: RecordDto[];
  page: { limit: number; nextCursor: string | null };
};

type SortState = { field: string; descending: boolean } | null;

const ROW_HEIGHT = 40;
/** Fixed width for the trailing "actions" column — everything else divides the remaining space
 *  evenly. `table-fixed` layout (below) only reads *this* row's cell widths to size every
 *  column; body cells don't need matching widths. */
const ACTIONS_COLUMN_WIDTH = 140;
/** Fixed width for the leading row-selection checkbox column, same reasoning as
 *  `ACTIONS_COLUMN_WIDTH` above. */
const SELECTION_COLUMN_WIDTH = 40;

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

/** Exports exactly the rows currently loaded in the virtualizer's `records` array — same "loaded
 *  rows only" scope already established for row-selection/bulk-delete (2026-09-04), not every
 *  record matching the current filter on the server. Column order/keys follow `listView.fields`. */
function exportLoadedRecords(
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

/** `sort`/filter params double as this route's shareable URL state (feature 23,
 *  `docs/features/23-ux-infrastructure-core.md`) — same key names the API request itself already
 *  uses (`baseParams` below), so there's one query-string shape, not two. `limit`/`cursor` are
 *  deliberately excluded — scroll position isn't part of "deep link to this view". */
function parseSortParam(value: string | null): SortState {
  if (!value) return null;
  const descending = value.startsWith("-");
  const field = descending ? value.slice(1) : value;
  return field ? { field, descending } : null;
}

export function GeneratedList({ entityName }: { entityName: string }) {
  const { t } = useTranslation();
  const { entityLabel, fieldLabel } = useEntityLabels(entityName);
  const navAdapter = useNavigationAdapter();
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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Selection is scoped to *loaded* rows only, not "every record matching the current filter" —
  // there is no server-side "select all N across pages" concept, and silently expanding a
  // selection to rows the user has never seen (via infinite scroll) is exactly the kind of
  // surprise a bulk-delete action shouldn't have.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  useEffect(() => {
    setHydratedFromUrl(false);
  }, [entityName]);

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

    const textFromUrl: Record<string, string> = {};
    const enumFromUrl: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key === "sort" || key === "limit" || key === "cursor") continue;
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
    if (sort) {
      next.set("sort", sort.descending ? `-${sort.field}` : sort.field);
    }
    for (const [key, value] of Object.entries(activeFilters)) {
      next.set(key, value);
    }
    setSearchParams(next);
    // `setSearchParams` intentionally excluded below: react-router hands back a new function
    // identity on every navigation, which would otherwise re-run this effect on the very write
    // it just performed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, activeFilters, hydratedFromUrl]);

  const baseParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(listView?.maxLimit ?? 30));
    if (sort) {
      params.set("sort", sort.descending ? `-${sort.field}` : sort.field);
    }
    for (const [key, value] of Object.entries(activeFilters)) {
      params.set(key, value);
    }
    return params;
  }, [listView, sort, activeFilters]);

  const {
    data,
    isLoading: recordsLoading,
    error: recordsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
    refetch,
  } = useApiInfiniteQuery<ListPage>(
    ["records", entityName, sort, activeFilters],
    (cursor) => {
      const params = new URLSearchParams(baseParams);
      if (cursor) {
        params.set("cursor", cursor);
      }
      return `/api/${entityName}?${params.toString()}`;
    },
    (lastPage) => lastPage.page.nextCursor,
    Boolean(entity && listView),
  );

  const records = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data]);

  // A changed entity/sort/filter set means an entirely different set of rows is about to render
  // — clear the selection rather than let it silently keep referencing rows no longer on screen.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [entityName, sort, activeFilters]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const lastVirtualIndex = virtualRows[virtualRows.length - 1]?.index;

  useEffect(() => {
    if (lastVirtualIndex === undefined) {
      return;
    }
    if (lastVirtualIndex >= records.length - 10 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [lastVirtualIndex, records.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

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

  function toggleSort(field: EntityField) {
    if (!field.sortable) {
      return;
    }

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
      await apiFetch(`/api/${entityName}/${record.id}`, {
        method: "DELETE",
        body: JSON.stringify({ version: record.version }),
      });
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
      await refetch();
    } catch (error) {
      setDeleteError(error instanceof ApiError ? error.message : t("common.somethingWentWrong"));
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
      targets.map((record) =>
        apiFetch(`/api/${entityName}/${record.id}`, {
          method: "DELETE",
          body: JSON.stringify({ version: record.version }),
        }),
      ),
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
      setDeleteError(t("common.bulkDeletePartialError", { failed, total: results.length, detail }));
    }

    // Clear regardless of partial failure — a failed row is still visible in the list (refetch
    // below), so the user can retry it individually via the row action rather than the bulk
    // selection silently narrowing to "just the ones that failed".
    setSelectedIds(new Set());
    await refetch();
  }

  const columnCount = listView.fields.length + 2;
  const allLoadedSelected = records.length > 0 && records.every((r) => selectedIds.has(r.id));
  const someLoadedSelected = records.some((r) => selectedIds.has(r.id));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {entityLabel(entity.label)}
        </h2>
        <div className="flex items-center gap-2">
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
              {/* `title` (not `aria-label` — the button has visible text) states the "loaded
                  rows only" scope up front, same disclosure this component already gives
                  row-selection/bulk-delete for the identical scope decision. */}
              <Button
                variant="outline"
                size="sm"
                disabled={records.length === 0}
                title={t("common.exportScopeHint")}
              >
                {t("common.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => exportLoadedRecords("csv", entityName, listView.fields, records)}
              >
                {t("common.exportCsv")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => exportLoadedRecords("json", entityName, listView.fields, records)}
              >
                {t("common.exportJson")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <navAdapter.Link
            to={navAdapter.toNewRecord(entityName)}
            className={buttonVariants({ variant: "default" })}
          >
            {t("common.new")}
          </navAdapter.Link>
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
        <Alert variant="destructive" className="flex items-center justify-between gap-2">
          <span>{deleteError}</span>
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
          {/* `table-fixed` — a virtualized body row is `position: absolute` (below), which takes
              it out of normal flow entirely; the browser's default `table-layout: auto` sizes
              columns only from rows still in flow, so with every body row absolute it would size
              columns from the header alone and body cells wouldn't line up under them at all.
              `table-fixed` sizes columns once, from this component's first row (the label row
              right below), and every other row — filter row, every virtualized data row — just
              inherits those widths, keeping header and body aligned regardless of how rows are
              positioned. */}
          {/* `min-w` forces horizontal scroll on a narrow viewport instead of `table-fixed`
              squeezing every column unreadably thin — `docs/features/23-ux-infrastructure-core.md`'s
              responsive gap; the scroll container above already has `overflow-auto`. */}
          <Table className="table-fixed min-w-[720px]">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead style={{ width: SELECTION_COLUMN_WIDTH }}>
                  <Checkbox
                    aria-label={t("common.selectAllLoaded")}
                    checked={allLoadedSelected}
                    indeterminate={someLoadedSelected && !allLoadedSelected}
                    onCheckedChange={toggleAllLoadedSelected}
                  />
                </TableHead>
                {listView.fields.map((fieldName) => {
                  const field = fieldsByName.get(fieldName);

                  if (!field) {
                    return <TableHead key={fieldName} />;
                  }

                  const active = sort?.field === fieldName;

                  return (
                    <TableHead
                      key={fieldName}
                      onClick={() => toggleSort(field)}
                      className={`text-xs font-semibold uppercase tracking-wide text-muted-foreground${field.sortable ? " cursor-pointer select-none hover:text-foreground" : ""}`}
                    >
                      {fieldLabel(field.name, field.label)}
                      {active ? (
                        <SortIndicator direction={sort.descending ? "desc" : "asc"} />
                      ) : null}
                    </TableHead>
                  );
                })}
                <TableHead
                  style={{ width: ACTIONS_COLUMN_WIDTH }}
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {t("common.actions")}
                </TableHead>
              </TableRow>
              <TableRow className="bg-muted/40">
                <TableHead />
                {listView.fields.map((fieldName) => {
                  if (!listView.filters.includes(fieldName)) {
                    return <TableHead key={fieldName} />;
                  }

                  const field = fieldsByName.get(fieldName);

                  if (field?.kind === "enum") {
                    return (
                      <TableHead key={fieldName}>
                        <Select
                          className="h-8 px-2 text-xs"
                          placeholder={t("common.any")}
                          options={(field.enumValues ?? []).map((value) => ({
                            value,
                            label: value,
                          }))}
                          value={enumFilters[fieldName] || undefined}
                          onValueChange={(value) =>
                            setEnumFilters((prev) => ({ ...prev, [fieldName]: value ?? "" }))
                          }
                        />
                      </TableHead>
                    );
                  }

                  return (
                    <TableHead key={fieldName}>
                      <Input
                        className="h-8 px-2 text-xs"
                        placeholder={t("common.filterPlaceholder")}
                        value={filterInputs[fieldName] ?? ""}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setFilterInputs((prev) => ({ ...prev, [fieldName]: value }));
                        }}
                      />
                    </TableHead>
                  );
                })}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
              {recordsLoading ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="py-10 text-center">
                    <Spinner size="sm" />
                  </TableCell>
                </TableRow>
              ) : recordsError ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="py-10">
                    <ApiErrorMessage error={recordsError} />
                  </TableCell>
                </TableRow>
              ) : records.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columnCount}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {t("common.noRecords")}
                  </TableCell>
                </TableRow>
              ) : (
                virtualRows.map((virtualRow) => {
                  const record = records[virtualRow.index];

                  if (!record) {
                    return null;
                  }

                  return (
                    <TableRow
                      key={record.id}
                      className="absolute w-full hover:bg-muted/30"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <TableCell style={{ width: SELECTION_COLUMN_WIDTH }}>
                        <Checkbox
                          aria-label={t("common.selectRow")}
                          checked={selectedIds.has(record.id)}
                          onCheckedChange={(checked) => toggleRowSelected(record.id, checked)}
                        />
                      </TableCell>
                      {listView.fields.map((fieldName) => {
                        const field = fieldsByName.get(fieldName);

                        return (
                          <TableCell key={fieldName} className="truncate text-sm">
                            {field ? (
                              <FieldValue
                                field={field}
                                value={record.data[fieldName]}
                                relatedDisplay={record.relatedDisplay}
                                entityName={entityName}
                                fieldDisplayHints={entity.fieldDisplayHints}
                              />
                            ) : null}
                          </TableCell>
                        );
                      })}
                      <TableCell style={{ width: ACTIONS_COLUMN_WIDTH }}>
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <navAdapter.Link
                            to={navAdapter.toRecordDetail(entityName, record.id)}
                            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {t("common.view")}
                          </navAdapter.Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={pendingDeleteId !== null && pendingDeleteId !== record.id}
                            loading={pendingDeleteId === record.id}
                            onClick={() => void handleDelete(record)}
                          >
                            {t("common.delete")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {isFetchingNextPage ? (
          <div className="border-t border-border p-2 text-center text-sm text-muted-foreground">
            {t("common.loadingMore")}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
