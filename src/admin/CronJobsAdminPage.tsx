import { Fragment, useState } from "react";
import {
  Alert,
  Button,
  IconButton,
  Input,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Toggle,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import {
  useAdminCronJobActions,
  useAdminCronJobs,
  useCreateAdminCronJob,
  useCronJobRuns,
} from "./adminApi";
import { AdminOnly } from "../auth/AdminOnly";

// `email`/`steps` were missing here (found live 2026-09-06,
// `docs/features/01-fe-platform-overhaul.md`) — `metap_cron::TargetType` has had 6 variants since
// Phase 39/`docs/features/02-workflow-engine.md`'s Increment 2, but this dropdown only ever
// offered 3, so a job of either kind could not be created through this page at all.
// `wait_event` is deliberately excluded — it's only valid as a step *inside* a `steps` chain
// (`metap_cron::model::TargetType::WaitEvent`'s doc comment), rejected as a job's own top-level
// target type at creation time.
const TARGET_TYPES = ["workflow_transition", "bulk_query_action", "webhook", "email", "steps"];
const DISPATCH_MODES = ["outbox", "direct"];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

type KeyValueRow = { id: string; key: string; value: string };

function emptyKeyValueRow(): KeyValueRow {
  return { id: crypto.randomUUID(), key: "", value: "" };
}

/** Empty/whitespace-only keys are dropped rather than sent as `"": "..."` — a blank trailing row
 *  left over from "Add" is the common case, not a real key a caller meant to set. */
function keyValueRowsToObject(rows: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key.length > 0) {
      result[key] = row.value;
    }
  }
  return result;
}

/** Shared by `bulk_query_action`'s `filter` and `webhook`'s `headers` — both are a flat
 *  `Record<string, string>` (`metap_cron::model::TargetType`'s doc comment: `ListInput.filters`
 *  is itself a flat `Vec<(String, String)>`, not a nested condition tree — this is *not* the same
 *  grammar `ConditionBuilder`/`PolicyCondition` use, so that component doesn't apply here). */
function KeyValueListEditor({
  rows,
  onChange,
  keyLabel,
  valueLabel,
  addLabel,
  removeLabel,
}: {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyLabel: string;
  valueLabel: string;
  addLabel: string;
  removeLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div key={row.id} className="flex items-end gap-2">
          <Input
            label={index === 0 ? keyLabel : undefined}
            value={row.key}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, key: event.currentTarget.value };
              onChange(next);
            }}
          />
          <Input
            label={index === 0 ? valueLabel : undefined}
            value={row.value}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, value: event.currentTarget.value };
              onChange(next);
            }}
          />
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={removeLabel}
            className="text-destructive hover:text-destructive"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            icon={<span className="text-base leading-none">×</span>}
          />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...rows, emptyKeyValueRow()])}>
        {addLabel}
      </Button>
    </div>
  );
}

