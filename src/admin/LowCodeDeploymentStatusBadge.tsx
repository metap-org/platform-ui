import { Badge, Spinner } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useLowCodeDeploymentStatus } from "./lowCodeControlPlane";
import type { LowCodeDeploymentStatus } from "./lowCodeControlPlane";

const STATUS_BADGE_VARIANT: Record<LowCodeDeploymentStatus["status"], "secondary" | "warning" | "success" | "destructive"> = {
  not_queued: "secondary",
  pending: "warning",
  running: "warning",
  done: "success",
  failed: "destructive",
  blocked: "destructive",
};

/**
 * Small inline indicator of a low-code entity's reconciler deployment status, via the new
 * `control-plane-graphql` gateway's `lowCodeDeploymentStatus(name)` (see `lowCodeControlPlane.ts`).
 * `ready` (not `status`) is the authoritative "safe to use" signal per
 * `crates/presenter/src/routes/entities.rs`'s `deployment_status` handler doc comment — this
 * component always renders `status` as the badge label (for operator visibility into what the
 * reconciler is actually doing) but only shows the "not ready" warning line when `ready` is
 * false, never inferred from `status` itself.
 *
 * Renders nothing while loading/erroring silently into a neutral badge rather than blocking the
 * row it sits in — a transient error here shouldn't make the rest of the entity list unusable.
 */
export function LowCodeDeploymentStatusBadge({
  name,
  gatewayUrl,
  authTokenUrl,
}: {
  name: string;
  gatewayUrl: string;
  authTokenUrl: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useLowCodeDeploymentStatus(name, gatewayUrl, authTokenUrl);

  if (isLoading) {
    return <Spinner size="sm" />;
  }
  if (error || !data) {
    return <Badge variant="secondary">{t("admin.lowcode.deployment.unknown")}</Badge>;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={STATUS_BADGE_VARIANT[data.status] ?? "secondary"}>
        {t(`admin.lowcode.deployment.status.${data.status}`, data.status)}
      </Badge>
      {!data.ready ? (
        <span className="text-xs text-destructive">
          {data.lastError
            ? t("admin.lowcode.deployment.notReadyWithError", { error: data.lastError })
            : t("admin.lowcode.deployment.notReady")}
        </span>
      ) : null}
    </div>
  );
}
