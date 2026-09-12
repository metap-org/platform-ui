import { useControlPlaneMutate, useControlPlaneQuery } from "../api/useControlPlaneQuery";

/**
 * GraphQL-based platform-admin tenant hooks, against the new `control-plane-graphql` BFF gateway
 * (`../../../metap-lowcode/services/control-plane-graphql`) — **not** REST. Deliberately separate
 * from `./impersonation.ts`'s `usePlatformTenants`/`useImpersonationActions`/
 * `useImpersonationStatus`, which stay on plain REST against `control-api` directly and back the
 * existing tenant-switcher dropdown in `AppShellLayout.tsx` unchanged. This module is the new
 * provisioning/status/product/delete/wave-rollout admin surface `TenantsAdminPage` uses, going
 * through the gateway per the explicit ask to route platform-admin actions through GraphQL from
 * here on. `gatewayUrl`/`authTokenUrl` are threaded through from whichever page renders these
 * hooks — see `useControlPlaneQuery`'s own doc comment for why this repo doesn't bake in a
 * backend topology of its own.
 *
 * Every field on the gateway (`services/control-plane-graphql/src/schema.rs`) is a thin proxy
 * returning the REST response's already-unwrapped `data` payload as the `JSON` scalar, so none of
 * the queries/mutations below need a sub-selection set — a JSON scalar has no subfields.
 *
 * Query key namespace is `["controlPlane", ...]`, deliberately distinct from `impersonation.ts`'s
 * `["platform", "tenants"]` — same conceptual data (a tenant list), but fetched from a different
 * upstream (the GraphQL gateway vs. REST directly), so they must not share a cache entry.
 */

export type TenantStrategy = {
  type: "schema" | "dedicated_db";
  schemaName?: string;
  dsnSecretRef?: string;
};

/** Shape returned by the `tenants` query — `tenant_summary_json` in
 *  `metap-lowcode/crates/presenter/src/routes/tenants.rs`. */
export type Tenant = {
  id: string;
  tier: string;
  status: string;
  strategy: TenantStrategy;
  createdAt: string;
  trialExpiresAt: string | null;
  product: string | null;
};

/** Narrower shape returned by the single-tenant `tenant(id)` query (`TenantRoutingDto`) — no
 *  `tier`/`createdAt`/`product`, per that handler's own doc comment. Not used by
 *  `TenantsAdminPage` today (the list view covers it), exported for a future detail view. */
export type TenantRouting = {
  id: string;
  status: string;
  strategy: TenantStrategy;
};

const TENANTS_QUERY = `query ControlPlaneTenants { tenants }`;

export function useTenants(gatewayUrl: string, authTokenUrl: string) {
  return useControlPlaneQuery<{ tenants: Tenant[] }, Tenant[]>(
    ["controlPlane", "tenants"],
    gatewayUrl,
    authTokenUrl,
    TENANTS_QUERY,
    undefined,
    (data) => data.tenants,
  );
}

/** `body` matches `provisionTenant`'s REST-mirrored shape exactly (`ProvisionTenantBody` in
 *  `metap-lowcode/crates/presenter/src/routes/tenants.rs`) — `dsnSecretRef`/`dedicatedDatabaseUrl`
 *  are required only when `strategy === "dedicated_db"`, enforced server-side (400 if missing),
 *  not re-validated here beyond the form's own inline hint. */
export type ProvisionTenantInput = {
  tenantId: string;
  strategy: "schema" | "dedicated_db";
  adminEmail: string;
  adminPassword: string;
  dsnSecretRef?: string;
  dedicatedDatabaseUrl?: string;
  product?: string;
};

export type ProvisionedTenant = { tenantId: string; adminUserId: string };

/** `wave`: 0 = canary, 1 = 5%, 2 = 25%, 3+ = 100% — see `WaveRolloutBody`'s doc comment in
 *  `metap-lowcode/crates/presenter/src/routes/wave_rollout.rs`. Platform-level, not
 *  tenant-scoped: `tenantIds` names arbitrary tenants across the fleet in one call. */