function CronJobRuns({ jobId }: { jobId: string }) {
  const { t } = useTranslation();
  const { data: runs, isLoading, error } = useCronJobRuns(jobId);

  if (isLoading) {
    return <Spinner size="sm" />;
  }
  if (error) {
    return <ApiErrorMessage error={error} />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("admin.cronJobs.runs.status")}</TableHead>
          <TableHead>{t("admin.cronJobs.runs.scheduledFor")}</TableHead>
          <TableHead>{t("admin.cronJobs.runs.finishedAt")}</TableHead>
          <TableHead>{t("admin.cronJobs.runs.error")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(runs ?? []).length === 0 ? (
          <TableRow>
            <TableCell colSpan={4}>{t("common.noRecords")}</TableCell>
          </TableRow>
        ) : (
          (runs ?? []).map((run) => (
            <TableRow key={run.id}>
              <TableCell>{run.status}</TableCell>
              <TableCell>{run.scheduledFor}</TableCell>
              <TableCell>{run.finishedAt ?? "—"}</TableCell>
              <TableCell>{run.error ?? "—"}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function CronJobsAdminPageContent() {
  const { t } = useTranslation();
  const { data: jobs, isLoading, error, refetch } = useAdminCronJobs();
  const createJob = useCreateAdminCronJob();
  const { toggleEnabled, deleteJob } = useAdminCronJobActions();

  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [targetType, setTargetType] = useState<string>(TARGET_TYPES[0] ?? "webhook");
  const [dispatchMode, setDispatchMode] = useState<string>(DISPATCH_MODES[0] ?? "outbox");

  // One state group per `TargetType` shape (`metap_cron::model::TargetType`'s doc comment is the
  // source of truth for these) — replaces a single raw-JSON `Textarea` a caller had to hand-type
  // against undocumented shape knowledge (`docs/features/01-fe-platform-overhaul.md`'s original
  // gap). `steps` is the deliberate exception: it's a chain of the other 4 shapes, and a full
  // recursive step-list editor is a separate, bigger effort — kept as labeled raw JSON for now
  // rather than blocking the other 4 on it.
  const [wtEntity, setWtEntity] = useState("");
  const [wtRecordId, setWtRecordId] = useState("");
  const [wtAction, setWtAction] = useState("");
  const [bqaEntity, setBqaEntity] = useState("");
  const [bqaAction, setBqaAction] = useState("");
  const [bqaFilters, setBqaFilters] = useState<KeyValueRow[]>([emptyKeyValueRow()]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookMethod, setWebhookMethod] = useState<string>(HTTP_METHODS[0] ?? "POST");
  const [webhookHeaders, setWebhookHeaders] = useState<KeyValueRow[]>([]);
  // JSON, not a plain string — `metap_cron::model::TargetType`'s own doc comment says
  // `bodyTemplate?`, but the field `cron-scheduler::executor::webhook::WebhookConfig` actually
  // deserializes is `body: Option<Value>` (found live 2026-09-06 cross-checking the real struct —
  // that doc comment is stale/wrong), sent verbatim as the request body with no template
  // substitution of any kind.
  const [webhookBody, setWebhookBody] = useState("");
  const [webhookAuthFromSecret, setWebhookAuthFromSecret] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [stepsJson, setStepsJson] = useState('{\n  "steps": []\n}');

  const [targetConfigError, setTargetConfigError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  function resetTargetConfigFields() {
    setWtEntity("");
    setWtRecordId("");
    setWtAction("");
    setBqaEntity("");
    setBqaAction("");
    setBqaFilters([emptyKeyValueRow()]);
    setWebhookUrl("");
    setWebhookMethod(HTTP_METHODS[0] ?? "POST");
    setWebhookHeaders([]);
    setWebhookBody("");
    setWebhookAuthFromSecret(false);
    setEmailTo("");
    setEmailSubject("");
    setEmailBody("");
    setStepsJson('{\n  "steps": []\n}');
  }

  /** Builds the exact `target_config` shape `metap_cron::model::TargetType`'s doc comment
   *  declares for the currently-selected `targetType`, from this component's own structured
   *  fields — `null` on a JSON parse failure for `steps` (the one shape still hand-typed). */
  function buildTargetConfig(): Record<string, unknown> | null {
    switch (targetType) {
      case "workflow_transition":
        return { entity: wtEntity, recordId: wtRecordId, action: wtAction };
      case "bulk_query_action":
        return { entity: bqaEntity, action: bqaAction, filter: keyValueRowsToObject(bqaFilters) };
      case "webhook": {
        const headers = keyValueRowsToObject(webhookHeaders);
        let body: unknown;
        if (webhookBody.trim().length > 0) {
          try {
            body = JSON.parse(webhookBody);
          } catch {
            return null;
          }
        }
        return {
          url: webhookUrl,
          method: webhookMethod,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          ...(body !== undefined ? { body } : {}),
          ...(webhookAuthFromSecret ? { authorizationFromSecret: true } : {}),
        };
      }
      case "email": {
        const recipients = emailTo
          .split(",")
          .map((address) => address.trim())
          .filter((address) => address.length > 0);
        return {
          to: recipients.length === 1 ? recipients[0] : recipients,
          subject: emailSubject,
          body: emailBody,
        };
      }
      case "steps":
      default:
        try {
          return JSON.parse(stepsJson || "{}") as Record<string, unknown>;
        } catch {
          return null;
        }
    }
  }

  // Live validation feedback for `webhook`'s body field as the admin types, separate from
  // `targetConfigError` (which is only set on submit, for `steps`) since this one's field is
  // always visible while `targetType === "webhook"`, not gated behind a submit attempt.
  let webhookBodyJsonError = false;
  if (webhookBody.trim().length > 0) {
    try {
      JSON.parse(webhookBody);
    } catch {
      webhookBodyJsonError = true;
    }
  }

  async function handleCreate() {
    setTargetConfigError(null);
    const targetConfig = buildTargetConfig();
    if (targetConfig === null) {
      setTargetConfigError(t("common.invalidJson"));
      return;
    }

    try {
      await createJob.mutateAsync({
        name,
        cronExpr,
        timezone,
        targetType,
        targetConfig,
        dispatchMode,
        enabled: true,
      });
      setName("");
      setCronExpr("");
      resetTargetConfigFields();
      await refetch();
    } catch {
      // surfaced via createJob.error below
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("common.deleteConfirm"))) {
      return;
    }
    setRowError(null);
    try {
      await deleteJob(id);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  return (
    <div className="py-8">
      <h2 className="mb-4 text-xl font-semibold text-foreground">{t("admin.cronJobs.title")}</h2>

      <div className="mb-8 flex max-w-[480px] flex-col gap-4">
        <h4 className="text-base font-medium text-foreground">{t("admin.cronJobs.createTitle")}</h4>
        {createJob.error ? (
          <Alert variant="destructive">
            {createJob.error instanceof ApiError
              ? createJob.error.message
              : t("common.somethingWentWrong")}
          </Alert>
        ) : null}
        <Input
          label={t("admin.cronJobs.name")}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Input
          label={t("admin.cronJobs.cronExpr")}
          helperText={t("admin.cronJobs.cronExprDescription")}
          value={cronExpr}
          onChange={(event) => setCronExpr(event.currentTarget.value)}
        />
        <Input
          label={t("admin.cronJobs.timezone")}
          value={timezone}
          onChange={(event) => setTimezone(event.currentTarget.value)}
        />
        <Select
          label={t("admin.cronJobs.targetType")}
          options={TARGET_TYPES.map((v) => ({ value: v, label: v }))}
          value={targetType}
          onValueChange={(value) => setTargetType(value)}
        />
        <Select
          label={t("admin.cronJobs.dispatchMode")}
          options={DISPATCH_MODES.map((v) => ({ value: v, label: v }))}
          value={dispatchMode}
          onValueChange={(value) => setDispatchMode(value)}
        />
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("admin.cronJobs.targetConfig")}
          </span>
          {targetType === "workflow_transition" ? (
            <>
              <Input
                label={t("admin.cronJobs.targetEntity")}
                value={wtEntity}
                onChange={(event) => setWtEntity(event.currentTarget.value)}
              />
              <Input
                label={t("admin.cronJobs.targetRecordId")}
                value={wtRecordId}
                onChange={(event) => setWtRecordId(event.currentTarget.value)}
              />
              <Input
                label={t("admin.cronJobs.targetAction")}
                value={wtAction}
                onChange={(event) => setWtAction(event.currentTarget.value)}
              />
            </>
          ) : null}
          {targetType === "bulk_query_action" ? (
            <>
              <Input
                label={t("admin.cronJobs.targetEntity")}
                value={bqaEntity}
                onChange={(event) => setBqaEntity(event.currentTarget.value)}
              />
              <Input
                label={t("admin.cronJobs.targetAction")}
                value={bqaAction}
                onChange={(event) => setBqaAction(event.currentTarget.value)}
              />
              <span className="text-xs text-muted-foreground">
                {t("admin.cronJobs.targetFilters")}
              </span>
              <KeyValueListEditor
                rows={bqaFilters}
                onChange={setBqaFilters}
                keyLabel={t("admin.cronJobs.filterField")}
                valueLabel={t("admin.cronJobs.filterValue")}
                addLabel={t("admin.cronJobs.addFilter")}
                removeLabel={t("common.delete")}
              />
            </>
          ) : null}
          {targetType === "webhook" ? (
            <>
              <Input
                label={t("admin.cronJobs.targetUrl")}
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.currentTarget.value)}
              />
              <Select
                label={t("admin.cronJobs.targetMethod")}
                options={HTTP_METHODS.map((v) => ({ value: v, label: v }))}
                value={webhookMethod}
                onValueChange={(value) => setWebhookMethod(value)}
              />
              <span className="text-xs text-muted-foreground">
                {t("admin.cronJobs.targetHeaders")}
              </span>
              <KeyValueListEditor
                rows={webhookHeaders}
                onChange={setWebhookHeaders}
                keyLabel={t("admin.cronJobs.headerName")}
                valueLabel={t("admin.cronJobs.headerValue")}
                addLabel={t("admin.cronJobs.addHeader")}
                removeLabel={t("common.delete")}
              />
              <Textarea
                label={t("admin.cronJobs.targetBody")}
                helperText={t("admin.cronJobs.targetBodyDescription")}
                value={webhookBody}
                onChange={(event) => setWebhookBody(event.currentTarget.value)}
                error={webhookBodyJsonError ? t("common.invalidJson") : undefined}
                rows={2}
              />
              <Toggle
                checked={webhookAuthFromSecret}
                onCheckedChange={setWebhookAuthFromSecret}
                label={t("admin.cronJobs.targetAuthFromSecret")}
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.cronJobs.targetAuthFromSecretDescription")}
              </p>
            </>
          ) : null}
          {targetType === "email" ? (
            <>
              <Input
                label={t("admin.cronJobs.targetEmailTo")}
                helperText={t("admin.cronJobs.targetEmailToDescription")}
                value={emailTo}
                onChange={(event) => setEmailTo(event.currentTarget.value)}
              />
              <Input
                label={t("admin.cronJobs.targetEmailSubject")}
                value={emailSubject}
                onChange={(event) => setEmailSubject(event.currentTarget.value)}
              />
              <Textarea
                label={t("admin.cronJobs.targetEmailBody")}
                value={emailBody}
                onChange={(event) => setEmailBody(event.currentTarget.value)}
                rows={3}
              />
            </>
          ) : null}
          {targetType === "steps" ? (
            <Textarea
              label={t("admin.cronJobs.targetConfig")}
              helperText={t("admin.cronJobs.targetStepsDescription")}
              value={stepsJson}
              onChange={(event) => setStepsJson(event.currentTarget.value)}
              error={targetConfigError ?? undefined}
              rows={6}
            />
          ) : null}
        </div>
        <Button
          onClick={() => void handleCreate()}
          disabled={name.trim().length === 0 || cronExpr.trim().length === 0}
          loading={createJob.isPending}
        >
          {t("common.new")}
        </Button>
      </div>

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

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ApiErrorMessage error={error} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.cronJobs.name")}</TableHead>
              <TableHead>{t("admin.cronJobs.cronExpr")}</TableHead>
              <TableHead>{t("admin.cronJobs.timezone")}</TableHead>
              <TableHead>{t("admin.cronJobs.targetType")}</TableHead>
              <TableHead>{t("admin.cronJobs.dispatchMode")}</TableHead>
              <TableHead>{t("admin.cronJobs.nextRunAt")}</TableHead>
              <TableHead>{t("admin.cronJobs.enabled")}</TableHead>
              <TableHead>{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(jobs ?? []).map((job) => (
              <Fragment key={job.id}>
                <TableRow>
                  <TableCell>{job.name}</TableCell>
                  <TableCell>{job.cronExpr}</TableCell>
                  <TableCell>{job.timezone}</TableCell>
                  <TableCell>{job.targetType}</TableCell>
                  <TableCell>{job.dispatchMode}</TableCell>
                  <TableCell>{job.nextRunAt}</TableCell>
                  <TableCell>
                    <Toggle checked={job.enabled} onCheckedChange={() => void toggleEnabled(job)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setExpandedJobId((current) => (current === job.id ? null : job.id))
                        }
                      >
                        {expandedJobId === job.id
                          ? t("workflow.hide")
                          : t("admin.cronJobs.runs.title")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => void handleDelete(job.id)}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expandedJobId === job.id ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <CronJobRuns jobId={job.id} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** Self-gated on the `admin` role rather than trusting every consumer to gate the route: the
 * `CronJobsAdminPageContent` body below fires `/admin/*` requests from its very first render, so an
 * ungated non-admin would otherwise watch the page assemble itself and then fill with 403 alerts.
 * `AdminOnly` keeps that body unmounted entirely until roles resolve and pass
 * (`docs/audits/02-auth-permission-workflow-diagram-audit.md` finding B6). */
export function CronJobsAdminPage() {
  return (
    <AdminOnly>
      <CronJobsAdminPageContent />
    </AdminOnly>
  );
}
