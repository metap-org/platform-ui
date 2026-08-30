import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "../api/useApiQuery";
import type { EntitySummary } from "./types";

/** Same `staleTime: Infinity` reasoning as `useEntities` — plus `initialData` seeded from
 *  `["entities"]`'s cache when it's already populated (e.g. a nav sidebar mounted `useEntities`
 *  before this page did): `GET /metadata/entities/{entity}` returns exactly one element of what
 *  `GET /metadata/entities` already returned (`crates/metap-metadata/src/registry.rs`'s
 *  `to_metadata` builds the identical `EntitySummary` shape for both), so a page that lands here
 *  after the list was already fetched doesn't need a second round trip for data it already has.
 *  Falls through to a real fetch (via `initialData` returning `undefined`) whenever the list
 *  hasn't been fetched yet or doesn't have this entity — e.g. a deep link straight to one entity's
 *  page with no sidebar ever mounted. */
export function useEntity(entityName: string, enabled: boolean = true) {
  const queryClient = useQueryClient();

  return useApiQuery<{ data: EntitySummary }, EntitySummary>(
    ["entity", entityName],
    `/metadata/entities/${entityName}`,
    (response) => response.data,
    enabled && entityName.length > 0,
    {
      staleTime: Infinity,
      initialData: () => {
        const cached = queryClient.getQueryData<{ data: EntitySummary[] }>(["entities"]);
        const match = cached?.data.find((entity) => entity.name === entityName);
        return match ? { data: match } : undefined;
      },
    },
  );
}