export type WaveRolloutInput = {
  entityName: string;
  packVersion: number;
  tenantIds: string[];
  wave: number;
  maxErrorRatePercent: number;
};

export type WaveRolloutResult =
  | { decision: "advanced"; tenantsInWave: number }
  | { decision: "halted"; errorRatePercent: number };

const PROVISION_TENANT_MUTATION = `mutation ProvisionTenant($body: JSON!) { provisionTenant(body: $body) }`;
const DELETE_TENANT_MUTATION = `mutation DeleteTenant($id: ID!) { deleteTenant(id: $id) }`;
const SET_TENANT_STATUS_MUTATION = `mutation SetTenantStatus($id: ID!, $status: String!) { setTenantStatus(id: $id, status: $status) }`;
const SET_TENANT_PRODUCT_MUTATION = `mutation SetTenantProduct($id: ID!, $product: String!) { setTenantProduct(id: $id, product: $product) }`;
const TRIGGER_WAVE_ROLLOUT_MUTATION = `mutation TriggerWaveRollout($body: JSON!) { triggerWaveRollout(body: $body) }`;

/** Every tenant action is a one-off mutation with its own argument shape — none of them fit a
 *  fixed-path bound-mutation hook, same reasoning `useLowCodeActions`/`useAdminCronJobActions`
 *  already use in `./adminApi.ts`. Each one invalidates `["controlPlane", "tenants"]` after a
 *  successful write so the list re-fetches (`triggerWaveRollout` is the one exception — it
 *  doesn't touch `control.tenants` itself, only `reconciler_entity_deployments`, so there's
 *  nothing in the tenants list for it to invalidate). */
export function useTenantActions(gatewayUrl: string, authTokenUrl: string) {
  const { mutate, queryClient } = useControlPlaneMutate(gatewayUrl, authTokenUrl);

  async function invalidateTenants() {
    await queryClient.invalidateQueries({ queryKey: ["controlPlane", "tenants"] });
  }

  async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionedTenant> {
    const result = await mutate<{ provisionTenant: ProvisionedTenant }>(PROVISION_TENANT_MUTATION, {
      body: input,
    });
    await invalidateTenants();
    return result.provisionTenant;
  }

  /** `true` on a real deletion, `false` if `id` didn't match any tenant — the mutation's own
   *  return value, not a GraphQL error either way (see `deleteTenant`'s doc comment in
   *  `schema.rs`). Callers decide what `false` means in their own UI. */
  async function deleteTenant(id: string): Promise<boolean> {
    const result = await mutate<{ deleteTenant: boolean }>(DELETE_TENANT_MUTATION, { id });
    await invalidateTenants();
    return result.deleteTenant;
  }

  async function setTenantStatus(
    id: string,
    status: "active" | "suspended",
  ): Promise<{ id: string; status: string }> {
    const result = await mutate<{ setTenantStatus: { id: string; status: string } }>(
      SET_TENANT_STATUS_MUTATION,
      { id, status },
    );
    await invalidateTenants();
    return result.setTenantStatus;
  }

  async function setTenantProduct(
    id: string,
    product: string,
  ): Promise<{ id: string; product: string }> {
    const result = await mutate<{ setTenantProduct: { id: string; product: string } }>(
      SET_TENANT_PRODUCT_MUTATION,
      { id, product },
    );
    await invalidateTenants();
    return result.setTenantProduct;
  }

  async function triggerWaveRollout(input: WaveRolloutInput): Promise<WaveRolloutResult> {
    const result = await mutate<{ triggerWaveRollout: WaveRolloutResult }>(
      TRIGGER_WAVE_ROLLOUT_MUTATION,
      { body: input },
    );
    return result.triggerWaveRollout;
  }

  return { provisionTenant, deleteTenant, setTenantStatus, setTenantProduct, triggerWaveRollout };
}
