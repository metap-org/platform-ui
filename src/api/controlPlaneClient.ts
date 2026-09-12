import { apiFetch } from "./client";
import { graphqlFetch } from "./graphqlClient";

/**
 * Bearer-token bridge to the `control-plane-graphql` gateway (`../../../metap-lowcode/services/
 * control-plane-graphql`) — that gateway is deliberately Bearer-only, no cookie-auth mode (see
 * its own `src/auth.rs` doc comment: it runs on its own separate origin from `control-api`/
 * `lowcode-admin-api`, the 2 services whose session cookie it would otherwise need to ride the
 * same way `graphqlClient.ts`'s cookie-auth path does for a same-origin `metap-demo-waf`-style
 * gateway). So every call here mints a short-lived Bearer via `GET /auth/token` against
 * `authTokenUrl` first — the same 2-round-trip tradeoff `useGraphQLQuery`'s own doc comment
 * describes as the *pre-2026-09-04* default, before cookie-auth existed at all. Once a future
 * deployment fronts the gateway behind the same origin as `control-api` (this repo's own FE-1/
 * FE-4 plan), this whole module becomes unnecessary and callers can switch to plain
 * `useGraphQLQuery` instead — deliberately not attempted now, since that reverse-proxy doesn't
 * exist yet.
 *
 * No hardcoded URL/port and no environment-variable convention here on purpose — `platform-ui`
 * has zero backend-topology knowledge of its own (every existing REST/GraphQL call in this repo
 * takes its target as an explicit parameter, resolved by whichever consuming app's own dev
 * proxy/build config decides); `gatewayUrl`/`authTokenUrl` follow that same convention, mirroring
 * `useGraphQLQuery`'s own `path` parameter.
 */

/** Mints a fresh short-lived Bearer token, scoped to whatever session/tenant `authTokenUrl`'s
 *  own `AuthContext` resolves (that origin must already have an authenticated session — cookie,
 *  same as any other `apiFetch` call). Never cached here: the caller decides caching/reuse
 *  policy (see `useControlPlaneQuery`'s doc comment for why this hook fetches fresh per query
 *  rather than sharing one token across calls). */
export async function fetchControlPlaneToken(authTokenUrl: string): Promise<string> {
  const result = await apiFetch<{ data: { token: string } }>(authTokenUrl);
  return result.data.token;
}

/** Mints a token then makes the actual GraphQL call — the 2-request unit every control-plane
 *  query/mutation needs. Not batched with `graphqlClient.ts`'s microtask queue (each call mints
 *  its own token first), a real but accepted cost for a Bearer-only gateway on its own origin. */
export async function controlPlaneGraphqlFetch<T>(
  gatewayUrl: string,
  authTokenUrl: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = await fetchControlPlaneToken(authTokenUrl);
  return graphqlFetch<T>(gatewayUrl, query, variables, token);
}
