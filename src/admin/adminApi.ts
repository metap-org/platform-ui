import { useQueryClient } from "@tanstack/react-query";
import { useApiMutation } from "../api/useApiMutation";
import { useApiQuery } from "../api/useApiQuery";
import { useAuth } from "../auth/AuthContext";
import { apiFetch, ApiError } from "../api/client";
import type { PolicyCondition } from "./policyCondition";

export type AdminUser = { userId: string; roles: string[] };

/** `condition` is a real `PolicyCondition` (see `./policyCondition.ts`), not `unknown` — the
 *  single hand-typed mirror of `crates/metap-permission/src/policy_condition/types.rs`'s wire
 *  shape. `subject`/`effect` stay plain strings (`"context"|"record"`, `"allow"|"deny"`)
 *  rather than a second enum type — narrow only where a caller actually branches on them
 *  (`isBasicShapedRow`, the matrix/advanced-panel components). */
export type AdminPolicy = {
  id: string;
  tenantId: string;
  entity: string;
  action: string;
  field: string | null;
  subject: string;
  roles: string[] | null;
  condition: PolicyCondition | null;
  effect: string;
  createdBy: string | null;
};

export type CronJob = {
  id: string;
  tenantId: string;
  name: string;
  enabled: boolean;
  cronExpr: string;
  timezone: string;
  targetType: string;
  targetConfig: unknown;
  dispatchMode: string;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

export type CronJobRun = {
  id: string;
  tenantId: string;
  jobId: string;
  status: string;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  responseSummary: unknown;
  createdAt: string;
};

/** Matches `crates/metap-metadata/src/entity.rs`'s `EntityField`/`EntityListView`/
 * `EntityWorkflow` wire shape loosely (`unknown`, not a typed mirror) — the low-code admin
 * page edits these as raw JSON, same as `PoliciesAdminPage`'s `PolicyCondition` textarea, so
 * this crate doesn't need to keep a second copy of the field-shape type in sync by hand.
 * `workflow` is `unknown` rather than absent — DB-authored entities can carry one since Phase
 * 11 Phase B's guard-model un-skip (`docs/roadmap.md`, 2026-08-17). */
export type LowCodeEntityDefinition = {
  name: string;
  label: string;
  fields: unknown[];
  listViews: unknown[];
  workflow?: unknown;
};

export type LowCodeEntitySummary = { name: string; published: boolean; enabled: boolean };
export type LowCodeEntitiesList = { entities: LowCodeEntitySummary[] };

export type LowCodePublishedVersion = {
  versionNumber: number;
  definition: LowCodeEntityDefinition;
  publishedAt: string;
  restoredFromVersion: number | null;
};

export type LowCodeVersionSummary = {
  versionNumber: number;
  publishedAt: string;
  restoredFromVersion: number | null;
};

// --- Users ---

export function useAdminUsers() {
  return useApiQuery<{ data: AdminUser[] }, AdminUser[]>(
    ["admin", "users"],
    "/admin/users",
    (response) => response.data,
  );
}

export function useCreateAdminUser() {
  return useApiMutation<
    { data: { userId: string; email: string; roles: string[] } },
    { email: string; password: string; roles: string[] }
  >("POST", "/admin/users");
}

/** Row-level actions (assign/revoke role) need a per-user path, which `useApiMutation`'s
 * fixed-path shape can't express — same convention as `GeneratedList`'s per-row delete: a
 * plain `apiFetch` call plus manual invalidation instead of a bound mutation hook. */
export function useAdminRoleActions() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  async function assignRole(userId: string, role: string) {
    await apiFetch(`/admin/users/${userId}/roles`, token, {
      method: "POST",
      body: JSON.stringify({ role }),
    });
    await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
  }

  async function revokeRole(userId: string, role: string) {
    await apiFetch(`/admin/users/${userId}/roles/${role}`, token, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
  }

  return { assignRole, revokeRole };
}

// --- Policies ---

export function useAdminPolicies(entity?: string, enabled = true) {
  const path = entity ? `/admin/policies?entity=${encodeURIComponent(entity)}` : "/admin/policies";
  return useApiQuery<{ data: AdminPolicy[] }, AdminPolicy[]>(
    ["admin", "policies", entity ?? null],
    path,
    (response) => response.data,
    enabled,
  );
}

export function useCreateAdminPolicy() {
  return useApiMutation<
    { data: AdminPolicy },
    {
      entity: string;
      action: string;
      roles?: string[];
      condition?: PolicyCondition | null;
      field?: string;
      subject?: string;
      effect?: string;
    }
  >("POST", "/admin/policies");
}

export function useDeleteAdminPolicy() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return async function deletePolicy(id: string) {
    await apiFetch(`/admin/policies/${id}`, token, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["admin", "policies"] });
  };
}

