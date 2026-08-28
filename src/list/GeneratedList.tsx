import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import {
  Alert,
  buttonVariants,
  Button,
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
import { useAuth } from "../auth/AuthContext";
import { FieldValue } from "../field/FieldValue";
import { useEntity } from "../metadata/useEntity";
import type { EntityField } from "../metadata/types";
import { useEntityLabels } from "../i18n/useEntityLabels";
import { useNavigationAdapter } from "../navigation/NavigationContext";

type RecordDto = {
  id: string;
  code: string | null;
  status: string | null;
  version: number;
  data: Record<string, unknown>;
};

type ListPage = {
  data: RecordDto[];
  page: { limit: number; nextCursor: string | null };
};

type SortState = { field: string; descending: boolean } | null;

const ROW_HEIGHT = 40;

/** No `@mantine/hooks` `useDebouncedValue` equivalent in `@metap/ui` — see
 * `field/ReferenceFieldInput`'s doc comment for the same tradeoff. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function GeneratedList({ entityName }: { entityName: string }) {
  const { t } = useTranslation();
  const { entityLabel, fieldLabel } = useEntityLabels(entityName);
  const { token } = useAuth();
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
      await apiFetch(`/api/${entityName}/${record.id}`, token, {
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
    <div className="py-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">{entityLabel(entity.label)}</h2>
        <navAdapter.Link
          to={navAdapter.toNewRecord(entityName)}
          className={buttonVariants({ variant: "default" })}
        >
          {t("common.new")}
        </navAdapter.Link>
      </div>
      {deleteError ? (
        <Alert variant="destructive" className="mb-4 flex items-center justify-between gap-2">
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
      <div ref={scrollContainerRef} className="h-[600px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {listView.fields.map((fieldName) => {
                const field = fieldsByName.get(fieldName);

                if (!field) {
                  return <TableHead key={fieldName} />;
                }

                return (
                  <TableHead
                    key={fieldName}
                    onClick={() => toggleSort(field)}
                    className={field.sortable ? "cursor-pointer select-none" : undefined}
                  >
                    {fieldLabel(field.name, field.label)}
                    {sort?.field === fieldName ? (sort.descending ? " ▼" : " ▲") : ""}
                  </TableHead>
                );
              })}
              <TableHead>{t("common.actions")}</TableHead>
            </TableRow>
            <TableRow>
              {listView.fields.map((fieldName) => {
                if (!listView.filters.includes(fieldName)) {
                  return <TableHead key={fieldName} />;
                }

                const field = fieldsByName.get(fieldName);

                if (field?.kind === "enum") {
                  return (
                    <TableHead key={fieldName}>
                      <Select
                        placeholder={t("common.any")}
                        options={(field.enumValues ?? []).map((value) => ({ value, label: value }))}
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
                <TableCell colSpan={columnCount}>
                  <Spinner size="sm" />
                </TableCell>
              </TableRow>
            ) : recordsError ? (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  <ApiErrorMessage error={recordsError} />
                </TableCell>
              </TableRow>
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount}>{t("common.noRecords")}</TableCell>
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
                    className="absolute w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {listView.fields.map((fieldName) => {
                      const field = fieldsByName.get(fieldName);

                      return (
                        <TableCell key={fieldName}>
                          {field ? (
                            <FieldValue field={field} value={record.data[fieldName]} />
                          ) : null}
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <navAdapter.Link
                          to={navAdapter.toRecordDetail(entityName, record.id)}
                          className="text-sm underline hover:no-underline"
                        >
                          {t("common.view")}
                        </navAdapter.Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={pendingDeleteId !== null && pendingDeleteId !== record.id}
                          onClick={() => void handleDelete(record)}
                        >
                          {pendingDeleteId === record.id ? (
                            <Spinner size="sm" className="mr-2" />
                          ) : null}
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
        {isFetchingNextPage ? (
          <div className="p-2 text-center text-sm text-muted-foreground">
            {t("common.loadingMore")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
