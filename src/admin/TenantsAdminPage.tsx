import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  IconButton,
  Input,
  NumberInput,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { PlatformAdminOnly } from "../auth/PlatformAdminOnly";
import {
  useTenantActions,
  useTenants,
  type ProvisionTenantInput,
  type WaveRolloutResult,
} from "./tenantAdmin";

const STRATEGIES: ProvisionTenantInput["strategy"][] = ["schema", "dedicated_db"];

/** Every action hook in `./tenantAdmin.ts` is a plain async function (not a `useMutation` object
 *  — see that module's own doc comment), so this page tracks its own loading/error state per
 *  form/row, same convention `UsersAdminPage`/`CronJobsAdminPage`'s row-level actions already
 *  use. `GraphQLError` (thrown by `controlPlaneGraphqlFetch` on a GraphQL error response, e.g. the
 *  409 duplicate-tenant-id case) is a real `Error` subclass, so this needs no special-casing
 *  beyond what `err instanceof Error` already covers. */
function actionErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * `TenantsAdminPage`'s props — the new pattern this one page introduces (`gatewayUrl`/
 * `authTokenUrl`, both threaded straight into every `./tenantAdmin.ts` hook): unlike every other
 * admin page here, this one talks to the `control-plane-graphql` gateway, a separate origin from
 * the same-origin REST this repo's other admin pages use, so it has no baked-in URL to fall back
 * on (see `useControlPlaneQuery`'s doc comment).
 */
export type TenantsAdminPageProps = {
  gatewayUrl: string;
  authTokenUrl: string;
};

function ProvisionTenantForm({ gatewayUrl, authTokenUrl }: TenantsAdminPageProps) {
  const { t } = useTranslation();
  const { provisionTenant } = useTenantActions(gatewayUrl, authTokenUrl);

  const [tenantId, setTenantId] = useState("");
  const [strategy, setStrategy] = useState<ProvisionTenantInput["strategy"]>("schema");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [dsnSecretRef, setDsnSecretRef] = useState("");
  const [dedicatedDatabaseUrl, setDedicatedDatabaseUrl] = useState("");
  const [product, setProduct] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTenantId, setSuccessTenantId] = useState<string | null>(null);

  const isDedicatedDb = strategy === "dedicated_db";
  const missingRequired =
    tenantId.trim().length === 0 ||
    adminEmail.trim().length === 0 ||
    adminPassword.length === 0 ||
    (isDedicatedDb &&
      (dsnSecretRef.trim().length === 0 || dedicatedDatabaseUrl.trim().length === 0));

  async function handleSubmit() {
    setError(null);
    setSuccessTenantId(null);
    setSubmitting(true);
    try {
      const result = await provisionTenant({
        tenantId,
        strategy,
        adminEmail,
        adminPassword,
        ...(isDedicatedDb ? { dsnSecretRef, dedicatedDatabaseUrl } : {}),
        ...(product.trim().length > 0 ? { product: product.trim() } : {}),
      });
      setSuccessTenantId(result.tenantId);
      setTenantId("");
      setAdminEmail("");
      setAdminPassword("");
      setDsnSecretRef("");
      setDedicatedDatabaseUrl("");
      setProduct("");
    } catch (err) {
      setError(actionErrorMessage(err, t("common.somethingWentWrong")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-8 flex max-w-[480px] flex-col gap-4">
      <h4 className="text-base font-medium text-foreground">
        {t("admin.tenants.provisionTitle")}
      </h4>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {successTenantId ? (
        <Alert variant="default">
          {t("admin.tenants.provisionSuccess", { tenantId: successTenantId })}
        </Alert>
      ) : null}
      <Input
        label={t("admin.tenants.tenantId")}
        value={tenantId}
        onChange={(event) => setTenantId(event.currentTarget.value)}
      />
      <Select
        label={t("admin.tenants.strategyType")}
        options={STRATEGIES.map((s) => ({
          value: s,
          label:
            s === "schema"
              ? t("admin.tenants.strategySchema")
              : t("admin.tenants.strategyDedicatedDb"),
        }))}
        value={strategy}
        onValueChange={(value) => setStrategy(value as ProvisionTenantInput["strategy"])}
      />
      <Input
        label={t("admin.tenants.adminEmail")}
        type="email"
        value={adminEmail}
        onChange={(event) => setAdminEmail(event.currentTarget.value)}
      />
      <Input
        label={t("admin.tenants.adminPassword")}
        type="password"
        value={adminPassword}
        onChange={(event) => setAdminPassword(event.currentTarget.value)}
      />
      {isDedicatedDb ? (
        <>
          <Input
            label={t("admin.tenants.dsnSecretRef")}
            helperText={t("admin.tenants.dedicatedDbHint")}
            value={dsnSecretRef}
            onChange={(event) => setDsnSecretRef(event.currentTarget.value)}
          />
          <Input
            label={t("admin.tenants.dedicatedDatabaseUrl")}
            value={dedicatedDatabaseUrl}
            onChange={(event) => setDedicatedDatabaseUrl(event.currentTarget.value)}
          />
        </>
      ) : null}
      <Input
        label={t("admin.tenants.productOptional")}
        value={product}
        onChange={(event) => setProduct(event.currentTarget.value)}
      />
      <Button onClick={() => void handleSubmit()} disabled={missingRequired} loading={submitting}>
        {t("admin.tenants.provisionSubmit")}
      </Button>
    </div>
  );
}

function WaveRolloutForm({ gatewayUrl, authTokenUrl }: TenantsAdminPageProps) {
  const { t } = useTranslation();
  const { triggerWaveRollout } = useTenantActions(gatewayUrl, authTokenUrl);

  const [entityName, setEntityName] = useState("");
  const [packVersion, setPackVersion] = useState<number>(1);
  const [tenantIdsText, setTenantIdsText] = useState("");
  const [wave, setWave] = useState<number>(0);
  const [maxErrorRatePercent, setMaxErrorRatePercent] = useState<number>(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WaveRolloutResult | null>(null);

  const tenantIds = tenantIdsText
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  async function handleSubmit() {
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const decision = await triggerWaveRollout({
        entityName,
        packVersion,
        tenantIds,
        wave,
        maxErrorRatePercent,
      });
      setResult(decision);
    } catch (err) {
      setError(actionErrorMessage(err, t("common.somethingWentWrong")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-8 flex max-w-[480px] flex-col gap-4">
      <h4 className="text-base font-medium text-foreground">
        {t("admin.tenants.waveRolloutTitle")}
      </h4>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {result ? (
        <Alert variant={result.decision === "advanced" ? "default" : "destructive"}>
          {result.decision === "advanced"
            ? t("admin.tenants.rolloutAdvanced", { count: result.tenantsInWave })
            : t("admin.tenants.rolloutHalted", { rate: result.errorRatePercent })}
        </Alert>
      ) : null}
      <Input
        label={t("admin.tenants.entityName")}
        value={entityName}
        onChange={(event) => setEntityName(event.currentTarget.value)}
      />
      <NumberInput
        label={t("admin.tenants.packVersion")}
        value={packVersion}
        onChange={setPackVersion}
        min={1}
      />
      <Input
        label={t("admin.tenants.tenantIds")}
        helperText={t("admin.tenants.tenantIdsHint")}
        value={tenantIdsText}
        onChange={(event) => setTenantIdsText(event.currentTarget.value)}
      />
      <NumberInput
        label={t("admin.tenants.wave")}
        helperText={t("admin.tenants.waveHint")}
        value={wave}
        onChange={setWave}
        min={0}
      />
      <NumberInput
        label={t("admin.tenants.maxErrorRatePercent")}
        value={maxErrorRatePercent}
        onChange={setMaxErrorRatePercent}
        min={0}
        max={100}
      />
      <Button
        onClick={() => void handleSubmit()}
        disabled={entityName.trim().length === 0 || tenantIds.length === 0}
        loading={submitting}
      >
        {t("admin.tenants.triggerRollout")}
      </Button>
    </div>
  );
}

function TenantsTable({ gatewayUrl, authTokenUrl }: TenantsAdminPageProps) {
  const { t } = useTranslation();
  const { data: tenants, isLoading, error } = useTenants(gatewayUrl, authTokenUrl);
  const { setTenantStatus, setTenantProduct, deleteTenant } = useTenantActions(
    gatewayUrl,
    authTokenUrl,
  );

  const [productInputs, setProductInputs] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);

  async function handleToggleStatus(id: string, currentStatus: string) {
    setRowError(null);
    setPendingRowId(id);
    try {
      await setTenantStatus(id, currentStatus === "active" ? "suspended" : "active");
    } catch (err) {
      setRowError(actionErrorMessage(err, t("common.somethingWentWrong")));
    } finally {
      setPendingRowId(null);
    }
  }

  async function handleSaveProduct(id: string, currentProduct: string | null) {
    const nextProduct = (productInputs[id] ?? currentProduct ?? "").trim();
    if (nextProduct.length === 0) {
      return;
    }
    setRowError(null);
    setPendingRowId(id);
    try {
      await setTenantProduct(id, nextProduct);
    } catch (err) {
      setRowError(actionErrorMessage(err, t("common.somethingWentWrong")));
    } finally {
      setPendingRowId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("admin.tenants.deleteConfirm"))) {
      return;
    }
    setRowError(null);
    setPendingRowId(id);
    try {
      const deleted = await deleteTenant(id);
      if (!deleted) {
        setRowError(t("admin.tenants.deleteNotFound"));
      }
    } catch (err) {
      setRowError(actionErrorMessage(err, t("common.somethingWentWrong")));
    } finally {
      setPendingRowId(null);
    }
  }

  if (isLoading) {
    return <Spinner />;
  }
  if (error) {
    return <ApiErrorMessage error={error} />;
  }

  return (
    <>
      {rowError ? (
        <Alert variant="destructive" className="mb-4 flex items-center justify-between gap-2">
          <span>{rowError}</span>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="Dismiss"
            onClick={() => setRowError(null)}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            }
          />
        </Alert>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("admin.tenants.id")}</TableHead>
            <TableHead>{t("admin.tenants.tier")}</TableHead>
            <TableHead>{t("admin.tenants.status")}</TableHead>
            <TableHead>{t("admin.tenants.strategy")}</TableHead>
            <TableHead>{t("admin.tenants.product")}</TableHead>
            <TableHead>{t("admin.tenants.createdAt")}</TableHead>
            <TableHead>{t("admin.tenants.trialExpiresAt")}</TableHead>
            <TableHead>{t("common.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(tenants ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={8}>{t("common.noRecords")}</TableCell>
            </TableRow>
          ) : (
            (tenants ?? []).map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="font-mono text-xs">{tenant.id}</TableCell>
                <TableCell>{tenant.tier}</TableCell>
                <TableCell>
                  <Badge variant={tenant.status === "active" ? "success" : "warning"}>
                    {tenant.status}
                  </Badge>
                </TableCell>
                <TableCell>{tenant.strategy.type}</TableCell>
                <TableCell>{tenant.product ?? "—"}</TableCell>
                <TableCell>{tenant.createdAt}</TableCell>
                <TableCell>{tenant.trialExpiresAt ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        loading={pendingRowId === tenant.id}
                        onClick={() => void handleToggleStatus(tenant.id, tenant.status)}
                      >
                        {tenant.status === "active"
                          ? t("admin.tenants.suspend")
                          : t("admin.tenants.resume")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        loading={pendingRowId === tenant.id}
                        onClick={() => void handleDelete(tenant.id)}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Input
                        placeholder={t("admin.tenants.product")}
                        value={productInputs[tenant.id] ?? tenant.product ?? ""}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setProductInputs((prev) => ({ ...prev, [tenant.id]: value }));
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        loading={pendingRowId === tenant.id}
                        onClick={() => void handleSaveProduct(tenant.id, tenant.product)}
                      >
                        {t("admin.tenants.saveProduct")}
                      </Button>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}

/**
 * Platform-level tenant admin: provisioning, status (suspend/resume), product assignment,
 * deletion, and wave-rollout, all through the `control-plane-graphql` gateway
 * (`./tenantAdmin.ts`) rather than REST — the existing `usePlatformTenants` REST list in
 * `./impersonation.ts` stays untouched and keeps backing `AppShellLayout.tsx`'s tenant-switcher
 * dropdown; this is a separate, additive admin surface. `gatewayUrl`/`authTokenUrl` are required
 * props (see `TenantsAdminPageProps`'s doc comment) since this repo has no backend topology of
 * its own to default them to.
 */
function TenantsAdminPageBody({ gatewayUrl, authTokenUrl }: TenantsAdminPageProps) {
  const { t } = useTranslation();

  return (
    <div className="py-8">
      <h2 className="mb-4 text-xl font-semibold text-foreground">{t("admin.tenants.title")}</h2>

      <ProvisionTenantForm gatewayUrl={gatewayUrl} authTokenUrl={authTokenUrl} />
      <WaveRolloutForm gatewayUrl={gatewayUrl} authTokenUrl={authTokenUrl} />
      <TenantsTable gatewayUrl={gatewayUrl} authTokenUrl={authTokenUrl} />
    </div>
  );
}

/** Self-gated on the `platform_admin` role (not `admin` — tenant provisioning is cross-tenant,
 *  platform-level, `PlatformAdminContext`-enforced server-side) rather than trusting every
 *  consumer to gate the route: `TenantsAdminPageBody` fires gateway requests from its very first
 *  render, so an ungated tenant-scoped `admin` would otherwise watch the page assemble itself and
 *  then fill with GraphQL error alerts. `PlatformAdminOnly` keeps that body unmounted entirely
 *  until roles resolve and pass — same reasoning as every other admin page's `AdminOnly` wrap in
 *  this package. */
export function TenantsAdminPage({ gatewayUrl, authTokenUrl }: TenantsAdminPageProps) {
  return (
    <PlatformAdminOnly>
      <TenantsAdminPageBody gatewayUrl={gatewayUrl} authTokenUrl={authTokenUrl} />
    </PlatformAdminOnly>
  );
}
