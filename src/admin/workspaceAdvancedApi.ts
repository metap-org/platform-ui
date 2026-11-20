import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { ApiError, CSRF_HEADER_NAME, readCsrfCookie } from "../api/client";
import { graphqlFetch } from "../api/graphqlClient";
import { useGraphQLQuery } from "../api/useGraphQLQuery";

/**
 * The tenant admin's single sign-on (roadmap 115 M7), support access (M10) and audit trail (M9).
 * GraphQL fields served by the token issuer over gRPC, admin-only; the audit file download is
 * REST (`GET /admin/audit/export`), since a file has no GraphQL shape.
 */

const GRAPHQL_PATH = "/graphql";

// --- Single sign-on (OIDC) -------------------------------------------------------------------

export type SsoConfig = {
  configured: boolean;
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  /** The secret is write-only: never returned, only whether one is stored. */
  hasClientSecret: boolean;
  scopes: string[];
  emailDomains: string[];
  defaultRole: string;
  /** Password sign-in refused for everyone but the owner. */
  enforced: boolean;
  postLoginRedirect: string;
  /** The callback URL to register at the identity provider. */
  redirectUri: string;
};

export type SsoConfigInput = {
  issuerUrl: string;
  clientId: string;
  /** Empty keeps the stored secret. */
  clientSecret?: string;
  scopes: string[];
  emailDomains: string[];
  defaultRole?: string;
  enabled: boolean;
  enforced: boolean;
  postLoginRedirect?: string;
};

const SSO_FIELDS =
  "configured enabled issuerUrl clientId hasClientSecret scopes emailDomains defaultRole enforced postLoginRedirect redirectUri";
const SSO_KEY = ["workspace", "sso"];

export function useSsoConfig() {
  return useGraphQLQuery<{ ssoConfig: SsoConfig }, SsoConfig>(
    SSO_KEY,
    GRAPHQL_PATH,
    `{ ssoConfig { ${SSO_FIELDS} } }`,
    undefined,
    (r) => r.ssoConfig,
  );
}

export function useSsoActions() {
  const queryClient = useQueryClient();
  return {
    /** The server checks the issuer's discovery document before saving; only the owner may
     *  turn `enforced` on. */
    async save(input: SsoConfigInput): Promise<SsoConfig> {
      const r = await graphqlFetch<{ setSsoConfig: SsoConfig }>(
        GRAPHQL_PATH,
        `mutation($issuerUrl: String!, $clientId: String!, $clientSecret: String, $scopes: [String!], $emailDomains: [String!], $defaultRole: String, $enabled: Boolean!, $enforced: Boolean, $postLoginRedirect: String) {
          setSsoConfig(issuerUrl: $issuerUrl, clientId: $clientId, clientSecret: $clientSecret, scopes: $scopes, emailDomains: $emailDomains, defaultRole: $defaultRole, enabled: $enabled, enforced: $enforced, postLoginRedirect: $postLoginRedirect) { ${SSO_FIELDS} }
        }`,
        { ...input, clientSecret: input.clientSecret || null },
      );
      queryClient.setQueryData(SSO_KEY, { ssoConfig: r.setSsoConfig });
      return r.setSsoConfig;
    },
    /** Removes the connection; members sign in with passwords again. */
    async remove() {
      await graphqlFetch(GRAPHQL_PATH, "mutation { deleteSsoConfig }");
      await queryClient.invalidateQueries({ queryKey: SSO_KEY });
    },
  };
}

// --- Support access ---------------------------------------------------------------------------

export type SupportSessionInfo = { memberId: string; startedByEmail: string; startedAt: string };

export type SupportGrant = {
  id: string;
  reason: string;
  /** What the platform's support staff act as inside the tenant. */
  role: string;
  grantedBy: string;
  expiresAt: string;
  revokedAt: string;
  createdAt: string;
  active: boolean;
  sessions: SupportSessionInfo[];
};

const GRANT_FIELDS =
  "id reason role grantedBy expiresAt revokedAt createdAt active sessions { memberId startedByEmail startedAt }";
const GRANTS_KEY = ["workspace", "supportGrants"];

