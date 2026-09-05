import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useEntity } from "../metadata/useEntity";
import type { EntityField, EntitySummary } from "../metadata/types";
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
 * play for REST, extracted from `metap-demo-waf/data-plane/web/src/api/waf.ts`
 * (`docs/features/30-graphql-generic-record-hooks.md` in `metap-docs`) once that file's own
 * `useRecords`/`useRecord`/`useAggregate`/CRUD mutations turned out to already be 100%
 * entity-agnostic — every one takes `entity: string` and builds its query from that entity's own
 * metadata, no WAF-specific field or business rule anywhere in them. They just hadn't been pulled
 * out of the one app that happened to need GraphQL first.
 *
 * This is the piece that lets an app skip `GeneratedList`/`GeneratedForm`/`RecordDetail` (the
 * *generated UI*) and still avoid hand-writing its own data-fetching layer for a bespoke screen —
 * only the layout stays hand-written; list/get/create/update/delete/transition/aggregate for any
 * entity come from here, same as they would through the REST hooks. `GeneratedList` and friends
 * are unaffected — they stay on REST, this is a second, parallel data path for a custom-UI app
 * that has (or wants) a GraphQL gateway in front of its services instead.
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
] as const;

/** Builds the GraphQL selection set for 1 record: the fixed envelope plus every field the entity
 *  declares. A `reference` field's GraphQL type is an object, not a scalar, so it needs its own
 *  sub-selection (`fieldName { id }`) rather than a bare field name — `reshapeRecord` below undoes
 *  that nesting back into the plain foreign-key-id string REST returns in `data.fieldName`. */
function recordSelection(fields: EntityField[]): string {
  const dataFields = fields.map((f) => (f.kind === "reference" ? `${f.name} { id }` : f.name));
  return [...ENVELOPE_FIELDS, ...dataFields].join("\n        ");
}

/** Undoes `recordSelection`'s flat GraphQL shape back into `GraphQLRecord<T>`'s envelope + `data`
 *  bag. */
function reshapeRecord<T>(raw: Record<string, unknown>, fields: EntityField[]): GraphQLRecord<T> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const value = raw[field.name];
    data[field.name] =
      field.kind === "reference" && value !== null && typeof value === "object"
        ? ((value as { id?: string }).id ?? null)
        : value;
  }
  return {
    id: raw.id as string,
    entity: raw.entity as string,
    code: (raw.code as string | null) ?? null,
    status: (raw.status as string | null) ?? null,
    version: raw.version as number,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    data: data as T,
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

/** Invalidates every generic GraphQL record query at once. Coarse on purpose, same reasoning
 *  `GeneratedList`'s REST mutations use: a stale count on a dashboard is worse than one extra
 *  refetch after a mutation. Doesn't touch REST's `["records", ...]` cache
 *  (`useApiInfiniteQuery`) — the two transports' query keys are deliberately disjoint so an app
 *  using both (a custom GraphQL screen alongside `GeneratedList`'s REST-based `/records/*` escape
 *  hatch) never cross-invalidates by accident. */
export function useInvalidateGraphQLRecords() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["graphql-records"] });
    void queryClient.invalidateQueries({ queryKey: ["graphql-record"] });
    void queryClient.invalidateQueries({ queryKey: ["graphql-aggregate"] });
  };
}
