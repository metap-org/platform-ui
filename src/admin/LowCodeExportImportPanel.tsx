import { useRef, useState } from "react";
import { Alert, Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useLowCodeControlPlaneActions } from "./lowCodeControlPlane";
import type {
  LowCodeExportedEntity,
  LowCodeExportResult,
  LowCodeImportResult,
} from "./lowCodeControlPlane";

/**
 * Export/import panel for low-code entity definitions, backed by the new `control-plane-graphql`
 * gateway's `lowCodeExport`/`importLowCodeEntities` (see `lowCodeControlPlane.ts` — no REST-based
 * equivalent UI existed before this). Export downloads every published entity (or a specific set,
 * not exposed here as a picker — `exportEntities()` with no args covers the common "back up
 * everything" case; a consuming app can call `useLowCodeControlPlaneActions` directly for a
 * scoped export UI) as a `.json` file the browser saves. Import accepts that same shape pasted
 * back into a textarea (a `<input type="file">` reads its content into the textarea rather than
 * uploading directly, so the operator can review/edit before submitting).
 */
export function LowCodeExportImportPanel({
  gatewayUrl,
  authTokenUrl,
}: {
  gatewayUrl: string;
  authTokenUrl: string;
}) {
  const { t } = useTranslation();
  const { exportEntities, importEntities } = useLowCodeControlPlaneActions(gatewayUrl, authTokenUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<LowCodeImportResult | null>(null);

  async function handleExportAll() {
    setExportError(null);
    setExporting(true);
    try {
      const result: LowCodeExportResult = await exportEntities();
      const blob = new Blob([JSON.stringify({ entities: result.entities }, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lowcode-entities-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : t("common.somethingWentWrong"));
    } finally {
      setExporting(false);
    }
  }

  function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  async function handleImport() {
    setImportError(null);
    setImportResult(null);
    let body: unknown;
    try {
      body = JSON.parse(importText);
    } catch {
      setImportError(t("common.invalidJson"));
      return;
    }
    const entities = (body as { entities?: unknown }).entities;
    if (!Array.isArray(entities)) {
      setImportError(t("admin.lowcode.exportImport.importShapeError"));
      return;
    }
    setImporting(true);
    try {
      const result = await importEntities(entities as LowCodeExportedEntity[]);
      setImportResult(result);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t("common.somethingWentWrong"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h5 className="text-sm font-medium text-foreground">{t("admin.lowcode.exportImport.exportTitle")}</h5>
        {exportError ? <Alert variant="destructive">{exportError}</Alert> : null}
        <Button variant="outline" onClick={() => void handleExportAll()} loading={exporting} className="self-start">
          {t("admin.lowcode.exportImport.exportAll")}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <h5 className="text-sm font-medium text-foreground">{t("admin.lowcode.exportImport.importTitle")}</h5>
        {importError ? <Alert variant="destructive">{importError}</Alert> : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          onChange={handleFileChosen}
          className="text-sm text-foreground"
        />
        <Textarea
          value={importText}
          onChange={(e) => setImportText(e.currentTarget.value)}
          placeholder={t("admin.lowcode.exportImport.importPlaceholder")}
          rows={8}
        />
        <Button
          onClick={() => void handleImport()}
          loading={importing}
          disabled={importText.trim().length === 0}
          className="self-start"
        >
          {t("admin.lowcode.exportImport.importSubmit")}
        </Button>
        {importResult ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.lowcode.exportImport.resultEntity")}</TableHead>
                <TableHead>{t("admin.lowcode.exportImport.resultOutcome")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importResult.imported.map((name) => (
                <TableRow key={name}>
                  <TableCell>{name}</TableCell>
                  <TableCell>
                    <Badge variant="success">{t("admin.lowcode.exportImport.resultImported")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {importResult.failed.map((failure) => (
                <TableRow key={failure.name}>
                  <TableCell>{failure.name}</TableCell>
                  <TableCell>
                    <Badge variant="destructive">{failure.error}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {importResult.imported.length === 0 && importResult.failed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2}>{t("common.noRecords")}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </div>
  );
}
