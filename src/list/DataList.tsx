import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Pagination,
  Select,
  Spinner,
} from "@metap/ui";
import { ApiErrorMessage } from "../api/ApiErrorMessage";

/** One column of a `DataList`. `key` doubles as the column-visibility key and the sort field. */
export type DataListColumn<Row> = {
  key: string;
  header: ReactNode;
  /** Plain-text name for the column picker (defaults to `header` when it is a string). */
  label?: string;
  cell: (row: Row) => ReactNode;
  /** A fixed CSS width (`"9rem"`, `"140px"`); columns without one share the rest evenly. */
  width?: string;
  sortable?: boolean;
  /** Always shown: the column picker can't hide it. */
  required?: boolean;
  /** Control shown in the collapsible filter row under this column's header. */
  filter?: ReactNode;
};

export type DataListSort = { field: string; descending: boolean } | null;

export type DataListPaging = {
  page: number;
  pageSize: number;
  /** `null` when the source doesn't count matches; the footer then shows only the loaded rows. */
  total: number | null;
  onPageChange: (page: number) => void;
  /** Page sizes offered in the footer; omitted or a single option hides the picker. */
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
};

export type DataListSelection<Row> = {
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Rows that can't be selected get no checkbox. Defaults to every row. */
  isSelectable?: (row: Row) => boolean;
  /** Shown next to the selected count while anything is selected (e.g. a bulk delete). */
  actions?: ReactNode;
};

/** What every list screen shares, whatever its data source: heading, search, the filter-row
 *  toggle, refresh, the column picker, sorting, a virtualized dense table, row selection and
 *  numbered pagination. `GeneratedList` is this plus entity metadata; an admin screen backed by
 *  its own API (users, roles) passes its rows and columns directly, so both look and behave alike. */
export type DataListProps<Row> = {
  title: ReactNode;
  rows: Row[];
  getRowId: (row: Row) => string;
  columns: DataListColumn<Row>[];
  loading?: boolean;
  error?: unknown;
  emptyText?: ReactNode;
  search?: { value: string; onChange: (value: string) => void; placeholder?: string };
  /** Highlights the filter toggle while any column filter is applied. */
  filtersActive?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Persists hidden columns in `localStorage` under this key; omitted hides the column picker. */
  columnVisibilityKey?: string;
  sort?: DataListSort;
  onSortChange?: (sort: DataListSort) => void;
  /** Controls after the built-in toolbar buttons (export, "New", ...). */
  toolbar?: ReactNode;
  /** Shown between the toolbar and the table (e.g. an error from a row action). */
  banner?: ReactNode;
  selection?: DataListSelection<Row>;
  /** Trailing per-row controls; adds an actions column of `rowActionsWidth`. */
  rowActions?: (row: Row) => ReactNode;
  rowActionsWidth?: string;
  /** Makes the whole row clickable (e.g. to open a detail panel). */
  onRowClick?: (row: Row) => void;
  /** Wraps the first visible column's cell, e.g. in a link to the row's detail page. */
  wrapPrimaryCell?: (row: Row, cell: ReactNode) => ReactNode;
  paging?: DataListPaging;
  /** Height of the scrolling table body. */
  bodyClassName?: string;
};

/** Initial estimate only: `measureElement` corrects it to each row's real height once mounted.
 *  Compact rows since 2026-11-15 (`py-1.5` cells, `text-sm`, 28px row actions) are close to 40px. */
