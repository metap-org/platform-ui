import { useState } from "react";
import { Button } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useLowCodeControlPlaneActions, useLowCodePublished } from "./lowCodeControlPlane";

/**
 * "Migrate to dedicated table" trigger, backed by the new `control-plane-graphql` gateway's
 * `migrateLowCodeToDedicatedTable(name)` mutation (see `lowCodeControlPlane.ts`) — only meaningful
 * for a legacy entity still on the generic `records` table (per this prompt's own scoping), so
 * this component self-determines applicability via `lowCodePublished(name)` and renders nothing
 * at all (not a disabled button) when:
 *  - the entity has never been published (no `tableName` to inspect yet), or
 *  - it's already on its own dedicated table (`tableName !== "records"`).
 *
 * Confirmation is required (same `window.confirm` pattern `LowCodeEntitiesAdminPage.tsx`'s own
 * rollback action uses) since this kicks off an actual reconciler-driven schema migration.
 */
export function LowCodeMigrateToDedicatedTableButton({
  name,
  gatewayUrl,
  authTokenUrl,
}: {
  name: string;
  gatewayUrl: string;
  authTokenUrl: string;
}) {
  const { t } = useTranslation();
  const { data: published } = useLowCodePublished(name, gatewayUrl, authTokenUrl);
  const { migrateToDedicatedTable } = useLowCodeControlPlaneActions(gatewayUrl, authTokenUrl);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!published || published.definition.tableName !== "records") {
    return null;
  }

  async function handleClick() {
    if (!window.confirm(t("admin.lowcode.migrateToDedicatedTable.confirm", { entity: name }))) {
      return;
    }
    setError(null);
    setMigrating(true);
    try {
      await migrateToDedicatedTable(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.somethingWentWrong"));
    } finally {
      setMigrating(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="ghost" size="sm" onClick={() => void handleClick()} loading={migrating}>
        {t("admin.lowcode.migrateToDedicatedTable.action")}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
