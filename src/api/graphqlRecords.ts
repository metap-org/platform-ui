import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useEntity } from "../metadata/useEntity";
import type { EntityField, EntitySummary } from "../metadata/types";
import type { RecordCapabilities } from "../detail/recordCapabilities";
import { apiFetch } from "./client";
import { graphqlFetch } from "./graphqlClient";
import { useGraphQLQuery } from "./useGraphQLQuery";
import {
  createFieldName,
  deleteFieldName,
  getFieldName,
  listFieldName,
  transitionFieldName,
  updateFieldName,
} from "./graphqlNaming";

/**
 * Generic CRUD over GraphQL — the same role `useApiQuery`/`useApiMutation`/`useApiInfiniteQuery`
 * used to play for REST before `metap` core removed REST entity CRUD entirely
 * (`../metap-docs/docs/roadmap/90-remove-rest-entity-crud.md`) — extracted from
 * `metap-demo-waf/data-plane/web/src/api/waf.ts` (`docs/features/30-graphql-generic-record-hooks.md`
 * in `metap-docs`) once that file's own `useRecords`/`useRecord`/`useAggregate`/CRUD mutations
 * turned out to already be 100% entity-agnostic.
 *
 * **`GeneratedList`/`GeneratedForm`/`RecordDetail`/`WorkflowActionBar` are built on this now**
 * (2026-09-24, `../metap-docs/docs/roadmap/93-platform-ui-graphql-migration.md`) — the REST
 * `/api/:entity*` routes they used to call no longer exist on any current backend. A bespoke
 * screen that skips the generated UI can still use these hooks/functions directly the same way it
 * always could; there's no longer a "REST vs GraphQL" choice to make, only one data path.
 */

/** Mirrors `metap`'s `RecordDto` (camelCase over the wire) as it comes back through GraphQL,
 *  reshaped from the flat selection set into the usual envelope-plus-`data` shape. */
export type GraphQLRecord<TData = Record<string, unknown>> = {
  id: string;
  entity: string;
  code: string | null;
  status: string | null;
  data: TData;
  version: number;
  createdAt: string;
  updatedAt: string;
  capabilities: RecordCapabilities;
  relatedDisplay?: Record<string, string>;
};

export type GraphQLListResponse<T> = {
  data: GraphQLRecord<T>[];
  page?: { limit: number; nextCursor: string | null };
};
export type GraphQLSingleResponse<T> = { data: GraphQLRecord<T> };

const ENVELOPE_FIELDS = [
  "id",
  "entity",
  "code",
  "status",
  "version",
  "createdAt",
  "updatedAt",
  "capabilities",
] as const;

/** Builds the GraphQL selection set for 1 record: the fixed envelope plus every field the entity
 *  declares. A `reference` field's GraphQL type is an object, not a scalar, so it needs its own
 *  sub-selection rather than a bare field name — `id` always, plus the field's own
 *  `refDisplayField` when set (e.g. `parentId { id name }`) so `reshapeRecord` below can rebuild
 *  `relatedDisplay`, the same batch-resolved reference label REST's `RecordDto.related_display`
 *  used to carry (`FieldValue`'s reference-column rendering depends on it being present, not
 *  firing its own per-cell request). */
function recordSelection(fields: EntityField[]): string {
  const dataFields = fields.map((f) => {
    if (f.kind !== "reference") return f.name;
    return f.refDisplayField ? `${f.name} { id ${f.refDisplayField} }` : `${f.name} { id }`;
  });
  return [...ENVELOPE_FIELDS, ...dataFields].join("\n        ");
}

/** Undoes `recordSelection`'s flat GraphQL shape back into `GraphQLRecord<T>`'s envelope + `data`
 *  bag, rebuilding `relatedDisplay` from each reference field's nested display-field selection. */
