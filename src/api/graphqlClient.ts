/** GraphQL counterpart to `client.ts`'s `apiFetch` — same shape (relative `path`, bearer token,
 *  same-origin dev-proxy convention) but POSTs a query/variables body and unwraps
 *  `{data, errors}` instead of a plain JSON body. For a BFF gateway that aggregates several
 *  backend services into 1 GraphQL schema (e.g. `metap`'s `graphql-gateway`) — not a general
 *  replacement for `apiFetch`: flat per-entity CRUD screens (`GeneratedList`/`RecordDetail`)
 *  stay on REST, this is for a page that genuinely needs 1 round-trip across several services'
 *  data instead of a client-side entity-by-entity fetch. See that gateway's own README for why
 *  it's query-only in practice (no per-caller identity propagation to mutate through safely).
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

export async function graphqlFetch<T>(
  path: string,
  token: string | null,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
