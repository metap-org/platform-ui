import { useQuery } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "./client";
import { graphqlFetch } from "./graphqlClient";

/** Mirrors `useApiQuery`'s options bag — same reasoning: extra `useQuery` knobs stay a trailing
 *  options bag, not more positional params, since most callers only need the required ones. */
type GraphQLQueryOptions = {
  staleTime?: number;
};

type TokenResponse = { data: { token: string } };

/** GraphQL counterpart to `useApiQuery` — same calling convention (`queryKey`/`path`/`select`/
 *  `enabled`), `query`/`variables` in place of `useApiQuery`'s single REST `path` doing double
 *  duty as both the request target and its own identity. See `graphqlClient.ts`'s doc comment
 *  for when this is the right tool versus `useApiQuery`.
 *
 *  Unlike `useApiQuery`, this fetches `GET /auth/token` (cookie-authenticated, same as everything
 *  else) immediately before every actual GraphQL call to get a short-lived Bearer token for
 *  `crates/graphql-gateway` — see `graphqlFetch`'s doc comment for why that one target still
 *  needs a Bearer token when nothing else in this package does. The extra round trip only happens
 *  while `enabled`; react-query still caches/dedupes the combined query by `queryKey` as usual. */
export function useGraphQLQuery<TFetched, TSelected = TFetched>(
  queryKey: QueryKey,
  path: string,
  query: string,
  variables?: Record<string, unknown>,
  select?: (data: TFetched) => TSelected,
  enabled: boolean = true,
  options?: GraphQLQueryOptions,
) {
  const { status } = useAuth();

  return useQuery({
    queryKey,
    queryFn: async () => {
      const { data } = await apiFetch<TokenResponse>("/auth/token");
      return graphqlFetch<TFetched>(path, data.token, query, variables);
    },
    select,
    enabled: status === "authenticated" && enabled,
    staleTime: options?.staleTime,
  });
}
