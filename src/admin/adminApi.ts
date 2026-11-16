import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../api/client";
import { graphqlFetch, GraphQLError } from "../api/graphqlClient";
import { useApiQuery } from "../api/useApiQuery";
import { useGraphQLQuery } from "../api/useGraphQLQuery";
import type { PolicyCondition } from "./policyCondition";

const GRAPHQL_PATH = "/graphql";

/** Shared selection set for `Policy` (`metap-graphql-http::platform_fields`, Phase 97 — real
 *  GraphQL object type since 2026-09-26, not `Json`) — reused by `policies`/`createPolicy`/
 *  `syncPolicyMatrix`, one field list to keep in sync with `AdminPolicy` instead of three. */
const POLICY_SELECTION = "id tenantId entity action field subject roles condition createdBy effect";

/** Shared selection set for `CronJob` — reused by `cronJobs`/`createCronJob`/`updateCronJob`. */
const CRON_JOB_SELECTION =
  "id tenantId name enabled cronExpr timezone targetType targetConfig dispatchMode nextRunAt lastRunAt createdAt updatedAt createdBy";

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

// --- Users --- moved to ./userAdminApi.ts (gRPC-backed GraphQL fields, roadmap 113).

// --- Policies ---
// Moved onto GraphQL 2026-09-26 (`policies`/`createPolicy`/`deletePolicy`/`syncPolicyMatrix`) —
// `/admin/policies*`'s replacement.

export function useAdminPolicies(entity?: string, enabled = true) {
  return useGraphQLQuery<{ policies: AdminPolicy[] }, AdminPolicy[]>(
    ["admin", "policies", entity ?? null],
    GRAPHQL_PATH,
    `query($entity: String) { policies(entity: $entity) { ${POLICY_SELECTION} } }`,
    { entity: entity ?? null },
    (response) => response.policies,
    enabled,
  );
}

export function useCreateAdminPolicy() {
  return useMutation<
    AdminPolicy,
    GraphQLError,
    {
      entity: string;
      action: string;
      roles?: string[];
      condition?: PolicyCondition | null;
      field?: string;
      subject?: string;
      effect?: string;
    }
  >({
    mutationFn: (body) =>
      graphqlFetch<{ createPolicy: AdminPolicy }>(
        GRAPHQL_PATH,
        `mutation($entity: String!, $action: String!, $roles: [String!], $condition: Json, $field: String, $subject: String, $effect: String) { createPolicy(entity: $entity, action: $action, roles: $roles, condition: $condition, field: $field, subject: $subject, effect: $effect) { ${POLICY_SELECTION} } }`,
        body,
      ).then((r) => r.createPolicy),
  });
}

export function useDeleteAdminPolicy() {
  const queryClient = useQueryClient();

  return async function deletePolicy(id: string) {
    await graphqlFetch(GRAPHQL_PATH, "mutation($id: ID!) { deletePolicy(id: $id) }", { id });
    await queryClient.invalidateQueries({ queryKey: ["admin", "policies"] });
  };
}

/** The RBAC permission matrix's single save call (`PermissionMatrix.tsx`) — replaces the entire
 *  basic-shaped policy set for `entity` with exactly `grants` in one atomic backend transaction
 *  (`syncPolicyMatrix`, `PolicyStore::sync_basic_policies`), instead of firing one
 *  create/delete per checkbox click. `role: null` means the matrix's pinned "Everyone" row (an
 *  open, `roles IS NULL` policy). Never touches an Advanced-tab policy — see that trait method's
 *  doc comment (`crates/metap-permission/src/policy_store.rs`) for the exact boundary. */
