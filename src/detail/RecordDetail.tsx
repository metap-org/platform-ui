import { useState } from "react";
import { Alert, Badge, Button, buttonVariants, Card, IconButton, Spinner } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useApiQuery } from "../api/useApiQuery";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { ApiError, apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useEntity } from "../metadata/useEntity";
import { getFieldLayoutHint } from "../metadata/entityLayout";
import { FieldValue } from "../field/FieldValue";
import { useEntityLabels } from "../i18n/useEntityLabels";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { WorkflowActionBar } from "../workflow/WorkflowActionBar";
import { RelatedRecordsPanel } from "./RelatedRecordsPanel";
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

  const currentState = entity.workflow ? stateValue(record.data[entity.workflow.stateField]) : null;
  const visibleFields = entity.fields.filter((field) => field.kind !== "id");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 py-4">
      <navAdapter.Link
        to={navAdapter.toRecordList(entityName)}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3"
        >
          <path d="M7.5 3L4.5 6l3 3" />
        </svg>
        {t("common.backToList", { label: entityLabel(entity.label) })}
      </navAdapter.Link>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {entityLabel(entity.label)}
          </h2>
          {currentState ? <Badge variant="secondary">{currentState}</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          <navAdapter.Link
            to={navAdapter.toEditRecord(entityName, id)}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("common.edit")}
          </navAdapter.Link>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            loading={deleting}
            onClick={() => void handleDelete()}
          >
            {t("common.delete")}
          </Button>
        </div>
      </div>

      {deleteError ? (
        <Alert variant="destructive" className="flex items-center justify-between gap-2">
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

      <Card>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 p-md sm:grid-cols-2">
          {visibleFields.map((field) => {
            const hint = getFieldLayoutHint(entityName, field.name, field.kind);
            return (
              <div key={field.name} className={hint.span === 2 ? "sm:col-span-2" : undefined}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {fieldLabel(field.name, field.label)}
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  <FieldValue
                    field={field}
                    value={record.data[field.name]}
                    entityName={entityName}
                    fieldDisplayHints={entity.fieldDisplayHints}
                  />
                </dd>
              </div>
            );
          })}
        </dl>
      </Card>

      {entity.relatedViews && entity.relatedViews.length > 0 ? (
        <RelatedRecordsPanel id={id} relatedViews={entity.relatedViews} />
      ) : null}

      {entity.workflow ? (
        <WorkflowActionBar
          entityName={entityName}
          recordId={id}
          version={record.version}
          workflow={entity.workflow}
          currentState={currentState ?? ""}
          capabilities={record.capabilities}
          onTransitioned={() => {
            void refetch();
          }}
        />
      ) : null}
    </div>
  );
}
