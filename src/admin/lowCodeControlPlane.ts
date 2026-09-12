import { useQueryClient } from "@tanstack/react-query";
import { useControlPlaneMutate, useControlPlaneQuery } from "../api/useControlPlaneQuery";

/**
 * GraphQL-based hooks for the low-code control-plane capabilities that only exist behind the new
 * `control-plane-graphql` gateway (`../../../metap-lowcode/services/control-plane-graphql`), not
 * plain REST — audit feed, deployment-status badge, export/import, and the migrate-to-dedicated-
 * table trigger. These are new capabilities layered *alongside* `adminApi.ts`'s existing
 * REST-based `useLowCodeEntities`/`useLowCodeVersions`/`useLowCodeActions` (draft/publish/
 * rollback/enable), which stay untouched and keep talking to plain REST.
 *
 * Every hook here takes `gatewayUrl`/`authTokenUrl` as explicit parameters — same "no baked-in
 * backend topology" convention `useControlPlaneQuery`/`useControlPlaneMutate` themselves follow
 * (see those files' doc comments) — this package has zero knowledge of which origin actually
 * hosts the gateway.
 *
 * Wire shapes below mirror `control-plane-graphql`'s `src/schema.rs` (every field there is a
 * thin proxy returning the REST response's already-unwrapped `data` payload as a JSON scalar) and
 * `crates/presenter/src/routes/audit.rs`/`entities.rs`'s DTOs on the `metap-lowcode` side.
 */

// --- Types ---

/** `crates/presenter/src/routes/audit.rs`'s `audit_event_to_json` shape. `action` is a free
 *  string on the wire (`domain::AuditEvent::action` is a plain `String`, not a Rust enum) — typed
 *  here as the known literal union for display purposes, but treat an unrecognized value as
 *  "render it verbatim" rather than a hard failure, since the backend could add a new action kind
 *  without this type being updated first. */
export type LowCodeAuditAction =
  | "draft_saved"
  | "published"
  | "rolled_back"
  | "enabled"
  | "disabled"
  | "table_migrated";

export type LowCodeAuditEvent = {
  entityName: string;
  action: LowCodeAuditAction | (string & {});
  actorUserId: string | null;
  actorTenantId: string;
  versionNumber: number | null;
  restoredFromVersion: number | null;
  occurredAt: string;
};

/** `crates/presenter/src/routes/entities.rs`'s `deployment_status` handler / `DeploymentStatusDto`.
 *  `ready` is the authoritative "safe to use" signal per that handler's own doc comment — don't
 *  infer readiness from `status` in a consumer, use `ready` directly. */
export type LowCodeDeploymentStatus = {
  name: string;
  status: "not_queued" | "pending" | "running" | "done" | "failed" | "blocked";
  ready: boolean;
  desiredVersion: number | null;
  appliedVersion: number | null;
  failureClass: string | null;
  lastError: string | null;
};

/** The *full* wire shape of a published/exported/imported entity definition
 *  (`domain::LowCodeEntityDefinition` on the `metap-lowcode` side, `crates/domain/src/
 *  definition.rs`) — deliberately a separate, wider type from `adminApi.ts`'s own
 *  `LowCodeEntityDefinition` (which mirrors only the fields the existing draft editor UI edits:
 *  `name/label/fields/listViews/workflow`, no `uniqueConstraints`/`tableName`). Export, import,
 *  and `lowCodePublished` all move this fuller shape around as an opaque blob this UI mostly
 *  round-trips rather than edits field-by-field — `tableName` is the one field this module's own
 *  UI actually reads (to decide whether "Migrate to dedicated table" applies). */
export type LowCodePublishedDefinition = {
  name: string;
  label: string;
  fields: unknown[];
  listViews: unknown[];
  workflow?: unknown;
  uniqueConstraints?: unknown[];
  /** Defaults to `"records"` on the Rust side for a never-published definition — always present
   *  on an actually-published/exported definition. */
  tableName: string;
};

export type LowCodeExportedEntity = { name: string; definition: LowCodePublishedDefinition };
export type LowCodeExportResult = { entities: LowCodeExportedEntity[]; notFound: string[] };
export type LowCodeImportResult = {
  imported: string[];
  failed: { name: string; error: string }[];
};

// --- Queries ---

const AUDIT_EVENTS_QUERY = `
  query LowCodeAuditEvents($name: String!) {
    lowCodeAuditEvents(name: $name)
  }
`;

/** Per-entity audit feed — newest-first, per `list_audit_events`'s own doc comment. */
export function useLowCodeAuditEvents(
  name: string | null,
  gatewayUrl: string,
  authTokenUrl: string,
  enabled = true,
) {
  return useControlPlaneQuery<{ lowCodeAuditEvents: LowCodeAuditEvent[] }, LowCodeAuditEvent[]>(
    ["controlPlane", "lowcode", "auditEvents", gatewayUrl, name],
    gatewayUrl,
    authTokenUrl,
    AUDIT_EVENTS_QUERY,
    { name },
    (data) => data.lowCodeAuditEvents,
    enabled && name !== null,
  );
}

const RECENT_AUDIT_QUERY = `
  query LowCodeRecentAudit($limit: Int) {
    lowCodeRecentAudit(limit: $limit)
  }
`;

/** Cross-entity audit feed. `limit` mirrors the gateway/REST default (50) and server-enforced
 *  max (200) — passing a larger value here doesn't get you more rows, the server clamps it. */
