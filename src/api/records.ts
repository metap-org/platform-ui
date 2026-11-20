import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import type { RecordCapabilities } from "../detail/recordCapabilities";
import { apiFetch } from "./client";

/**
 * Generic entity CRUD over REST (roadmap 116 — metap speaks HTTP/JSON only): `/api/{entity}*`,
 * the batch read `?ids=`, aggregates and declared actions. In a multi-service product the calls go
 * through the API gateway (`metap/pkg/apigateway`), which routes each entity to the service that
 * serves it and resolves `expand` across services.
 */

/** metap's `RecordDto` as the REST API sends it. */
export type ApiRecord<TData = Record<string, unknown>> = {
  id: string;
  entity: string;
  code: string | null;
  status: string | null;
  data: TData;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Per-record answers (transitions, writable fields, canDelete) — on a single-record read only;
   *  list rows carry the entity-level `RecordPage.capabilities` instead. */
  capabilities: RecordCapabilities;
  /** Display labels of reference fields that declare `refDisplayField` (list responses). */
  relatedDisplay?: Record<string, string>;
  /** Records `?expand=` resolved, keyed by reference field; `null` when gone or unreadable. */
  expanded?: Record<string, ApiRecord | null>;
};

export type SingleResponse<T> = { data: ApiRecord<T> };

/** What the caller may do with the entity as a whole (entity-level policy, from the list
 *  response itself) — lets a list hide "New"/"Delete" before any row exists. */
export type EntityCapabilities = { canCreate: boolean; canUpdate: boolean; canDelete: boolean };

type ListBody<T> = {
  data: ApiRecord<T>[];
  page?: { limit: number; nextCursor?: string | null; offset?: number; total?: number };
  capabilities?: EntityCapabilities;
};

export type ListOptions = {
  /** Field equality filters; a field must be in the entity's list-view `filters`. */
  filters?: Record<string, string | number | undefined>;
  sort?: string;
  jql?: string;
  search?: string;
  limit?: number;
  cursor?: string | null;
  offset?: number;
  withTotal?: boolean;
  /** Reference fields to resolve (`expanded` on each record). */
  expand?: string[];
};

function entityPath(entity: string): string {
  return `/api/${encodeURIComponent(entity)}`;
}

/** The list route's query string. */
export function listQuery(options: ListOptions): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(options.filters ?? {})) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  if (options.sort) q.set("sort", options.sort);
  if (options.jql) q.set("jql", options.jql);
  if (options.search?.trim()) q.set("search", options.search.trim());
  if (options.limit) q.set("limit", String(options.limit));
  if (options.cursor) q.set("cursor", options.cursor);
  if (options.offset) q.set("offset", String(options.offset));
  if (options.withTotal) q.set("withTotal", "true");
  if (options.expand?.length) q.set("expand", options.expand.join(","));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function listRecords<T = Record<string, unknown>>(entity: string, options: ListOptions) {
  return apiFetch<ListBody<T>>(`${entityPath(entity)}${listQuery(options)}`);
}

/** Plain record list (first page). */
export function useRecords<T = Record<string, unknown>>(
  entity: string,
  filters: Record<string, string | number | undefined> = {},
  limit = 30,
  enabled = true,
  options: { sort?: string; jql?: string; expand?: string[] } = {},
) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["records", entity, filters, limit, options.sort, options.jql, options.expand],
    queryFn: async () => (await listRecords<T>(entity, { filters, limit, ...options })).data,
    enabled: enabled && status === "authenticated",
  });
}

/** Cursor-paginated, infinite-scroll list — what `GeneratedList`'s virtualized mode is built on. */
export function useInfiniteRecords<T = Record<string, unknown>>(
  entity: string,
  filters: Record<string, string | number | undefined>,
  sort: string | undefined,
  limit: number,
  enabled: boolean,
) {
  const { status } = useAuth();
  return useInfiniteQuery({
    queryKey: ["records-infinite", entity, filters, sort, limit],
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const body = await listRecords<T>(entity, { filters, sort, limit, cursor: pageParam });
      return { records: body.data, nextCursor: body.page?.nextCursor ?? null };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: enabled && status === "authenticated",
  });
}

export type RecordPage<T = Record<string, unknown>> = {
  records: ApiRecord<T>[];
  /** Rows matching the filters across all pages; null when the server did not count. */
  total: number | null;
  capabilities: EntityCapabilities;
};

/** One numbered page (1-based) plus the total, so a list can draw `1 2 3 … last`. Keeps the
 *  previous page on screen while the next loads. */
export function useRecordPage<T = Record<string, unknown>>(
  entity: string,
  options: {
    filters: Record<string, string | number | undefined>;
    search?: string;
    sort?: string;
    limit: number;
    page: number;
    enabled: boolean;
  },
) {
  const { status } = useAuth();
  const search = options.search?.trim() || undefined;
  return useQuery({
    queryKey: [
      "records",
      "page",
      entity,
      options.filters,
      search,
      options.sort,
      options.limit,
      options.page,
    ],
    queryFn: async (): Promise<RecordPage<T>> => {
      const body = await listRecords<T>(entity, {
        filters: options.filters,
        sort: options.sort,
        search,
        limit: options.limit,
        offset: (options.page - 1) * options.limit,
        withTotal: true,
      });
      return {
        records: body.data,
        total: body.page?.total ?? null,
        capabilities: body.capabilities ?? { canCreate: false, canUpdate: false, canDelete: false },
      };
    },
    placeholderData: keepPreviousData,
    enabled: options.enabled && status === "authenticated",
  });
}

