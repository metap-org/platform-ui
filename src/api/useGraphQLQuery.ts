import { useQuery } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { graphqlFetch } from "./graphqlClient";

/** Mirrors `useApiQuery`'s options bag — same reasoning: extra `useQuery` knobs stay a trailing
 *  options bag, not more positional params, since most callers only need the required ones. */
type GraphQLQueryOptions = {
  staleTime?: number;
};

/** GraphQL counterpart to `useApiQuery` — same calling convention (`queryKey`/`path`/`select`/
 *  `enabled`), `query`/`variables` in place of `useApiQuery`'s single REST `path` doing double
 *  duty as both the request target and its own identity. See `graphqlClient.ts`'s doc comment
 *  for when this is the right tool versus `useApiQuery`. */
export function useGraphQLQuery<TFetched, TSelected = TFetched>(
  queryKey: QueryKey,
  path: string,
  query: string,
  variables?: Record<string, unknown>,
  select?: (data: TFetched) => TSelected,
  enabled: boolean = true,
  options?: GraphQLQueryOptions,
) {
  const { token } = useAuth();

  return useQuery({
    queryKey,
    queryFn: () => graphqlFetch<TFetched>(path, token, query, variables),
    select,
    enabled: token !== null && enabled,
    staleTime: options?.staleTime,
  });
}
