import { useState } from "react";
import {
  Alert,
  Button,
  buttonVariants,
  Card,
  IconButton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useApiQuery } from "../api/useApiQuery";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { ApiError, apiFetch } from "../api/client";
import { useEntity } from "../metadata/useEntity";
import { getFieldLayoutHint } from "../metadata/entityLayout";
import { FieldValue } from "../field/FieldValue";
import { useEntityLabels } from "../i18n/useEntityLabels";
import { useTenantUsers } from "../auth/useTenantUsers";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { WorkflowActionBar } from "../workflow/WorkflowActionBar";
import { WorkflowStepper } from "../workflow/WorkflowStepper";
import { RelatedRecordsPanel } from "./RelatedRecordsPanel";
import { useWorkflowEvents } from "./useWorkflowEvents";
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

/** "History" tab content — `docs/features/20-record-detail-audit-trail-and-tabs.md`. Only
 *  mounted (and only fetches) when the parent already confirmed `entity.workflow` exists, so a
 *  non-workflow entity's `RecordDetail` never renders this tab at all, let alone requests
 *  `/workflow-events` for it. */
function WorkflowHistoryTab({ entityName, recordId }: { entityName: string; recordId: string }) {
  const { t } = useTranslation();
  const { data: events, isLoading, error } = useWorkflowEvents(entityName, recordId, true);
  const users = useTenantUsers();

  if (isLoading) {
    return <Spinner size="sm" />;
  }
  if (error) {
    return <ApiErrorMessage error={error} />;
  }
  if (!events || events.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("detail.historyEmpty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {events.map((event) => {
        const actorEmail = event.actor
          ? (users.find((u) => u.id === event.actor)?.email ?? event.actor)
          : null;
        return (
          <li
            key={event.id}
            className="flex flex-col gap-0.5 border-b border-border pb-3 last:border-0"
          >
            <span className="text-sm text-foreground">
              {t("detail.historyEntry", {
                action: event.action,
                from: event.from_state,
                to: event.to_state,
              })}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(event.created_at).toLocaleString()}
              {actorEmail ? ` · ${t("detail.historyBy", { actor: actorEmail })}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function RecordDetail({ entityName, id }: { entityName: string; id: string }) {
  const { t } = useTranslation();
  const { entityLabel, fieldLabel } = useEntityLabels(entityName);
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
      await apiFetch(`/api/${entityName}/${id}`, {
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

  // Shared between the plain layout (no workflow) and the "Details" tab (workflow entity) below
  // — kept as one JSX expression rather than duplicated so the 2 layouts can't drift apart.
  const fieldsAndRelated = (
    <>
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
    </>
  );

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
        </div>
        {/* Both actions are gated on the capabilities the server already sent with this very
            record, rather than offered unconditionally and left to fail with a 403 — see
            `docs/audits/02-auth-permission-workflow-diagram-audit.md` finding B1. Disabled with a
            reason, not hidden, matching how `TransitionButtons` presents a blocked transition. */}
        <div className="flex items-center gap-2">
          {record.capabilities.canUpdate ? (
            <navAdapter.Link
              to={navAdapter.toEditRecord(entityName, id)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t("common.edit")}
            </navAdapter.Link>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button variant="outline" size="sm" disabled>
                    {t("common.edit")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("common.noPermissionEdit")}</TooltipContent>
            </Tooltip>
          )}
          {/* `canDelete === false` only — `undefined` means an older backend that doesn't report
              it, where gating would hide the action from people entitled to it. */}
          {record.capabilities.canDelete === false ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled
                  >
                    {t("common.delete")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("common.noPermissionDelete")}</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              loading={deleting}
              onClick={() => void handleDelete()}
            >
              {t("common.delete")}
            </Button>
          )}
        </div>
      </div>

      {/* Always visible, right under the header — not something a caller can toggle away like
          the old badge-grid in `WorkflowActionBar` used to be. See `WorkflowStepper`'s own doc
          comment for why this moved out of that component. */}
      {entity.workflow && currentState ? (
        <WorkflowStepper workflow={entity.workflow} currentState={currentState} />
      ) : null}

      {/* The "Visualize workflow" trigger + transition buttons — moved up here from below the
          record fields/related-records panel (2026-09-03, project owner request) so the actions
          that change this record's own state aren't buried under a scroll of unrelated content. */}
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

      {entity.workflow ? (
        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">{t("detail.tabDetails")}</TabsTrigger>
            <TabsTrigger value="history">{t("detail.tabHistory")}</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="flex flex-col gap-4">
            {fieldsAndRelated}
          </TabsContent>
          <TabsContent value="history">
            <Card className="p-md">
              <WorkflowHistoryTab entityName={entityName} recordId={id} />
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
        fieldsAndRelated
      )}
    </div>
  );
}
