import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { controlPlaneGraphqlFetch } from "./controlPlaneClient";

type ControlPlaneQueryOptions = {
  staleTime?: number;
};

/** `useGraphQLQuery`'s counterpart for the Bearer-only `control-plane-graphql` gateway — see
 *  `controlPlaneClient.ts`'s doc comment for why this can't just ride the session cookie the way
 *  `useGraphQLQuery` does. Takes both `gatewayUrl` (the GraphQL endpoint itself) and
 *  `authTokenUrl` (`GET /auth/token` on whichever backend owns the caller's session — `control-api`
 *  today) as explicit parameters, same "no baked-in backend topology" convention every other
 *  hook in this module follows. */
export function useControlPlaneQuery<TFetched, TSelected = TFetched>(
  queryKey: QueryKey,
  gatewayUrl: string,
  authTokenUrl: string,
  query: string,
  variables?: Record<string, unknown>,
  select?: (data: TFetched) => TSelected,
  enabled: boolean = true,
  options?: ControlPlaneQueryOptions,
) {
  const { status } = useAuth();

  return useQuery({
    queryKey,
    queryFn: () => controlPlaneGraphqlFetch<TFetched>(gatewayUrl, authTokenUrl, query, variables),
    select,
    enabled: status === "authenticated" && enabled,
    staleTime: options?.staleTime,
  });
}

/** Mutation counterpart — callers get back a plain async function (same shape
 *  `useLowCodeActions`/`useImpersonationActions` already use for per-argument, non-fixed-path
 *  actions) rather than a `useMutation` object, since every control-plane mutation here needs
 *  its own argument shape and its own `invalidateQueries` list — a single generic `useMutation`
 *  wrapper would need as many escape hatches as it saves. `queryClient` is returned alongside so
 *  a caller can invalidate the right query keys after a successful call. */
export function useControlPlaneMutate(gatewayUrl: string, authTokenUrl: string) {
  const queryClient = useQueryClient();

  async function mutate<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return controlPlaneGraphqlFetch<T>(gatewayUrl, authTokenUrl, query, variables);
  }

  return { mutate, queryClient };
}
