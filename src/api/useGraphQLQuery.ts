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
 *  for when this is the right tool versus `useApiQuery`.
 *
 *  Rides the existing session cookie (`graphqlFetch` with no `token`) — no `GET /auth/token`
 *  round trip before every call anymore (removed 2026-09-04, alongside `crates/metap-graphql-gateway`
 *  gaining an opt-in cookie-auth mode: that endpoint existed *only* to feed this hook and
 *  `waf.ts`'s `graphqlAuthed`, and cost every GraphQL call a second request for no reason once
 *  the gateway could just accept the cookie directly). */
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
    queryFn: () => graphqlFetch<TFetched>(path, query, variables),
    select,
    enabled: status === "authenticated" && enabled,
    staleTime: options?.staleTime,
  });
}
