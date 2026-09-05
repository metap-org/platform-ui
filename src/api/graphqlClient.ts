import { CSRF_HEADER_NAME, readCsrfCookie } from "./client";
import { notifySessionExpired } from "./sessionEvents";

/** GraphQL counterpart to `client.ts`'s `apiFetch`. POSTs a query/variables body and unwraps
 *  `{data, errors}` instead of a plain JSON body. For a BFF gateway that aggregates several
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

type QueuedRequest = {
  query: string;
  variables?: Record<string, unknown>;
  resolve: (data: unknown) => void;
  reject: (err: unknown) => void;
};

// One queue per (path, token) pair — several calls issued in the same tick against the same
// gateway with the same auth end up in one HTTP round trip; calls to a different `path` or with a
// different `token` never mix (they're different requests over the wire regardless of batching).
const queues = new Map<string, QueuedRequest[]>();
const scheduledFlushes = new Set<string>();

function queueKey(path: string, token?: string): string {
  return `${path}\u0000${token ?? ""}`;
}

function settleOne(body: GraphQLResponseBody<unknown>, path: string, item: QueuedRequest): void {
  if (body.errors && body.errors.length > 0) {
    item.reject(new GraphQLError(body.errors));
    return;
  }
  // A well-formed GraphQL response always has `data` when `errors` is absent/empty — a body
  // with neither is a malformed/unexpected server response, not a normal empty result.
  if (body.data === undefined) {
    item.reject(new Error(`GraphQL request to ${path} returned no data and no errors`));
    return;
  }
  item.resolve(body.data);
}

/** Fires the 1 HTTP request for everything `graphqlFetch` queued against `key` since the last
 *  flush. A lone queued item is sent exactly as before batching existed — a bare `{query,
 *  variables}` object — so a gateway that has never heard of batching (or simply wasn't hit by 2
 *  overlapping calls) sees zero wire-format change. 2+ items are sent as a JSON array in the same
 *  tick's order and read back as an array of `{data, errors}` in that same order
 *  (`GraphQLBatchRequest`/`Schema::execute_batch` on the gateway — see
 *  `metap/crates/graphql-gateway/src/server.rs` — accepts both shapes in the same POST body). */
async function flush(key: string, path: string, token?: string): Promise<void> {
  const items = queues.get(key) ?? [];
  queues.delete(key);
  scheduledFlushes.delete(key);
  if (items.length === 0) {
    return;
  }

  const csrfToken = token ? null : readCsrfCookie();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
  };
  const singleItem = items.length === 1 ? items[0] : undefined;

  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers,
      body: singleItem
        ? JSON.stringify({ query: singleItem.query, variables: singleItem.variables })
        : JSON.stringify(items.map((item) => ({ query: item.query, variables: item.variables }))),
    });

    if (!response.ok) {
      // Same cookie session backs a same-origin GraphQL gateway call as backs REST (see this
      // function's own doc comment) — a 401 here means that session died too, not just this one
      // request (`docs/features/31-session-expiry-redirect-and-refresh.md`). A `token`-authed call
      // (a different, gateway-only Bearer, minted fresh per call) is exempt: its own expiry says
      // nothing about the browser's session cookie.
      if (response.status === 401 && !token) {
        notifySessionExpired();
      }
      throw new Error(`GraphQL request to ${path} failed with status ${response.status}`);
    }

    if (singleItem) {
      const body = (await response.json()) as GraphQLResponseBody<unknown>;
      settleOne(body, path, singleItem);
      return;
    }

    const bodies = (await response.json()) as GraphQLResponseBody<unknown>[];
    if (!Array.isArray(bodies) || bodies.length !== items.length) {
      throw new Error(`GraphQL batch request to ${path} returned a mismatched response shape`);
    }
    bodies.forEach((body, i) => {
      const item = items[i];
      if (item) {
        settleOne(body, path, item);
      }
    });
  } catch (err) {
    items.forEach((item) => item.reject(err));
  }
}

/** `token` is now optional (2026-09-04 — see `crates/graphql-gateway/src/server.rs`'s module doc
 *  comment for the backend half of this). Passed: sends `Authorization: Bearer <token>` — for a
 *  gateway deployment that hasn't opted into `COOKIE_AUTH_ENABLED` (a separate origin from the
 *  services that issue the session, or any other Bearer-only deployment). Omitted: rides the
 *  existing session cookie instead, `credentials: "include"` plus the CSRF header exactly like
 *  `apiFetch` already does for REST — this is the default and preferred mode for a same-origin
 *  deployment (`../metap-demo-waf`'s Vite dev proxy / nginx both route `/graphql` through the
 *  same origin as `/auth/*`), since it needs no `GET /auth/token` round trip first: before this,
 *  every single GraphQL call cost 2 requests (mint a fresh short-lived Bearer, then the actual
 *  call) instead of 1 — the sole reason `GET /auth/token` was added in the first place.
 *
 *  Microtask-batched (2026-09-04): a call doesn't `fetch` immediately — it's queued and the queue
 *  flushes on the next microtask, so every `graphqlFetch`/`useGraphQLQuery` call made during the
 *  same synchronous render (e.g. `DashboardPage`'s several `useAggregate`/`useRecords` calls) ends
 *  up in 1 HTTP request instead of N, with each caller's own promise resolving/rejecting off its
 *  own slice of the response. Transparent to every caller — same signature, same per-call
 *  resolution, same errors; nothing about calling this function changes. */
export function graphqlFetch<T>(
  path: string,
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const key = queueKey(path, token);
  return new Promise<T>((resolve, reject) => {
    const item: QueuedRequest = {
      query,
      variables,
      resolve: resolve as (data: unknown) => void,
      reject,
    };
    const existing = queues.get(key);
    if (existing) {
      existing.push(item);
    } else {
      queues.set(key, [item]);
    }
    if (!scheduledFlushes.has(key)) {
      scheduledFlushes.add(key);
      queueMicrotask(() => {
        void flush(key, path, token);
      });
    }
  });
}