/** The RBAC permission matrix's single save call (`PermissionMatrix.tsx`) — replaces the entire
 *  basic-shaped policy set for `entity` with exactly `grants` in one atomic backend transaction
 *  (`PUT /admin/policies/matrix`, `PolicyStore::sync_basic_policies`), instead of firing one
 *  `POST`/`DELETE` per checkbox click. `role: null` means the matrix's pinned "Everyone" row (an
 *  open, `roles IS NULL` policy). Never touches an Advanced-tab policy — see that trait method's
 *  doc comment (`crates/metap-permission/src/policy_store.rs`) for the exact boundary. */
export function useSyncMatrixPolicies() {
  return useApiMutation<
    { data: AdminPolicy[] },
    { entity: string; grants: { role: string | null; action: string }[] }
  >("PUT", "/admin/policies/matrix");
}

/** The fixed action set a policy can grant (`GET /metadata/actions`, backed by
 *  `EntityAction::ALL` — `crates/metap-permission/src/context.rs`) — single source of truth for
 *  the matrix's action columns and the Advanced form's action picker, instead of a second
 *  hand-typed mirror of this list. */
export function useKnownActions() {
  return useApiQuery<{ data: string[] }, string[]>(
    ["metadata", "actions"],
    "/metadata/actions",
    (response) => response.data,
  );
}

// --- Cron jobs ---

export function useAdminCronJobs() {
  return useApiQuery<{ data: CronJob[] }, CronJob[]>(
    ["admin", "cronJobs"],
    "/admin/cron-jobs",
    (response) => response.data,
  );
}

export function useCronJobRuns(jobId: string | null) {
  return useApiQuery<{ data: CronJobRun[] }, CronJobRun[]>(
    ["admin", "cronJobs", jobId, "runs"],
    `/admin/cron-jobs/${jobId}/runs`,
    (response) => response.data,
    jobId !== null,
  );
}

export function useCreateAdminCronJob() {
  return useApiMutation<
    { data: CronJob },
    {
      name: string;
      cronExpr: string;
      timezone: string;
      targetType: string;
      targetConfig: unknown;
      dispatchMode: string;
      enabled: boolean;
    }
  >("POST", "/admin/cron-jobs");
}

/** Row-level actions (update/delete) need a per-job path — see `useAdminRoleActions`'s doc
 * comment for why this bypasses `useApiMutation`. */