const ROW_HEIGHT = 40;
const SELECTION_COLUMN_WIDTH = "40px";

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

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4${spinning ? " animate-spin" : ""}`}
    >
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
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

/** Stores the *hidden* set, so a column added later shows by default. A blocked or private
 *  `localStorage` just means the choice doesn't persist. */
function loadHidden(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function saveHidden(key: string, hidden: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...hidden]));
  } catch {
    // best effort, see loadHidden
  }
}

/** Header click cycles a sortable column: ascending, descending, off. */
function nextSort(current: DataListSort, field: string): DataListSort {
  if (!current || current.field !== field) return { field, descending: false };
  if (!current.descending) return { field, descending: true };
  return null;
}

export function DataList<Row>({
  title,
  rows,
  getRowId,
  columns,
  loading = false,
  error,
  emptyText,
  search,
  filtersActive = false,
  onRefresh,
  refreshing = false,
  columnVisibilityKey,
  sort = null,
  onSortChange,
  toolbar,
  banner,
  selection,
  rowActions,
  rowActionsWidth = "140px",
  onRowClick,
  wrapPrimaryCell,
  paging,
  bodyClassName = "h-[calc(100vh-200px)] min-h-[320px]",
}: DataListProps<Row>) {
  const { t } = useTranslation();
  // The filter row starts collapsed: always-visible filter inputs cost a row of space even when
  // nobody filters. Collapsing only hides the inputs; applied filters stay applied.
  const [showFilters, setShowFilters] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setHidden(columnVisibilityKey ? loadHidden(columnVisibilityKey) : new Set());
  }, [columnVisibilityKey]);

  // A required column always shows, whatever an old saved choice says.
  const visibleColumns = useMemo(
    () => columns.filter((c) => c.required || !hidden.has(c.key)),
    [columns, hidden],
  );
  const hasFilters = columns.some((c) => c.filter !== undefined);

  function toggleColumn(key: string) {
    if (!columnVisibilityKey) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveHidden(columnVisibilityKey, next);
      return next;
    });
  }

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    measureElement: (el) => el.getBoundingClientRect().height,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  const isSelectable = (row: Row) => selection?.isSelectable?.(row) ?? true;
  const selectableIds = selection ? rows.filter(isSelectable).map(getRowId) : [];
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selection?.selectedIds.has(id));
  const someSelected = selectableIds.some((id) => selection?.selectedIds.has(id));

  function setRowSelected(id: string, checked: boolean) {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    selection.onChange(next);
  }

  // CSS grid rather than a real `<table>`: virtualized rows are `position: absolute`, which takes
  // a table row out of the table's column layout entirely; a grid child keeps the parent's
  // `grid-template-columns`. `role="table"/"row"/"cell"` restore the semantics.
  const gridTemplateColumns = [
    selection ? SELECTION_COLUMN_WIDTH : null,
    ...visibleColumns.map((c) => c.width ?? "minmax(0, 1fr)"),
    rowActions ? rowActionsWidth : null,
  ]
    .filter(Boolean)
    .join(" ");

  const total = paging?.total ?? null;
  const pageSize = paging?.pageSize ?? rows.length;
  const page = paging?.page ?? 1;
  const totalPages = total === null ? 1 : Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const pageSizeOptions = paging?.pageSizeOptions ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {search ? (
          <Input
            type="search"
            className="max-w-xs flex-1"
            aria-label={t("common.search")}
            placeholder={search.placeholder ?? t("common.searchPlaceholder")}
            value={search.value}
            onChange={(event) => search.onChange(event.currentTarget.value)}
          />
        ) : null}
        <div className="flex items-center gap-2">
          {hasFilters ? (
            <IconButton
              variant={showFilters || filtersActive ? "outline" : "ghost"}
              size="sm"
              aria-label={t("common.toggleFilters")}
              title={t("common.toggleFilters")}
              onClick={() => setShowFilters((prev) => !prev)}
              icon={<FilterIcon />}
            />
          ) : null}
          {onRefresh ? (
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={t("common.refresh")}
              disabled={refreshing}
              onClick={onRefresh}
              icon={<RefreshIcon spinning={refreshing} />}
            />
          ) : null}
          {columnVisibilityKey ? (
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
                {columns.map((column) => {
                  const label =
                    column.label ??
                    (typeof column.header === "string" ? column.header : column.key);
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.key}
                      checked={column.required || !hidden.has(column.key)}
                      disabled={column.required}
                      title={
                        column.required ? t("common.columnsRequiredHint", { label }) : undefined
                      }
                      // Keeps the menu open so several columns can be toggled in a row.
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={() => toggleColumn(column.key)}
                    >
                      {label}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {toolbar}
        </div>
      </div>
      {selection && selection.selectedIds.size > 0 ? (
        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/40 px-4 py-2">
          <span className="text-sm text-foreground">
            {t("common.selectedCount", { count: selection.selectedIds.size })}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => selection.onChange(new Set())}>
              {t("common.clearSelection")}
            </Button>
            {selection.actions}
          </div>
        </div>
      ) : null}
      {banner}
      <Card className="overflow-hidden">
        <div ref={scrollContainerRef} className={`${bodyClassName} overflow-auto`}>
          {/* `min-w` scrolls horizontally on a narrow viewport instead of squeezing every column. */}
          <div role="table" className="min-w-[720px] text-sm">
            <div role="rowgroup" className="sticky top-0 z-10 bg-card">
              <div
                role="row"
                className="grid border-b border-border"
                style={{ gridTemplateColumns }}
              >
                {selection ? (
                  <div role="columnheader" className="flex h-9 items-center px-md">
                    {selectableIds.length > 0 ? (
                      <Checkbox
                        aria-label={t("common.selectAllLoaded")}
                        checked={allSelected}
                        indeterminate={someSelected && !allSelected}
                        onCheckedChange={(checked) =>
                          selection.onChange(checked ? new Set(selectableIds) : new Set())
                        }
                      />
                    ) : null}
                  </div>
                ) : null}
                {visibleColumns.map((column) => {
                  const sortable = Boolean(column.sortable && onSortChange);
                  const active = sort?.field === column.key;
                  return (
                    <div
                      key={column.key}
                      role="columnheader"
                      aria-sort={
                        active ? (sort?.descending ? "descending" : "ascending") : undefined
                      }
                      onClick={
                        sortable ? () => onSortChange?.(nextSort(sort, column.key)) : undefined
                      }
                      className={`flex h-9 items-center truncate px-md text-xs font-semibold uppercase tracking-wide text-muted-foreground${sortable ? " cursor-pointer select-none hover:text-foreground" : ""}`}
                    >
                      {column.header}
                      {active && sort ? (
                        <SortIndicator direction={sort.descending ? "desc" : "asc"} />
                      ) : null}
                    </div>
                  );
                })}
                {rowActions ? (
                  <div
                    role="columnheader"
                    className="flex h-9 items-center px-md text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t("common.actions")}
                  </div>
                ) : null}
              </div>
              {showFilters && hasFilters ? (
                <div
                  role="row"
                  className="grid border-b border-border bg-muted/40"
                  style={{ gridTemplateColumns }}
                >
                  {selection ? <div role="columnheader" className="h-9" /> : null}
                  {visibleColumns.map((column) => (
                    <div
                      key={column.key}
                      role="columnheader"
                      className="flex h-9 items-center px-md"
                    >
                      {column.filter ?? null}
                    </div>
                  ))}
                  {rowActions ? <div role="columnheader" className="h-9" /> : null}
                </div>
              ) : null}
            </div>
            <div
              role="rowgroup"
              className="relative"
              style={{ height: rowVirtualizer.getTotalSize() }}
            >
              {loading ? (
                <div role="row">
                  <div role="cell" className="py-10 text-center">
                    <Spinner size="sm" />
                  </div>
                </div>
              ) : error ? (
                <div role="row">
                  <div role="cell" className="py-10">
                    <ApiErrorMessage error={error} />
                  </div>
                </div>
              ) : rows.length === 0 ? (
                <div role="row">
                  <div role="cell" className="py-10 text-center text-sm text-muted-foreground">
                    {emptyText ?? t("common.noRecords")}
                  </div>
                </div>
              ) : (
                virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  if (row === undefined) return null;
                  const id = getRowId(row);
                  return (
                    <div
                      key={id}
                      role="row"
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      // Zebra striping on top of the hover colour, so a hovered row still reads
                      // clearly regardless of parity.
                      className={`absolute grid w-full border-b border-border transition-colors hover:bg-muted/30${virtualRow.index % 2 === 1 ? " bg-muted/10" : ""}${onRowClick ? " cursor-pointer" : ""}`}
                      style={{
                        transform: `translateY(${virtualRow.start}px)`,
                        gridTemplateColumns,
                      }}
                    >
                      {selection ? (
                        <div
                          role="cell"
                          className="flex items-center px-md py-1.5"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {isSelectable(row) ? (
                            <Checkbox
                              aria-label={t("common.selectRow")}
                              checked={selection.selectedIds.has(id)}
                              onCheckedChange={(checked) => setRowSelected(id, checked)}
                            />
                          ) : null}
                        </div>
                      ) : null}
                      {visibleColumns.map((column, index) => (
                        <div
                          key={column.key}
                          role="cell"
                          className="flex min-w-0 items-center truncate px-md py-1.5 text-sm"
                        >
                          {index === 0 && wrapPrimaryCell
                            ? wrapPrimaryCell(row, column.cell(row))
                            : column.cell(row)}
                        </div>
                      ))}
                      {rowActions ? (
                        <div
                          role="cell"
                          className="flex items-center px-md py-1.5"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="flex items-center gap-1 whitespace-nowrap">
                            {rowActions(row)}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        {paging ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3">
            <span className="text-sm text-muted-foreground">
              {total === null
                ? t("common.rowsShown", { count: rows.length })
                : t("common.rowsTotal", {
                    from: total === 0 ? 0 : (page - 1) * pageSize + 1,
                    to: (page - 1) * pageSize + rows.length,
                    total,
                  })}
            </span>
            <div className="flex items-center gap-3">
              {pageSizeOptions.length > 1 && paging.onPageSizeChange ? (
                <Select
                  className="h-8 w-28 px-2 text-xs"
                  aria-label={t("common.pageSize")}
                  options={pageSizeOptions.map((n) => ({
                    value: String(n),
                    label: t("common.perPage", { count: n }),
                  }))}
                  value={String(pageSize)}
                  onValueChange={(value) => paging.onPageSizeChange?.(Number(value))}
                />
              ) : null}
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={paging.onPageChange}
                previousLabel={t("common.previous")}
                nextLabel={t("common.next")}
              />
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