export function useSupportGrants() {
  return useGraphQLQuery<{ supportGrants: SupportGrant[] }, SupportGrant[]>(
    GRANTS_KEY,
    GRAPHQL_PATH,
    `{ supportGrants { ${GRANT_FIELDS} } }`,
    undefined,
    (r) => r.supportGrants,
  );
}

export function useSupportActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: GRANTS_KEY });
  return {
    /** `hours` 1–168 (default 24 on the server). */
    async grant(reason: string, role: string, hours: number) {
      await graphqlFetch(
        GRAPHQL_PATH,
        `mutation($reason: String!, $role: String!, $hours: Int) { grantSupportAccess(reason: $reason, role: $role, hours: $hours) { id } }`,
        { reason, role, hours },
      );
      await refresh();
    },
    /** Ends the access at once: every support key is revoked, every support account removed. */
    async revoke(id: string) {
      await graphqlFetch(
        GRAPHQL_PATH,
        "mutation($id: ID!) { revokeSupportGrant(id: $id) { id } }",
        { id },
      );
      await refresh();
    },
  };
}

// --- Audit trail ------------------------------------------------------------------------------

export type AuditEntry = {
  id: string;
  entity: string;
  recordId: string;
  action: string;
  transitionAction: string;
  actorUserId: string;
  reason: string;
  occurredAt: string;
  /** `{ field: [before, after] }` as JSON. */
  diffJson: string;
  /** Position in the tenant's tamper-evident chain; 0 for history from before the chain. */
  seq: number;
  hash: string;
};

export type AuditFilter = {
  actorUserId?: string;
  entity?: string;
  recordId?: string;
  actions?: string[];
  /** RFC 3339. */
  from?: string;
  to?: string;
};

export type AuditChainReport = {
  ok: boolean;
  checked: number;
  brokenSeq: number;
  reason: string;
  headSeq: number;
  headHash: string;
};

const AUDIT_PAGE = 50;

export function useAuditEntries(filter: AuditFilter) {
  const { status } = useAuth();
  return useInfiniteQuery({
    queryKey: ["workspace", "audit", filter],
    enabled: status === "authenticated",
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const r = await graphqlFetch<{
        auditEntries: { entries: AuditEntry[]; nextCursor: string };
      }>(
        GRAPHQL_PATH,
        `query($actorUserId: String, $entity: String, $recordId: String, $actions: [String!], $from: String, $to: String, $cursor: String, $limit: Int) {
          auditEntries(actorUserId: $actorUserId, entity: $entity, recordId: $recordId, actions: $actions, from: $from, to: $to, cursor: $cursor, limit: $limit) {
            nextCursor entries { id entity recordId action transitionAction actorUserId reason occurredAt diffJson seq hash }
          }
        }`,
        { ...filter, cursor: pageParam || null, limit: AUDIT_PAGE },
      );
      return r.auditEntries;
    },
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
}

/** Recomputes the tenant's hash chain end to end. */
export async function verifyAuditChain(): Promise<AuditChainReport> {
  const r = await graphqlFetch<{ verifyAuditChain: AuditChainReport }>(
    GRAPHQL_PATH,
    "{ verifyAuditChain { ok checked brokenSeq reason headSeq headHash } }",
  );
  return r.verifyAuditChain;
}

/** Downloads every entry matching `filter` as a CSV or JSON file. Fetched rather than opened as
 *  a link: a link would ask for text/html, which the dev server and nginx answer with the SPA. */
export async function downloadAuditExport(filter: AuditFilter, format: "csv" | "json") {
  const params = new URLSearchParams({ format });
  if (filter.actorUserId) params.set("actor", filter.actorUserId);
  if (filter.entity) params.set("entity", filter.entity);
  if (filter.recordId) params.set("record", filter.recordId);
  if (filter.actions?.length) params.set("actions", filter.actions.join(","));
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  const csrf = readCsrfCookie();
  const response = await fetch(`/admin/audit/export?${params.toString()}`, {
    credentials: "include",
    headers: csrf ? { [CSRF_HEADER_NAME]: csrf } : {},
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code: string; message: string };
    } | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "unknown_error",
      body?.error?.message ?? response.statusText,
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-${new Date().toISOString().slice(0, 10)}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}