function reshapeRecord<T>(raw: Record<string, unknown>, fields: EntityField[]): GraphQLRecord<T> {
  const data: Record<string, unknown> = {};
  const relatedDisplay: Record<string, string> = {};
  for (const field of fields) {
    const value = raw[field.name];
    if (field.kind === "reference" && value !== null && typeof value === "object") {
      const ref = value as Record<string, unknown>;
      data[field.name] = (ref.id as string | undefined) ?? null;
      const display = field.refDisplayField ? ref[field.refDisplayField] : undefined;
      if (typeof display === "string") {
        relatedDisplay[field.name] = display;
      }
    } else {
      data[field.name] = value;
    }
  }
  return {
    id: raw.id as string,
    entity: raw.entity as string,
    code: (raw.code as string | null) ?? null,
    status: (raw.status as string | null) ?? null,
    version: raw.version as number,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    capabilities: raw.capabilities as RecordCapabilities,
    data: data as T,
    ...(Object.keys(relatedDisplay).length > 0 ? { relatedDisplay } : {}),
  };
}

/** Imperative (non-hook) counterpart to `useEntity` — the mutation functions below need the same
 *  field list `useGraphQLRecord` does to build a full record selection set, but run outside React
 *  so they can't use that hook. Cached forever per entity for the tab's lifetime: entity metadata
 *  doesn't change mid-session outside a low-code publish (same `staleTime: Infinity` reasoning
 *  `useEntity`/`useEntities` already rely on). */
const entityFieldsCache = new Map<string, Promise<EntityField[]>>();

function fetchEntityFields(entity: string): Promise<EntityField[]> {
  let cached = entityFieldsCache.get(entity);
  if (!cached) {
    cached = apiFetch<{ data: EntitySummary }>(`/metadata/entities/${entity}`).then(
      (response) => response.data.fields,
    );
    entityFieldsCache.set(entity, cached);
  }
  return cached;
}

const DEFAULT_GRAPHQL_PATH = "/graphql";

/** Plain record list. `filters` are field-name equality pairs, the same shape the generic REST
 *  list route takes — a field must be in the entity's list-view `filters` or the backend ignores
 *  it. `path` defaults to `/graphql`, the fixed convention every gateway deployment so far routes
 *  to; override it if yours doesn't. */
export function useGraphQLRecords<T = Record<string, unknown>>(
  entity: string,
  filters: Record<string, string | number | undefined> = {},
  limit = 30,
  enabled = true,
  path: string = DEFAULT_GRAPHQL_PATH,
) {
  const { status } = useAuth();
  const authed = enabled && status === "authenticated";
  const entityQuery = useEntity(entity, authed);
  const fields = entityQuery.data?.fields ?? [];
  const query = `query List($filter: Json, $limit: Int) {
    result: ${listFieldName(entity)}(filter: $filter, limit: $limit) {
      records {
        ${recordSelection(fields)}
      }
    }
  }`;
  const variables = {
    filter: Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== undefined && v !== ""),
    ),
    limit,
  };
  const result = useGraphQLQuery<
    { result: { records: Record<string, unknown>[] } },
    GraphQLRecord<T>[]
  >(
    ["graphql-records", entity, filters, limit],
    path,
    query,
    variables,
    (raw) => raw.result.records.map((record) => reshapeRecord<T>(record, fields)),
    authed && Boolean(entityQuery.data),
  );
  return { ...result, isLoading: result.isLoading || (authed && !entityQuery.data) };
}

/** One page of a cursor-paginated list — the raw shape `{entity}List` returns
 *  (`records`/`nextCursor`/`hasMore`, `metap-graphql`'s `ConnectionHandle`), reshaped. Shared by
 *  `useInfiniteGraphQLRecords` (below) and `fetchAllGraphQLRecordPages` (the "export everything
 *  matching the filter" loop, `GeneratedList`'s non-virtualized escape hatch). */
async function fetchGraphQLRecordPage<T = Record<string, unknown>>(
  entity: string,
  fields: EntityField[],
  filter: Record<string, string | number>,
  sort: string | undefined,
  limit: number,
  cursor: string | null,
  path: string,
): Promise<{ records: GraphQLRecord<T>[]; nextCursor: string | null }> {
  const query = `query List($filter: Json, $sort: String, $limit: Int, $cursor: String) {
    result: ${listFieldName(entity)}(filter: $filter, sort: $sort, limit: $limit, cursor: $cursor) {
      records {
        ${recordSelection(fields)}
      }
      nextCursor
      hasMore
    }
  }`;
  const raw = await graphqlFetch<{
    result: { records: Record<string, unknown>[]; nextCursor: string | null; hasMore: boolean };
  }>(path, query, { filter, sort, limit, cursor });
  return {
    records: raw.result.records.map((record) => reshapeRecord<T>(record, fields)),
    nextCursor: raw.result.nextCursor,
  };
}

