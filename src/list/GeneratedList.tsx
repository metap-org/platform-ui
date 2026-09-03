import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import {
  Alert,
  buttonVariants,
  Button,
  Card,
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

export function GeneratedList({ entityName }: { entityName: string }) {
  const { t } = useTranslation();
  const { entityLabel, fieldLabel } = useEntityLabels(entityName);
  const navAdapter = useNavigationAdapter();
  const { data: entity, isLoading: entityLoading, error: entityError } = useEntity(entityName);
  // Text filters are debounced (wait for the user to stop typing before refetching).
  const [filterInputs, setFilterInputs] = useState<Record<string, string>>({});
  // Enum filters come from a Select, not free text, so they refetch immediately on change.
  const [enumFilters, setEnumFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState>(null);
  const debouncedTextFilters = useDebouncedValue(filterInputs, 400);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

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
      await refetch();
    } catch (error) {
      setDeleteError(error instanceof ApiError ? error.message : t("common.somethingWentWrong"));
    } finally {
      setPendingDeleteId(null);
    }
  }

  const columnCount = listView.fields.length + 1;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {entityLabel(entity.label)}
        </h2>
        <navAdapter.Link
          to={navAdapter.toNewRecord(entityName)}
          className={buttonVariants({ variant: "default" })}
        >
          {t("common.new")}
        </navAdapter.Link>
      </div>
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
          <Table className="table-fixed">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
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
