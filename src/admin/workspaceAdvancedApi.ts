import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { ApiError, apiFetch, CSRF_HEADER_NAME, readCsrfCookie } from "../api/client";
import { useApiQuery } from "../api/useApiQuery";

/**
 * The tenant admin's single sign-on (roadmap 115 M7), support access (M10) and audit trail (M9).
 * REST on the token issuer (`/admin/sso`, `/admin/support-grants`, `/admin/audit*`), admin-only.
 */

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
  /** The id_token claim that carries groups or roles, and what each value means here. */
  roleClaim: string;
  roleMap: Record<string, string>;
  /** The callback URL to register at the identity provider. */
  redirectUri: string;
  /** Each domain named above and whether the workspace has proved it owns it. */
  domains: SsoDomain[];
};

export type SsoDomain = {
  domain: string;
  status: "pending" | "verified";
  /** Publish `verifyValue` as a TXT record at `verifyHost`, then check. */
  verifyHost: string;
  verifyValue: string;
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
  roleClaim: string;
  roleMap: Record<string, string>;
};

const SSO_KEY = ["workspace", "sso"];

export function useSsoConfig() {
  return useApiQuery<SsoConfig>(SSO_KEY, "/admin/sso");
}

export function useSsoActions() {
  const queryClient = useQueryClient();
  return {
    /** The server checks the issuer's discovery document before saving; only the owner may
     *  turn `enforced` on. */
    async save(input: SsoConfigInput): Promise<SsoConfig> {
      const saved = await apiFetch<SsoConfig>("/admin/sso", {
        method: "PUT",
        body: JSON.stringify({ ...input, clientSecret: input.clientSecret || "" }),
      });
      queryClient.setQueryData(SSO_KEY, saved);
      return saved;
    },
    /** Looks for the domain's ownership record. Rejects (409 `domain_not_verified`) while it is
     *  not there yet; `unique_violation` when another workspace already owns the domain. */
    async verifyDomain(domain: string): Promise<SsoConfig> {
      const saved = await apiFetch<SsoConfig>(
        `/admin/sso/domains/${encodeURIComponent(domain)}/verify`,
        { method: "POST" },
      );
      queryClient.setQueryData(SSO_KEY, saved);
      return saved;
    },
    /** Removes the connection; members sign in with passwords again. */
    async remove() {
      await apiFetch("/admin/sso", { method: "DELETE" });
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

const GRANTS_KEY = ["workspace", "supportGrants"];

export function useSupportGrants() {
  return useApiQuery<{ grants: SupportGrant[] }, SupportGrant[]>(
    GRANTS_KEY,
    "/admin/support-grants",
    (r) => r.grants,
  );
}

export function useSupportActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: GRANTS_KEY });
  return {
    /** `hours` 1–168 (default 24 on the server). */
    async grant(reason: string, role: string, hours: number) {
      await apiFetch("/admin/support-grants", {
        method: "POST",
        body: JSON.stringify({ reason, role, hours }),
      });
      await refresh();
    },
    /** Ends the access at once: every support key is revoked, every support account removed. */
    async revoke(id: string) {
      await apiFetch(`/admin/support-grants/${encodeURIComponent(id)}/revoke`, { method: "POST" });
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

/** The audit filter as the search and export routes read it. */
function auditParams(filter: AuditFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.actorUserId) params.set("actor", filter.actorUserId);
  if (filter.entity) params.set("entity", filter.entity);
  if (filter.recordId) params.set("record", filter.recordId);
  if (filter.actions?.length) params.set("actions", filter.actions.join(","));
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  return params;
}

export function useAuditEntries(filter: AuditFilter) {
  const { status } = useAuth();
  return useInfiniteQuery({
    queryKey: ["workspace", "audit", filter],
    enabled: status === "authenticated",
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = auditParams(filter);
      params.set("limit", String(AUDIT_PAGE));
      if (pageParam) params.set("cursor", pageParam);
      return apiFetch<{ entries: AuditEntry[]; nextCursor: string }>(
        `/admin/audit?${params.toString()}`,
      );
    },
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
}

/** Recomputes the tenant's hash chain end to end. */
export async function verifyAuditChain(): Promise<AuditChainReport> {
  return apiFetch<AuditChainReport>("/admin/audit/verify", { method: "POST" });
}

/** Downloads every entry matching `filter` as a CSV or JSON file. Fetched rather than opened as
 *  a link: a link would ask for text/html, which the dev server and nginx answer with the SPA. */
export async function downloadAuditExport(filter: AuditFilter, format: "csv" | "json") {
  const params = auditParams(filter);
  params.set("format", format);
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

// --- Credentials -------------------------------------------------------------------------------

/** Where a credential's value lives: encrypted in metap's own database, or in the deployment's
 *  external secret manager (Vault, AWS or GCP Secret Manager). */
export type CredentialSource = "database" | "external";

/** What a credential is, so a form offers only the ones that fit: an HTTP `Authorization` header
 *  value, any opaque secret, or a username and password (sent as HTTP Basic by a webhook). */
export type CredentialKind = "authorization" | "secret" | "userpass";

/** Something that links to a credential (today: a cron job). */
export type CredentialUse = { kind: string; id: string; name: string };

export type Credential = {
  id: string;
  name: string;
  description: string;
  kind: CredentialKind;
  /** Shown for a `userpass` credential; its password is write-only like any value. */
  username: string;
  source: CredentialSource;
  createdAt: string;
  updatedAt: string;
  usedBy: CredentialUse[];
};

export type CredentialsView = {
  credentials: Credential[];
  /** The deployment can store credentials encrypted in the database. */
  databaseAvailable: boolean;
  /** An external secret manager takes writes; `externalKind` names it (`vault`, `aws`, `gcp`). */
  externalAvailable: boolean;
  externalKind: string;
};

export type CredentialInput = {
  name: string;
  description?: string;
  kind: CredentialKind;
  /** Required for `userpass` (then `value` is the password), refused for the other kinds. */
  username?: string;
  source: CredentialSource;
  value: string;
};

/** Changes only what is set. A `value` replaces the stored one; changing `source` needs a `value`
 *  too (a stored value is never read back). */
export type CredentialPatch = {
  name?: string;
  description?: string;
  /** `userpass` only; the password stays unless `value` is set. */
  username?: string;
  source?: CredentialSource;
  value?: string;
};

const CREDENTIALS_KEY = ["workspace", "credentials"];

export function useCredentials() {
  return useApiQuery<CredentialsView>(CREDENTIALS_KEY, "/admin/credentials");
}

export function useCredentialActions() {
  const queryClient = useQueryClient();
  const settle = (view: CredentialsView) => queryClient.setQueryData(CREDENTIALS_KEY, view);
  return {
    async create(input: CredentialInput) {
      settle(
        await apiFetch<CredentialsView>("/admin/credentials", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
    },
    async update(id: string, patch: CredentialPatch) {
      settle(
        await apiFetch<CredentialsView>(`/admin/credentials/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
      );
    },
    /** Refused with `record_referenced` while a job uses it (`fieldErrors.usedBy` names them). */
    async remove(id: string) {
      settle(
        await apiFetch<CredentialsView>(`/admin/credentials/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      );
    },
  };
}