function nonEmptyFilters(
  filters: Record<string, string | number | undefined>,
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined && v !== ""),
  ) as Record<string, string | number>;
}

/** Cursor-paginated, infinite-scroll counterpart to `useGraphQLRecords` above — what
 *  `GeneratedList` is built on (`useApiInfiniteQuery`'s REST-era replacement). `sort` is the same
 *  `"field"`/`"-field"` string convention REST's `sort` query param used. */
export function useInfiniteGraphQLRecords<T = Record<string, unknown>>(
  entity: string,
  filters: Record<string, string | number | undefined>,
  sort: string | undefined,
  limit: number,
  enabled: boolean,
  path: string = DEFAULT_GRAPHQL_PATH,
) {
  const { status } = useAuth();
  const authed = enabled && status === "authenticated";
  const entityQuery = useEntity(entity, authed);
  const fields = entityQuery.data?.fields ?? [];
  const filter = nonEmptyFilters(filters);

  const result = useInfiniteQuery({
    queryKey: ["graphql-records-infinite", entity, filters, sort, limit],
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      fetchGraphQLRecordPage<T>(entity, fields, filter, sort, limit, pageParam, path),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: authed && Boolean(entityQuery.data),
  });
  return { ...result, isLoading: result.isLoading || (authed && !entityQuery.data) };
}

/** Fetches *every* record matching `filter`/`sort` (not just what's scrolled into view) — the
 *  GraphQL counterpart to the old REST "export all" loop, at the same page size REST used to cap
 *  at (200). Sequential, not parallel — cursor pagination is inherently a chain. */
export async function fetchAllGraphQLRecords<T = Record<string, unknown>>(
  entity: string,
  filters: Record<string, string | number | undefined>,
  sort: string | undefined,
  onProgress: (count: number) => void,
  path: string = DEFAULT_GRAPHQL_PATH,
): Promise<GraphQLRecord<T>[]> {
  const fields = await fetchEntityFields(entity);
  const filter = nonEmptyFilters(filters);
  const all: GraphQLRecord<T>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { records: GraphQLRecord<T>[]; nextCursor: string | null } =
      await fetchGraphQLRecordPage<T>(entity, fields, filter, sort, 200, cursor, path);
    all.push(...page.records);
    onProgress(all.length);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return all;
}

export function useGraphQLRecord<T = Record<string, unknown>>(
  entity: string,
  id: string | undefined,
  path: string = DEFAULT_GRAPHQL_PATH,
) {
  const { status } = useAuth();
  const authed = Boolean(id) && status === "authenticated";
  const entityQuery = useEntity(entity, authed);
  const fields = entityQuery.data?.fields ?? [];
  const query = `query Get($id: ID!) {
    result: ${getFieldName(entity)}(id: $id) {
      ${recordSelection(fields)}
    }
  }`;
  const result = useGraphQLQuery<
    { result: Record<string, unknown> | null },
    GraphQLRecord<T> | undefined
  >(
    ["graphql-record", entity, id],
    path,
    query,
    { id },
    (raw) => (raw.result ? reshapeRecord<T>(raw.result, fields) : undefined),
    authed && Boolean(entityQuery.data),
  );
  return { ...result, isLoading: result.isLoading || (authed && !entityQuery.data) };
}

/** Wire shape of the generic `aggregate` GraphQL field (`docs/roadmap/70-aggregate-api.md` +
 *  `75-aggregate-generic-record-backend.md`) — `metric`s/grouping/bucketing over any entity. */
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

/** One result row: the dimensions the query asked for plus one key per metric. `count` is always
 *  a number; `group` is a string (the backend casts every group key to text so a chart never has
 *  to branch on the underlying column type). */
export type AggregateRow = {
  bucket?: string | null;
  group?: string | null;
  count?: number;
  [metric: string]: string | number | null | undefined;
};

