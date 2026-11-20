import { useQueryClient } from "@tanstack/react-query";
import { graphqlFetch } from "../api/graphqlClient";
import { useGraphQLQuery } from "../api/useGraphQLQuery";
import type { AdminUserRow } from "./userAdminApi";

/**
 * Administration of the caller's own tenant beyond members and roles (roadmap 115): its security
 * settings (tenant-tier config keys), service accounts with their API keys (M5, M11) and its owner
 * (M8). GraphQL fields the gateway serves from the token issuer over gRPC; all admin-only, and
 * the server enforces the rest (only the owner transfers ownership, a key may not outlive
 * `auth.apiKeyMaxLifetimeDays`).
 */

const GRAPHQL_PATH = "/graphql";

// --- Security settings -----------------------------------------------------------------------

/** The tenant-tier keys the security tab edits, with the bounds their validators enforce. */
export const SECURITY_KEYS = {
  requireMfa: "auth.requireMfa",
  passwordMinLength: "auth.passwordMinLength",
  sessionTtlSeconds: "auth.sessionTtlSeconds",
  apiKeyMaxLifetimeDays: "auth.apiKeyMaxLifetimeDays",
} as const;

export const SECURITY_LIMITS = {
  passwordMinLength: { min: 8, max: 128 },
  sessionTtlMinutes: { min: 1, max: 43_200 },
  apiKeyMaxLifetimeDays: { min: 0, max: 3650 },
} as const;

export type ConfigItem = {
  key: string;
  value: unknown;
  level: string;
  /** Set for this tenant (otherwise the default applies). */
  overridden: boolean;
  public: boolean;
};

const CONFIG_KEY = ["workspace", "tenantConfig"];

export function useTenantConfig() {
  return useGraphQLQuery<{ tenantConfig: ConfigItem[] }, ConfigItem[]>(
    CONFIG_KEY,
    GRAPHQL_PATH,
    "{ tenantConfig { key value level overridden public } }",
    undefined,
    (r) => r.tenantConfig,
  );
}

export function useTenantConfigActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
  return {
    /** Rejects with `GraphQLError.code` `validation_failed` when the value is out of bounds. */
    async set(key: string, value: unknown) {
      await graphqlFetch(
        GRAPHQL_PATH,
        "mutation($key: String!, $value: Json!) { setTenantConfig(key: $key, value: $value) { key } }",
        { key, value },
      );
      await refresh();
    },
    /** Back to the default. */
    async reset(key: string) {
      await graphqlFetch(
        GRAPHQL_PATH,
        "mutation($key: String!) { resetTenantConfig(key: $key) { key } }",
        { key },
      );
      await refresh();
    },
  };
}

// --- Service accounts and API keys -----------------------------------------------------------

export type ServiceAccount = Pick<
  AdminUserRow,
  "id" | "displayName" | "status" | "roles" | "createdAt"
>;

