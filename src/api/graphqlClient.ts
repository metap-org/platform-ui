/** GraphQL counterpart to `client.ts`'s `apiFetch`, but not the same auth shape — see
 *  `graphqlFetch`'s own doc comment for why this one still takes an explicit Bearer token while
 *  `apiFetch` moved to a cookie session. POSTs a query/variables body and unwraps `{data, errors}`
 *  instead of a plain JSON body. For a BFF gateway that aggregates several
 *  backend services into 1 GraphQL schema (e.g. `metap`'s `graphql-gateway`) — not a general
 *  replacement for `apiFetch`: `GeneratedList`/`RecordDetail`'s flat per-entity CRUD screens stay
 *  on REST since they need no cross-service aggregation, this is for a page that genuinely needs 1
 *  round-trip across several services' data instead of a client-side entity-by-entity fetch.
 *  Mutations work fine too (not query-only) — `metap`'s `graphql-gateway` forwards the caller's own
 *  bearer token to each upstream (see that crate's README's Auth section), so a mutation through
 *  here enforces the real caller's permissions same as a query does; `metap-demo-waf`'s
 *  `data-plane/web/src/api/waf.ts` is a full CRUD example (2026-09-04).
 */
export class GraphQLError extends Error {
  readonly errors: { message: string }[];

  constructor(errors: { message: string }[]) {
    super(errors.map((e) => e.message).join("; ") || "GraphQL request failed");
    this.name = "GraphQLError";
    this.errors = errors;
  }
}

type GraphQLResponseBody<T> = {
  data?: T;
  errors?: { message: string }[];
};

/** Still takes a `token` (unlike `client.ts`'s `apiFetch`, which dropped it 2026-09-03) — this one
 *  talks to `crates/graphql-gateway`, a separate deployment with its own keypair that only ever
 *  speaks `Authorization: Bearer` (decode-only, see that crate's `authenticate` function), not the
 *  cookie session the rest of this package now relies on. `useGraphQLQuery` fetches a fresh
 *  short-lived token from `GET /auth/token` immediately before each call rather than this module
 *  holding one — see that new route's doc comment for why a client-held long-lived token is
 *  exactly what the cookie migration was meant to stop doing. */
export async function graphqlFetch<T>(
  path: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request to ${path} failed with status ${response.status}`);
  }

  const body = (await response.json()) as GraphQLResponseBody<T>;

  if (body.errors && body.errors.length > 0) {
    throw new GraphQLError(body.errors);
  }

  // A well-formed GraphQL response always has `data` when `errors` is absent/empty — a body
  // with neither is a malformed/unexpected server response, not a normal empty result.
  if (body.data === undefined) {
    throw new Error(`GraphQL request to ${path} returned no data and no errors`);
  }

  return body.data;
}
