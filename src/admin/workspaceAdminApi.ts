import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { emptyToNull } from "../api/emptyToNull";
import { useApiQuery } from "../api/useApiQuery";
import type { AdminUserRow } from "./userAdminApi";

/**
 * Administration of the caller's own tenant beyond members and roles (roadmap 115): its security
 * settings (tenant-tier config keys), service accounts with their API keys (M5, M11) and its owner
 * (M8). REST on the token issuer (`/admin/config`, `/admin/service-accounts`, `/admin/owner`); all
 * admin-only, and the server enforces the rest (only the owner transfers ownership, a key may not
 * outlive `auth.apiKeyMaxLifetimeDays`).
 */

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
  /** A secret's `value` is only a marker, never the secret: show it write-only. */
  secret?: boolean;
};

const CONFIG_KEY = ["workspace", "tenantConfig"];

export function useTenantConfig() {
  return useApiQuery<{ data: ConfigItem[] }, ConfigItem[]>(
    CONFIG_KEY,
    "/admin/config",
    (r) => r.data,
  );
}

export function useTenantConfigActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
  return {
    /** Rejects with `ApiError.code` `validation_failed` when the value is out of bounds. */
    async set(key: string, value: unknown) {
      await apiFetch(`/admin/config/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
      await refresh();
    },
    /** Back to the default. */
    async reset(key: string) {
      await apiFetch(`/admin/config/${encodeURIComponent(key)}`, { method: "DELETE" });
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
  return useApiQuery<{ users: ServiceAccount[] }, ServiceAccount[]>(
    SA_KEY,
    "/admin/service-accounts",
    (r) => r.users,
  );
}

function toApiKey(key: ApiKey): ApiKey {
  return emptyToNull(key, ["expiresAt", "revokedAt", "lastUsedAt"]);
}

export function useApiKeys(userId: string | null) {
  return useApiQuery<{ apiKeys: ApiKey[] }, ApiKey[]>(
    apiKeysKey(userId),
    `/admin/users/${encodeURIComponent(userId ?? "")}/api-keys`,
    (r) => r.apiKeys.map(toApiKey),
    userId !== null,
  );
}

export function useServiceAccountActions() {
  const queryClient = useQueryClient();
  return {
    async createServiceAccount(name: string, roles: string[]): Promise<ServiceAccount> {
      const account = await apiFetch<ServiceAccount>("/admin/service-accounts", {
        method: "POST",
        body: JSON.stringify({ name, roles }),
      });
      await queryClient.invalidateQueries({ queryKey: SA_KEY });
      return account;
    },
    /** `expiresInDays` 0 or omitted: no expiry (refused when the tenant caps key lifetimes). */
    async createApiKey(
      userId: string,
      name: string,
      expiresInDays?: number,
    ): Promise<CreatedApiKey> {
      const created = await apiFetch<CreatedApiKey>(
        `/admin/users/${encodeURIComponent(userId)}/api-keys`,
        { method: "POST", body: JSON.stringify({ name, expiresInDays: expiresInDays || 0 }) },
      );
      await queryClient.invalidateQueries({ queryKey: apiKeysKey(userId) });
      return { ...created, apiKey: toApiKey(created.apiKey) };
    },
    async revokeApiKey(key: ApiKey) {
      await apiFetch(`/admin/api-keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
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
export function useOwnerStatus() {
  return useApiQuery<OwnerStatus>(OWNER_KEY, "/admin/owner");
}

export function useOwnerActions() {
  const queryClient = useQueryClient();
  const settle = async (status: OwnerStatus) => {
    queryClient.setQueryData(OWNER_KEY, status);
    // Owner protection changes what other admins may do to a member: the user list reflects it.
    await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
  };
  return {
    /** Only the current owner, to an active admin; takes effect at once. */
    async transferOwnership(memberId: string) {
      await settle(
        await apiFetch<OwnerStatus>("/admin/owner/transfer", {
          method: "POST",
          body: JSON.stringify({ memberId }),
        }),
      );
    },
    /** Any admin may stop a pending owner recovery during its 72 hours. */
    async cancelOwnerRecovery() {
      await settle(await apiFetch<OwnerStatus>("/admin/owner/recovery/cancel", { method: "POST" }));
    },
  };
}
