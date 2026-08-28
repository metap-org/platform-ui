import { useState } from "react";
import { Alert, Button, IconButton, Spinner } from "@ui/ui-lib";
import { useTranslation } from "react-i18next";
import { useApiQuery } from "../api/useApiQuery";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { ApiError, apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useEntity } from "../metadata/useEntity";
import { FieldValue } from "../field/FieldValue";
import { useEntityLabels } from "../i18n/useEntityLabels";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { WorkflowActionBar } from "../workflow/WorkflowActionBar";
import type { RecordCapabilities } from "./recordCapabilities";

type RecordDto = {
  id: string;
  version: number;
  data: Record<string, unknown>;
  capabilities: RecordCapabilities;
};

function stateValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function RecordDetail({ entityName, id }: { entityName: string; id: string }) {
  const { t } = useTranslation();
  const { entityLabel, fieldLabel } = useEntityLabels(entityName);
  const { token } = useAuth();
  const navAdapter = useNavigationAdapter();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { data: entity, isLoading: entityLoading, error: entityError } = useEntity(entityName);
  const {
    data: record,
    isLoading: recordLoading,
    error: recordError,
    refetch,
  } = useApiQuery<{ data: RecordDto }, RecordDto>(
    ["record", entityName, id],
    `/api/${entityName}/${id}`,
    (response) => response.data,
  );

  async function handleDelete() {
    if (!record || !window.confirm(t("common.deleteConfirm"))) {
      return;
    }

    setDeleteError(null);
    setDeleting(true);
    try {
      await apiFetch(`/api/${entityName}/${id}`, token, {
        method: "DELETE",
        body: JSON.stringify({ version: record.version }),
      });
      navAdapter.navigate(navAdapter.toRecordList(entityName));
    } catch (error) {
      setDeleteError(error instanceof ApiError ? error.message : t("common.somethingWentWrong"));
      setDeleting(false);
    }
  }

  if (entityLoading || recordLoading) {
    return <Spinner />;
  }
  if (entityError) {
    return <ApiErrorMessage error={entityError} />;
  }
  if (recordError) {
    return <ApiErrorMessage error={recordError} />;
  }
  if (!entity || !record) {
    return <div>{t("common.notFound")}</div>;
  }

  return (
    <div className="py-8">
      <h2 className="mb-4 text-xl font-semibold text-foreground">{entityLabel(entity.label)}</h2>
      <div className="mb-4 flex flex-col gap-4">
        {entity.fields
          .filter((field) => field.kind !== "id")
          .map((field) => (
            <div key={field.name}>
              <p className="text-sm font-medium text-foreground">
                {fieldLabel(field.name, field.label)}
              </p>
              <FieldValue field={field} value={record.data[field.name]} />
            </div>
          ))}
      </div>
      {entity.workflow ? (
        <WorkflowActionBar
          entityName={entityName}
          recordId={id}
          version={record.version}
          workflow={entity.workflow}
          currentState={stateValue(record.data[entity.workflow.stateField])}
          capabilities={record.capabilities}
          onTransitioned={() => {
            void refetch();
          }}
        />
      ) : null}
      {deleteError ? (
        <Alert variant="destructive" className="mt-4 flex items-center justify-between gap-2">
          <span>{deleteError}</span>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="Dismiss"
            onClick={() => setDeleteError(null)}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            }
          />
        </Alert>
      ) : null}
      <div className="mt-4 flex items-center gap-4">
        <navAdapter.Link
          to={navAdapter.toEditRecord(entityName, id)}
          className="text-sm underline hover:no-underline"
        >
          {t("common.edit")}
        </navAdapter.Link>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={deleting}
          onClick={() => void handleDelete()}
        >
          {deleting ? <Spinner size="sm" className="mr-2" /> : null}
          {t("common.delete")}
        </Button>
      </div>
    </div>
  );
}
