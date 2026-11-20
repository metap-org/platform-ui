import { Card, CardContent, CardHeader, CardTitle } from "@metap/ui";
import { useQueries } from "@tanstack/react-query";
import { listRecords } from "../api/records";
import { useAuth } from "../auth/AuthContext";
import type { RelatedView } from "../metadata/types";

const DEFAULT_LIMIT = 5;

/**
 * Renders 1 section per `RelatedView` an entity declares (`metap-metadata`'s `RelatedView`) — a
 * generic, metadata-driven replacement for a hand-written aggregate/overview page. Mounted
 * automatically by `RecordDetail` whenever `entity.relatedViews` is non-empty; nothing else needs
 * to change per entity that declares related views.
 *
 * One REST list per section (`/api/{entity}?{filterField}={id}&limit=`), in parallel; the API
 * gateway routes each to whichever service serves that entity. Read-only: mutating any of this
 * data goes through each entity's own screens.
 */
export function RelatedRecordsPanel({
  id,
  relatedViews,
}: {
  id: string;
  relatedViews: RelatedView[];
}) {
  const { status } = useAuth();
  const results = useQueries({
    queries: relatedViews.map((view) => ({
      queryKey: [
        "records",
        "related",
        view.entity,
        view.filterField,
        id,
        view.limit ?? DEFAULT_LIMIT,
      ],
      queryFn: async () =>
        (
          await listRecords(view.entity, {
            filters: { [view.filterField]: id },
            limit: view.limit ?? DEFAULT_LIMIT,
          })
        ).data.map((record) => ({ id: record.id, ...record.data }) as Record<string, unknown>),
      enabled: status === "authenticated",
    })),
  });

  if (results.some((r) => r.isLoading)) return null;
  const data: Record<string, { records: Record<string, unknown>[] }> = {};
  relatedViews.forEach((view, i) => {
    data[view.name] = { records: results[i]?.data ?? [] };
  });

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