export function useAdminCronJobActions() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  async function toggleEnabled(job: CronJob) {
    await apiFetch(`/admin/cron-jobs/${job.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !job.enabled }),
    });
    await queryClient.invalidateQueries({ queryKey: ["admin", "cronJobs"] });
  }

  async function deleteJob(id: string) {
    await apiFetch(`/admin/cron-jobs/${id}`, token, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["admin", "cronJobs"] });
  }

  return { toggleEnabled, deleteJob };
}

// --- Low-code entities (`docs/roadmap.md` Phase 11 / Phase A) ---

export function useLowCodeEntities() {
  return useApiQuery<{ data: LowCodeEntitiesList }, LowCodeEntitiesList>(
    ["admin", "lowcode", "entities"],
    "/admin/lowcode/entities",
    (response) => response.data,
  );
}

export function useLowCodeVersions(name: string | null) {
  return useApiQuery<{ data: LowCodeVersionSummary[] }, LowCodeVersionSummary[]>(
    ["admin", "lowcode", name, "versions"],
    `/admin/lowcode/entities/${name}/versions`,
    (response) => response.data,
    name !== null,
  );
}

/** Every low-code action is scoped to a specific entity name — none of them fit
 * `useApiMutation`'s fixed-path shape, same reasoning as `useAdminRoleActions`/
 * `useAdminCronJobActions`. */
export function useLowCodeActions() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  async function getDraft(name: string): Promise<LowCodeEntityDefinition | null> {
    try {
      const result = await apiFetch<{ data: LowCodeEntityDefinition }>(
        `/admin/lowcode/entities/${name}/draft`,
        token,
      );
      return result.data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async function saveDraft(
    name: string,
    body: { label: string; fields: unknown[]; listViews: unknown[]; workflow?: unknown },
  ) {
    const result = await apiFetch<{ data: LowCodeEntityDefinition }>(
      `/admin/lowcode/entities/${name}/draft`,
      token,
      { method: "PUT", body: JSON.stringify(body) },
    );
    await queryClient.invalidateQueries({ queryKey: ["admin", "lowcode", "entities"] });
    return result.data;
  }

  async function publish(name: string) {
    const result = await apiFetch<{ data: { versionNumber: number } }>(
      `/admin/lowcode/entities/${name}/publish`,
      token,
      { method: "POST" },
    );
    await queryClient.invalidateQueries({ queryKey: ["admin", "lowcode"] });
    // This actually swaps the live `MetadataRegistry` — `useEntities`/`useEntity` cache it with
    // `staleTime: Infinity` specifically because they rely on this invalidation (not a timed
    // refetch) to notice a published schema change, so it can't be skipped here the way
    // `previewPublish` skips it.
    await queryClient.invalidateQueries({ queryKey: ["entities"] });
    await queryClient.invalidateQueries({ queryKey: ["entity", name] });
    return result.data;
  }

  /** Read-only — validates the draft the same way `publish` would, without writing a version
   * row or swapping the live registry. No `invalidateQueries` call, unlike every other action
   * here: nothing this touches actually changes. */
  async function previewPublish(name: string) {
    const result = await apiFetch<{ data: { valid: boolean; wouldBeVersion: number } }>(
      `/admin/lowcode/entities/${name}/publish/preview`,
      token,
      { method: "POST" },
    );
    return result.data;
  }

  async function rollback(name: string, toVersionNumber: number) {
    const result = await apiFetch<{ data: { versionNumber: number } }>(
      `/admin/lowcode/entities/${name}/rollback`,
      token,
      { method: "POST", body: JSON.stringify({ toVersionNumber }) },
    );
    await queryClient.invalidateQueries({ queryKey: ["admin", "lowcode"] });
    // See `publish`'s comment — rollback swaps the live registry too.
    await queryClient.invalidateQueries({ queryKey: ["entities"] });
    await queryClient.invalidateQueries({ queryKey: ["entity", name] });
    return result.data;
  }

  async function setEnabled(name: string, enabled: boolean) {
    await apiFetch(`/admin/lowcode/entities/${name}`, token, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
    await queryClient.invalidateQueries({ queryKey: ["admin", "lowcode", "entities"] });
    // See `publish`'s comment — disabling/enabling an entity changes what the live registry
    // serves too (a disabled entity drops out of `GET /metadata/entities`).
    await queryClient.invalidateQueries({ queryKey: ["entities"] });
    await queryClient.invalidateQueries({ queryKey: ["entity", name] });
  }

  return { getDraft, saveDraft, publish, previewPublish, rollback, setEnabled };
}
