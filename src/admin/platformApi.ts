import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { useApiQuery } from "../api/useApiQuery";

/**
 * The platform admin's tenant directory (roadmap 113 P3): `/platform/tenants*` on the token
 * issuer. Platform admin only; the server enforces it, `PlatformAdminOnly` just hides the page.
 * (`tenantAdmin.ts` is the older metap-lowcode control plane; this is the Go metap one.)
 */

export type TenantDirectoryEntry = {
  id: string;
  name: string;
  tier: string;
  strategy: string;
  /** provisioning, active, migrating, suspended, expired or deleted. */
  status: string;
  product: string;
  createdAt: string;
  trialExpiresAt: string;
  /** Both set while a deletion is pending, "" otherwise. */
  deletionRequestedAt: string;
  deletionEffectiveAt: string;
  memberCount: number;
};

export type TenantListFilter = { query: string; status: string; page: number };

export const TENANT_PAGE_SIZE = 25;

type TenantList = { tenants: TenantDirectoryEntry[]; total: number };

const KEY = ["platform", "directory"];

export function usePlatformTenantDirectory(filter: TenantListFilter) {
  const params = new URLSearchParams({
    limit: String(TENANT_PAGE_SIZE),
    offset: String(filter.page * TENANT_PAGE_SIZE),
  });
  if (filter.query.trim()) params.set("query", filter.query.trim());
  if (filter.status) params.set("status", filter.status);
  return useApiQuery<TenantList>([...KEY, filter], `/platform/tenants?${params.toString()}`);
}

export type CreateTenantInput = {
  name: string;
  tier?: string;
  adminEmail: string;
  adminDisplayName?: string;
};

export type CreatedTenant = {
  tenant: TenantDirectoryEntry;
  emailSent: boolean;
  /** Set when the invitation email could not be sent: the link to pass on by hand. */
  acceptUrl: string;
};

export function usePlatformTenantActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const post = async (path: string, body?: unknown) => {
    await apiFetch(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    await refresh();
  };
  return {
    async create(input: CreateTenantInput): Promise<CreatedTenant> {
      const created = await apiFetch<CreatedTenant>("/platform/tenants", {
        method: "POST",
        body: JSON.stringify(input),
      });
      await refresh();
      return created;
    },
    /** Renames a tenant and/or changes its tier; an omitted field is left alone. */
    async update(id: string, change: { name?: string; tier?: string }) {
      await apiFetch(`/platform/tenants/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(change),
      });
      await refresh();
    },
    suspend: (id: string) => post(`/platform/tenants/${encodeURIComponent(id)}/suspend`),
    resume: (id: string) => post(`/platform/tenants/${encodeURIComponent(id)}/resume`),
    /** Schedules deletion; the tenant is kept for `retentionDays` (server default 30). */
    requestDeletion: (id: string, retentionDays: number) =>
      post(`/platform/tenants/${encodeURIComponent(id)}/deletion`, { retentionDays }),
    async cancelDeletion(id: string) {
      await apiFetch(`/platform/tenants/${encodeURIComponent(id)}/deletion`, { method: "DELETE" });
      await refresh();
    },
  };
}

// --- Support session and owner recovery (roadmap 115 M10, M6) ---------------------------------

export type SupportSessionToken = {
  /** An API key (mk_...), shown once. */
  token: string;
  expiresAt: string;
  tenantId: string;
  role: string;
  grantId: string;
};

export type PlatformOwnerRecovery = {
  id: string;
  newOwnerMemberId: string;
  requestedByEmail: string;
  reason: string;
  /** Completable from this moment on. */
  effectiveAt: string;
  createdAt: string;
  completedAt: string;
};

export type TenantPerson = { id: string; email: string; displayName: string; isOwner: boolean };

export type TenantOwnerView = {
  owner: {
    ownerMemberId: string;
    ownerEmail: string;
    pendingRecovery: PlatformOwnerRecovery | null;
  };
  people: TenantPerson[];
};

const ownerKey = (tenantId: string) => ["platform", "owner", tenantId];

export function useTenantOwner(tenantId: string, enabled: boolean) {
  return useApiQuery<TenantOwnerView>(
    ownerKey(tenantId),
    `/platform/tenants/${encodeURIComponent(tenantId)}/owner`,
    undefined,
    enabled,
  );
}

export function useTenantAccessActions(tenantId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ownerKey(tenantId) });
  return {
    /** Needs an active support grant from the tenant; the server says so when there is none. */
    startSupportSession: (): Promise<SupportSessionToken> =>
      apiFetch<SupportSessionToken>("/platform/support-sessions", {
        method: "POST",
        body: JSON.stringify({ tenantId }),
      }),
    async requestRecovery(newOwnerMemberId: string, reason: string) {
      await apiFetch("/platform/owner-recovery", {
        method: "POST",
        body: JSON.stringify({ tenantId, newOwnerMemberId, reason }),
      });
      await refresh();
    },
    /** Only once the recovery's wait is over; the server refuses earlier. */
    async completeRecovery() {
      await apiFetch("/platform/owner-recovery/complete", {
        method: "POST",
        body: JSON.stringify({ tenantId }),
      });
      await refresh();
    },
  };
}