export function useLowCodeRecentAudit(
  limit: number | undefined,
  gatewayUrl: string,
  authTokenUrl: string,
  enabled = true,
) {
  return useControlPlaneQuery<{ lowCodeRecentAudit: LowCodeAuditEvent[] }, LowCodeAuditEvent[]>(
    ["controlPlane", "lowcode", "recentAudit", gatewayUrl, limit ?? null],
    gatewayUrl,
    authTokenUrl,
    RECENT_AUDIT_QUERY,
    { limit },
    (data) => data.lowCodeRecentAudit,
    enabled,
  );
}

const DEPLOYMENT_STATUS_QUERY = `
  query LowCodeDeploymentStatus($name: String!) {
    lowCodeDeploymentStatus(name: $name)
  }
`;

/** Deployment-status badge data source. `staleTime` defaults to `useQuery`'s own default (not
 *  pinned to `Infinity` the way `useEntities`/`useEntity` are) since this reflects an
 *  in-progress-elsewhere reconciler job a caller may reasonably want to re-poll — a caller that
 *  wants live polling can pass its own `refetchInterval` via react-query on top of this hook's
 *  returned object, this hook itself doesn't force a polling interval. */
export function useLowCodeDeploymentStatus(
  name: string | null,
  gatewayUrl: string,
  authTokenUrl: string,
  enabled = true,
) {
  return useControlPlaneQuery<
    { lowCodeDeploymentStatus: LowCodeDeploymentStatus },
    LowCodeDeploymentStatus
  >(
    ["controlPlane", "lowcode", "deploymentStatus", gatewayUrl, name],
    gatewayUrl,
    authTokenUrl,
    DEPLOYMENT_STATUS_QUERY,
    { name },
    (data) => data.lowCodeDeploymentStatus,
    enabled && name !== null,
  );
}

const PUBLISHED_QUERY = `
  query LowCodePublished($name: String!) {
    lowCodePublished(name: $name)
  }
`;

/** `null` when this entity has never been published — not a GraphQL error, mirrors the REST
 *  endpoint's own 404-as-null semantics (see `schema.rs`'s doc comment on `low_code_published`).
 *  Used to decide whether "Migrate to dedicated table" should render at all
 *  (`published.definition.tableName === "records"`). */
export function useLowCodePublished(
  name: string | null,
  gatewayUrl: string,
  authTokenUrl: string,
  enabled = true,
) {
  return useControlPlaneQuery<
    { lowCodePublished: { definition: LowCodePublishedDefinition } | null },
    { definition: LowCodePublishedDefinition } | null
  >(
    ["controlPlane", "lowcode", "published", gatewayUrl, name],
    gatewayUrl,
    authTokenUrl,
    PUBLISHED_QUERY,
    { name },
    (data) => data.lowCodePublished,
    enabled && name !== null,
  );
}

// --- Mutations / one-off actions ---

const EXPORT_QUERY = `
  query LowCodeExport($entities: String) {
    lowCodeExport(entities: $entities)
  }
`;

const IMPORT_MUTATION = `
  mutation ImportLowCodeEntities($body: JSON!) {
    importLowCodeEntities(body: $body)
  }
`;

const MIGRATE_MUTATION = `
  mutation MigrateLowCodeToDedicatedTable($name: String!) {
    migrateLowCodeToDedicatedTable(name: $name)
  }
`;

/** Plain async functions, same shape as `adminApi.ts`'s `useLowCodeActions` — every action here
 *  needs its own argument shape and its own `invalidateQueries` list, so a single generic
 *  mutation wrapper would need as many escape hatches as it saves (see
 *  `useControlPlaneMutate`'s own doc comment for the same reasoning). */
export function useLowCodeControlPlaneActions(gatewayUrl: string, authTokenUrl: string) {
  const { mutate } = useControlPlaneMutate(gatewayUrl, authTokenUrl);
  const queryClient = useQueryClient();

  /** `names` omitted (or empty) exports every published entity, per the REST endpoint's own
   *  `?entities=` semantics (comma-separated when provided). */
  async function exportEntities(names?: string[]): Promise<LowCodeExportResult> {
    const entities = names && names.length > 0 ? names.join(",") : undefined;
    const result = await mutate<{ lowCodeExport: LowCodeExportResult }>(EXPORT_QUERY, {
      entities,
    });
    return result.lowCodeExport;
  }

  async function importEntities(
    entities: LowCodeExportedEntity[],
  ): Promise<LowCodeImportResult> {
    const result = await mutate<{ importLowCodeEntities: LowCodeImportResult }>(IMPORT_MUTATION, {
      body: { entities },
    });
    // A successful import can create/redefine entities and drafts — invalidate every list this
    // page (and the existing REST-based admin page) reads, same spirit as `useLowCodeActions`'s
    // `publish`/`rollback` invalidating `["entities"]`/`["entity", name]` after a live-registry
    // change. `["admin", "lowcode"]` covers both `adminApi.ts`'s own REST query keys and this
    // module's `["controlPlane", "lowcode", ...]` keys would need a separate invalidation since
    // they're a different key namespace — invalidate both.
    await queryClient.invalidateQueries({ queryKey: ["admin", "lowcode"] });
    await queryClient.invalidateQueries({ queryKey: ["controlPlane", "lowcode"] });
    return result.importLowCodeEntities;
  }

  async function migrateToDedicatedTable(name: string): Promise<{ versionNumber: number }> {
    const result = await mutate<{ migrateLowCodeToDedicatedTable: { versionNumber: number } }>(
      MIGRATE_MUTATION,
      { name },
    );
    await queryClient.invalidateQueries({ queryKey: ["admin", "lowcode"] });
    await queryClient.invalidateQueries({ queryKey: ["controlPlane", "lowcode"] });
    return result.migrateLowCodeToDedicatedTable;
  }

  return { exportEntities, importEntities, migrateToDedicatedTable };
}