export function useSyncMatrixPolicies() {
  return useMutation<
    AdminPolicy[],
    GraphQLError,
    { entity: string; grants: { role: string | null; action: string }[] }
  >({
    mutationFn: (body) =>
      graphqlFetch<{ syncPolicyMatrix: AdminPolicy[] }>(
        GRAPHQL_PATH,
        `mutation($entity: String!, $grants: [MatrixGrantInput!]!) { syncPolicyMatrix(entity: $entity, grants: $grants) { ${POLICY_SELECTION} } }`,
        body,
      ).then((r) => r.syncPolicyMatrix),
  });
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
// Moved onto GraphQL 2026-09-26 (`cronJobs`/`createCronJob`/`updateCronJob`/`deleteCronJob`/
// `cronJobRuns`) — `/admin/cron-jobs*`'s replacement.

export function useAdminCronJobs() {
  return useGraphQLQuery<{ cronJobs: CronJob[] }, CronJob[]>(
    ["admin", "cronJobs"],
    GRAPHQL_PATH,
    `{ cronJobs { ${CRON_JOB_SELECTION} } }`,
    undefined,
    (response) => response.cronJobs,
  );
}

export function useCronJobRuns(jobId: string | null) {
  return useGraphQLQuery<{ cronJobRuns: CronJobRun[] }, CronJobRun[]>(
    ["admin", "cronJobs", jobId, "runs"],
    GRAPHQL_PATH,
    "query($id: ID!) { cronJobRuns(id: $id) { id tenantId jobId status scheduledFor startedAt finishedAt error responseSummary createdAt } }",
    { id: jobId },
    (response) => response.cronJobRuns,
    jobId !== null,
  );
}

export function useCreateAdminCronJob() {
  return useMutation<
    CronJob,
    GraphQLError,
    {
      name: string;
      cronExpr: string;
      timezone: string;
      targetType: string;
      targetConfig: unknown;
      dispatchMode: string;
      enabled: boolean;
    }
  >({
    mutationFn: (body) =>
      graphqlFetch<{ createCronJob: CronJob }>(
        GRAPHQL_PATH,
        `mutation($input: CronJobInput!) { createCronJob(input: $input) { ${CRON_JOB_SELECTION} } }`,
        { input: body },
      ).then((r) => r.createCronJob),
  });
}

/** Row-level actions (update/delete) need a per-job id — see `useAdminRoleActions`'s doc comment
 *  for why this bypasses a bound `useMutation` hook. */
export function useAdminCronJobActions() {
  const queryClient = useQueryClient();

  async function toggleEnabled(job: CronJob) {
    await graphqlFetch(
      GRAPHQL_PATH,
      "mutation($id: ID!, $input: CronJobUpdateInput!) { updateCronJob(id: $id, input: $input) { id } }",
      { id: job.id, input: { enabled: !job.enabled } },
    );
    await queryClient.invalidateQueries({ queryKey: ["admin", "cronJobs"] });
  }

  async function deleteJob(id: string) {
    await graphqlFetch(GRAPHQL_PATH, "mutation($id: ID!) { deleteCronJob(id: $id) }", { id });
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
  const queryClient = useQueryClient();

  async function getDraft(name: string): Promise<LowCodeEntityDefinition | null> {
    try {
      const result = await apiFetch<{ data: LowCodeEntityDefinition }>(
        `/admin/lowcode/entities/${name}/draft`,
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
      { method: "PUT", body: JSON.stringify(body) },
    );
    await queryClient.invalidateQueries({ queryKey: ["admin", "lowcode", "entities"] });
    return result.data;
  }

  async function publish(name: string) {
    const result = await apiFetch<{ data: { versionNumber: number } }>(
      `/admin/lowcode/entities/${name}/publish`,
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
      { method: "POST" },
    );
    return result.data;
  }

  async function rollback(name: string, toVersionNumber: number) {
    const result = await apiFetch<{ data: { versionNumber: number } }>(
      `/admin/lowcode/entities/${name}/rollback`,
      { method: "POST", body: JSON.stringify({ toVersionNumber }) },
    );
    await queryClient.invalidateQueries({ queryKey: ["admin", "lowcode"] });
    // See `publish`'s comment — rollback swaps the live registry too.
    await queryClient.invalidateQueries({ queryKey: ["entities"] });
    await queryClient.invalidateQueries({ queryKey: ["entity", name] });
    return result.data;
  }

  async function setEnabled(name: string, enabled: boolean) {
    await apiFetch(`/admin/lowcode/entities/${name}`, {
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