/** Every record matching `filters`/`sort` (the "export all" loop), 200 per page, sequentially. */
export async function fetchAllRecords<T = Record<string, unknown>>(
  entity: string,
  filters: Record<string, string | number | undefined>,
  sort: string | undefined,
  onProgress: (count: number) => void,
): Promise<ApiRecord<T>[]> {
  const all: ApiRecord<T>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const body: ListBody<T> = await listRecords<T>(entity, { filters, sort, limit: 200, cursor });
    all.push(...body.data);
    onProgress(all.length);
    cursor = body.page?.nextCursor ?? null;
    if (!cursor) break;
  }
  return all;
}

export function getRecord<T = Record<string, unknown>>(
  entity: string,
  id: string,
  expand?: string[],
) {
  const q = expand?.length ? `?expand=${encodeURIComponent(expand.join(","))}` : "";
  return apiFetch<SingleResponse<T>>(`${entityPath(entity)}/${encodeURIComponent(id)}${q}`);
}

export function useRecord<T = Record<string, unknown>>(
  entity: string,
  id: string | undefined,
  expand?: string[],
) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["record", entity, id, expand],
    queryFn: async () => (await getRecord<T>(entity, id as string, expand)).data,
    enabled: Boolean(id) && status === "authenticated",
  });
}

/** The records with these ids the caller may read (absent ids are simply missing). */
export async function getRecordsByIds<T = Record<string, unknown>>(
  entity: string,
  ids: string[],
): Promise<ApiRecord<T>[]> {
  if (ids.length === 0) return [];
  const out: ApiRecord<T>[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const body = await apiFetch<ListBody<T>>(
      `${entityPath(entity)}?ids=${encodeURIComponent(chunk.join(","))}`,
    );
    out.push(...body.data);
  }
  return out;
}

/** Wire shape of the aggregate route — metrics/grouping/bucketing over any entity. */
export type AggregateSpec = {
  metrics?: string[];
  groupBy?: string;
  bucket?: "hour" | "day" | "week" | "month";
  timeField?: string;
  filters?: Record<string, string | undefined>;
  since?: string;
  until?: string;
  limit?: number;
};

/** One result row: the dimensions asked for plus one key per metric. */
export type AggregateRow = {
  bucket?: string | null;
  group?: string | null;
  count?: number;
  [metric: string]: string | number | null | undefined;
};

export function useAggregate(entity: string, spec: AggregateSpec, enabled = true) {
  const { status } = useAuth();
  const body = {
    ...spec,
    filters: Object.fromEntries(
      Object.entries(spec.filters ?? {}).filter(([, v]) => v !== undefined && v !== ""),
    ),
  };
  return useQuery({
    queryKey: ["records-aggregate", entity, body],
    queryFn: async () =>
      (
        await apiFetch<{ data: AggregateRow[] }>(`${entityPath(entity)}/aggregate`, {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).data,
    enabled: enabled && status === "authenticated",
  });
}

export function createRecord<T = Record<string, unknown>>(
  entity: string,
  data: Record<string, unknown>,
  reason?: string,
) {
  return apiFetch<SingleResponse<T>>(entityPath(entity), {
    method: "POST",
    body: JSON.stringify({ data, reason }),
  });
}

export function updateRecord<T = Record<string, unknown>>(
  entity: string,
  id: string,
  version: number,
  data: Record<string, unknown>,
  reason?: string,
) {
  return apiFetch<SingleResponse<T>>(`${entityPath(entity)}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ version, data, reason }),
  });
}

export function deleteRecord(entity: string, id: string, version: number, reason?: string) {
  return apiFetch<SingleResponse<Record<string, unknown>>>(
    `${entityPath(entity)}/${encodeURIComponent(id)}`,
    { method: "DELETE", body: JSON.stringify({ version, reason }) },
  );
}

export function transitionRecord<T = Record<string, unknown>>(
  entity: string,
  id: string,
  action: string,
  version: number,
  data?: Record<string, unknown>,
  reason?: string,
) {
  return apiFetch<SingleResponse<T>>(
    `${entityPath(entity)}/${encodeURIComponent(id)}/transitions/${encodeURIComponent(action)}`,
    { method: "POST", body: JSON.stringify({ version, data, reason }) },
  );
}

/** Runs an action the entity declares: on one record when `id` is given, else on the entity. */
export async function invokeAction<T = Record<string, unknown>>(
  entity: string,
  action: string,
  options: { id?: string; input?: Record<string, unknown> } = {},
): Promise<T> {
  const path = options.id
    ? `${entityPath(entity)}/${encodeURIComponent(options.id)}/actions/${encodeURIComponent(action)}`
    : `${entityPath(entity)}/actions/${encodeURIComponent(action)}`;
  const body = await apiFetch<{ data: T }>(path, {
    method: "POST",
    body: JSON.stringify({ input: options.input ?? {} }),
  });
  return body.data;
}

/** Invalidates every generic record query at once. Coarse on purpose: a stale count on a
 *  dashboard is worse than one extra refetch after a mutation. */
export function useInvalidateRecords() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["records"] });
    void queryClient.invalidateQueries({ queryKey: ["records-infinite"] });
    void queryClient.invalidateQueries({ queryKey: ["record"] });
    void queryClient.invalidateQueries({ queryKey: ["records-aggregate"] });
  };
}