const AGGREGATE_QUERY = `query Aggregate($entity: String!, $spec: Json!) {
  result: aggregate(entity: $entity, spec: $spec)
}`;

export function useGraphQLAggregate(
  entity: string,
  spec: AggregateSpec,
  enabled = true,
  path: string = DEFAULT_GRAPHQL_PATH,
) {
  const { status } = useAuth();
  const body = {
    ...spec,
    filters: Object.fromEntries(
      Object.entries(spec.filters ?? {}).filter(([, v]) => v !== undefined && v !== ""),
    ),
  };
  return useGraphQLQuery<{ result: { data: AggregateRow[] } }, AggregateRow[]>(
    ["graphql-aggregate", entity, body],
    path,
    AGGREGATE_QUERY,
    { entity, spec: body },
    (raw) => raw.result.data,
    enabled && status === "authenticated",
  );
}

export async function createGraphQLRecord<T = Record<string, unknown>>(
  entity: string,
  data: Record<string, unknown>,
  path: string = DEFAULT_GRAPHQL_PATH,
): Promise<GraphQLSingleResponse<T>> {
  const fields = await fetchEntityFields(entity);
  const query = `mutation Create($data: Json!) {
    result: ${createFieldName(entity)}(data: $data) {
      ${recordSelection(fields)}
    }
  }`;
  const raw = await graphqlFetch<{ result: Record<string, unknown> }>(path, query, { data });
  return { data: reshapeRecord<T>(raw.result, fields) };
}

export async function updateGraphQLRecord<T = Record<string, unknown>>(
  entity: string,
  id: string,
  version: number,
  data: Record<string, unknown>,
  path: string = DEFAULT_GRAPHQL_PATH,
): Promise<GraphQLSingleResponse<T>> {
  const fields = await fetchEntityFields(entity);
  const query = `mutation Update($id: ID!, $expectedVersion: Int!, $data: Json!) {
    result: ${updateFieldName(entity)}(id: $id, expectedVersion: $expectedVersion, data: $data) {
      ${recordSelection(fields)}
    }
  }`;
  const raw = await graphqlFetch<{ result: Record<string, unknown> }>(path, query, {
    id,
    expectedVersion: version,
    data,
  });
  return { data: reshapeRecord<T>(raw.result, fields) };
}

export async function deleteGraphQLRecord(
  entity: string,
  id: string,
  version: number,
  path: string = DEFAULT_GRAPHQL_PATH,
) {
  const query = `mutation Delete($id: ID!, $expectedVersion: Int!) {
    result: ${deleteFieldName(entity)}(id: $id, expectedVersion: $expectedVersion) {
      id
    }
  }`;
  return graphqlFetch<{ result: { id: string } }>(path, query, { id, expectedVersion: version });
}

export async function transitionGraphQLRecord<T = Record<string, unknown>>(
  entity: string,
  id: string,
  action: string,
  version: number,
  data?: Record<string, unknown>,
  path: string = DEFAULT_GRAPHQL_PATH,
): Promise<GraphQLSingleResponse<T>> {
  const fields = await fetchEntityFields(entity);
  const query = `mutation Transition($id: ID!, $action: String!, $expectedVersion: Int!, $data: Json) {
    result: ${transitionFieldName(entity)}(
      id: $id
      action: $action
      expectedVersion: $expectedVersion
      data: $data
    ) {
      ${recordSelection(fields)}
    }
  }`;
  const raw = await graphqlFetch<{ result: Record<string, unknown> }>(path, query, {
    id,
    action,
    expectedVersion: version,
    data: data ?? null,
  });
  return { data: reshapeRecord<T>(raw.result, fields) };
}

/** Invalidates every generic GraphQL record query at once. Coarse on purpose: a stale count on a
 *  dashboard is worse than one extra refetch after a mutation. */
export function useInvalidateGraphQLRecords() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["graphql-records"] });
    void queryClient.invalidateQueries({ queryKey: ["graphql-records-infinite"] });
    void queryClient.invalidateQueries({ queryKey: ["graphql-record"] });
    void queryClient.invalidateQueries({ queryKey: ["graphql-aggregate"] });
  };
}