export type ApiKey = {
  id: string;
  userId: string;
  name: string;
  /** The key's first characters (`mk_…`), enough to recognise it; the rest is never shown again. */
  prefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

/** A new key: `token` is the secret, shown once. */
export type CreatedApiKey = { apiKey: ApiKey; token: string };

const SA_KEY = ["workspace", "serviceAccounts"];
const apiKeysKey = (userId: string | null) => ["workspace", "apiKeys", userId];

export function useServiceAccounts() {
  return useGraphQLQuery<{ serviceAccounts: ServiceAccount[] }, ServiceAccount[]>(
    SA_KEY,
    GRAPHQL_PATH,
    "{ serviceAccounts { id displayName status roles createdAt } }",
    undefined,
    (r) => r.serviceAccounts,
  );
}

const API_KEY_FIELDS = "id userId name prefix expiresAt revokedAt lastUsedAt createdAt";

export function useApiKeys(userId: string | null) {
  return useGraphQLQuery<{ apiKeys: ApiKey[] }, ApiKey[]>(
    apiKeysKey(userId),
    GRAPHQL_PATH,
    `query($userId: ID!) { apiKeys(userId: $userId) { ${API_KEY_FIELDS} } }`,
    { userId },
    (r) => r.apiKeys,
    userId !== null,
  );
}

export function useServiceAccountActions() {
  const queryClient = useQueryClient();
  return {
    async createServiceAccount(name: string, roles: string[]): Promise<ServiceAccount> {
      const r = await graphqlFetch<{ createServiceAccount: ServiceAccount }>(
        GRAPHQL_PATH,
        "mutation($name: String!, $roles: [String!]) { createServiceAccount(name: $name, roles: $roles) { id displayName status roles createdAt } }",
        { name, roles },
      );
      await queryClient.invalidateQueries({ queryKey: SA_KEY });
      return r.createServiceAccount;
    },
    /** `expiresInDays` 0 or omitted: no expiry (refused when the tenant caps key lifetimes). */
    async createApiKey(
      userId: string,
      name: string,
      expiresInDays?: number,
    ): Promise<CreatedApiKey> {
      const r = await graphqlFetch<{ createApiKey: CreatedApiKey }>(
        GRAPHQL_PATH,
        `mutation($userId: ID!, $name: String!, $days: Int) { createApiKey(userId: $userId, name: $name, expiresInDays: $days) { token apiKey { ${API_KEY_FIELDS} } } }`,
        { userId, name, days: expiresInDays || null },
      );
      await queryClient.invalidateQueries({ queryKey: apiKeysKey(userId) });
      return r.createApiKey;
    },
    async revokeApiKey(key: ApiKey) {
      await graphqlFetch(GRAPHQL_PATH, "mutation($id: ID!) { revokeApiKey(id: $id) }", {
        id: key.id,
      });
      await queryClient.invalidateQueries({ queryKey: apiKeysKey(key.userId) });
    },
  };
}

// --- Owner -----------------------------------------------------------------------------------

export type OwnerRecovery = {
  id: string;
  newOwnerMemberId: string;
  requestedByEmail: string;
  reason: string;
  effectiveAt: string;
  createdAt: string;
  completedAt: string;
};

export type OwnerStatus = {
  ownerMemberId: string;
  ownerEmail: string;
  /** A platform admin's request to hand the tenant to a new owner, waiting out its 72 hours. */
  pendingRecovery: OwnerRecovery | null;
};

const OWNER_KEY = ["workspace", "ownerStatus"];
const OWNER_FIELDS =
  "ownerMemberId ownerEmail pendingRecovery { id newOwnerMemberId requestedByEmail reason effectiveAt createdAt completedAt }";

export function useOwnerStatus() {
  return useGraphQLQuery<{ ownerStatus: OwnerStatus }, OwnerStatus>(
    OWNER_KEY,
    GRAPHQL_PATH,
    `{ ownerStatus { ${OWNER_FIELDS} } }`,
    undefined,
    (r) => r.ownerStatus,
  );
}

export function useOwnerActions() {
  const queryClient = useQueryClient();
  const settle = async (status: OwnerStatus) => {
    queryClient.setQueryData(OWNER_KEY, { ownerStatus: status });
    // Owner protection changes what other admins may do to a member: the user list reflects it.
    await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
  };
  return {
    /** Only the current owner, to an active admin; takes effect at once. */
    async transferOwnership(memberId: string) {
      const r = await graphqlFetch<{ transferOwnership: OwnerStatus }>(
        GRAPHQL_PATH,
        `mutation($memberId: String!) { transferOwnership(memberId: $memberId) { ${OWNER_FIELDS} } }`,
        { memberId },
      );
      await settle(r.transferOwnership);
    },
    /** Any admin may stop a pending owner recovery during its 72 hours. */
    async cancelOwnerRecovery() {
      const r = await graphqlFetch<{ cancelOwnerRecovery: OwnerStatus }>(
        GRAPHQL_PATH,
        `mutation { cancelOwnerRecovery { ${OWNER_FIELDS} } }`,
      );
      await settle(r.cancelOwnerRecovery);
    },
  };
}
