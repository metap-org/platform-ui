import { Card, CardContent, CardHeader, CardTitle } from "@metap/ui";
import { listFieldName } from "../api/graphqlNaming";
import { useGraphQLQuery } from "../api/useGraphQLQuery";
import type { RelatedView } from "../metadata/types";

const DEFAULT_LIMIT = 5;

/** Builds 1 combined GraphQL query for every `relatedViews` entry declared on an entity — 1
 *  aliased `{camelEntity}List(filter, limit)` fragment per entry (`listFieldName`, mirroring
 *  `metap-graphql`'s own naming so the field name this builds always matches what the schema
 *  actually generated), selecting exactly `relatedView.fields`. Variables are named
 *  `$filter{i}`/`$limit{i}` per entry so multiple sections can have different filter values/limits
 *  in the same request. */
function buildQuery(relatedViews: RelatedView[]): string {
  const parts = relatedViews.map((view, i) => {
    const fieldSelection = view.fields.join("\n        ");
    return `  ${view.name}: ${listFieldName(view.entity)}(filter: $filter${i}, limit: $limit${i}) {
    records {
      ${fieldSelection}
    }
  }`;
  });
  const variableDecls = relatedViews.map((_, i) => `$filter${i}: Json, $limit${i}: Int`).join(", ");
  return `query RelatedRecords(${variableDecls}) {\n${parts.join("\n")}\n}`;
}

function buildVariables(relatedViews: RelatedView[], id: string): Record<string, unknown> {
  const variables: Record<string, unknown> = {};
  relatedViews.forEach((view, i) => {
    variables[`filter${i}`] = { [view.filterField]: id };
    variables[`limit${i}`] = view.limit ?? DEFAULT_LIMIT;
  });
  return variables;
}

/**
 * Renders 1 section per `RelatedView` an entity declares (`metap-metadata`'s `RelatedView`,
 * registered via `submit_related_views!` — see that macro's doc comment) — a generic,
 * metadata-driven replacement for a hand-written aggregate/overview page. Mounted automatically
 * by `RecordDetail` whenever `entity.relatedViews` is non-empty; nothing else needs to change per
 * entity that declares related views.
 *
 * `graphqlPath` defaults to `/graphql` — either a service's own GraphQL mount
 * (`metap-graphql-http`) when every related entity lives in the same backend, or a gateway
 * aggregating several services (`crates/metap-graphql-gateway`) when they don't, same as any other
 * consumer of `useGraphQLQuery`. Read-only by this component's own choice, not a transport
 * limitation (`graphqlFetch`/`useGraphQLQuery` support mutations fine — see `graphqlClient.ts`'s
 * doc comment) — a related-records panel has no natural mutation of its own to perform; mutating
 * any of this data still goes through each entity's own generic `/records/:entityName/*` REST
 * screens.
 */
export function RelatedRecordsPanel({
  id,
  relatedViews,
  graphqlPath = "/graphql",
}: {
  id: string;
  relatedViews: RelatedView[];
  graphqlPath?: string;
}) {
  const query = buildQuery(relatedViews);
  const variables = buildVariables(relatedViews, id);

  const { data, isLoading } = useGraphQLQuery<
    Record<string, { records: Record<string, unknown>[] }>
  >(
    ["related-records", id, relatedViews.map((v) => v.name).join(",")],
    graphqlPath,
    query,
    variables,
  );

  if (isLoading || !data) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {relatedViews.map((view) => {
        const records = data[view.name]?.records ?? [];
        return (
          <Card key={view.name}>
            <CardHeader>
              <CardTitle>{view.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {records.length === 0 ? (
                <p className="text-sm text-muted-foreground">No records.</p>
              ) : (
                records.map((record, i) => (
                  <p key={i} className="text-sm text-foreground">
                    {view.fields.map((field) => String(record[field] ?? "")).join(" — ")}
                  </p>
                ))
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
