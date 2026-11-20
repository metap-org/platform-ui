import { apiFetch } from "./client";

/**
 * metap itself speaks REST only (roadmap 116); this module is the one GraphQL client left in
 * platform-ui, for an outside system: metap-lowcode's control plane (tenant provisioning, low-code
 * audit), which still exposes GraphQL.
 *
 * Bearer-token bridge to the `control-plane-graphql` gateway (`../../../metap-lowcode/services/
 * control-plane-graphql`) — that gateway is deliberately Bearer-only, no cookie-auth mode (see
 * its own `src/auth.rs` doc comment: it runs on its own separate origin from `control-api`/
 * `lowcode-admin-api`, the 2 services whose session cookie it would otherwise need to ride the
 * same way a same-origin cookie session would). So every call here mints a short-lived Bearer via `GET /auth/token` against
 * `authTokenUrl` first (2 round trips per call).
 *
 * No hardcoded URL/port and no environment-variable convention here on purpose — `platform-ui`
 * has zero backend-topology knowledge of its own (every existing REST/GraphQL call in this repo
 * takes its target as an explicit parameter, resolved by whichever consuming app's own dev
 * proxy/build config decides); `gatewayUrl`/`authTokenUrl` follow that same convention.
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
 *  query/mutation needs (each call mints its own token first), a real but accepted cost for a
 *  Bearer-only gateway on its own origin. */
export async function controlPlaneGraphqlFetch<T>(
  gatewayUrl: string,
  authTokenUrl: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = await fetchControlPlaneToken(authTokenUrl);
  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Control-plane request failed with status ${response.status}`);
  }
  const body = (await response.json()) as {
    data?: T;
    errors?: { message: string; extensions?: { code?: string } }[];
  };
  if (body.errors && body.errors.length > 0) {
    throw new ControlPlaneError(
      body.errors.map((e) => e.message).join("; "),
      body.errors[0]?.extensions?.code ?? "unknown_error",
    );
  }
  if (body.data === undefined) {
    throw new Error("Control-plane request returned no data and no errors");
  }
  return body.data;
}

/** A GraphQL error answer from the control plane; `code` is the first error's. */
export class ControlPlaneError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message || "Control-plane request failed");
    this.name = "ControlPlaneError";
    this.code = code;
  }
}
