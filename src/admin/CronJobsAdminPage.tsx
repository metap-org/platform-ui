import { useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Select,
  SettingsRow,
  SettingsSection,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Spinner,
  Textarea,
  Toggle,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { relativeTime } from "../lib/dates";
import { DataList, type DataListColumn } from "../list/DataList";
import {
  useAdminCronJobActions,
  useAdminCronJobs,
  useCreateAdminCronJob,
  useCronJobRuns,
  type CronJob,
} from "./adminApi";
import { AdminOnly } from "../auth/AdminOnly";
import { ConfirmButton } from "./ConfirmButton";

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
    <div className="flex flex-col gap-1.5">
      {rows.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2 text-xs text-muted-foreground">
          <span>{keyLabel}</span>
          <span>{valueLabel}</span>
        </div>
      ) : null}
      {rows.map((row, index) => (
        <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2">
          <Input
            aria-label={keyLabel}
            value={row.key}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, key: event.currentTarget.value };
              onChange(next);
            }}
          />
          <Input
            aria-label={valueLabel}
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
            className="self-center text-destructive hover:text-destructive"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            icon={<span className="text-base leading-none">×</span>}
          />
        </div>
      ))}
      <div>
        <Button variant="ghost" size="sm" onClick={() => onChange([...rows, emptyKeyValueRow()])}>
          + {addLabel}
        </Button>
      </div>
    </div>
  );
}

function runStatusVariant(status: string): "success" | "destructive" | "warning" | "secondary" {
  if (status === "succeeded" || status === "success" || status === "completed") return "success";
  if (status === "failed" || status === "error") return "destructive";
  if (status === "running" || status === "pending" || status === "queued") return "warning";
  return "secondary";
}

/** A field of the create form: label over its control, help under it, in a 2-column grid. */
function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1${wide ? " sm:col-span-2" : ""}`}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function CronJobRuns({ jobId }: { jobId: string }) {
  const { t, i18n } = useTranslation();
  const { data: runs, isLoading, error } = useCronJobRuns(jobId);

  if (isLoading) return <Spinner size="sm" />;
  if (error) return <ApiErrorMessage error={error} />;
  if ((runs ?? []).length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">{t("admin.cronJobs.noRuns")}</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {(runs ?? []).map((run) => (
        <li key={run.id} className="flex flex-col gap-0.5 px-4 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={runStatusVariant(run.status)}>{run.status}</Badge>
            <span title={run.scheduledFor}>
              {t("admin.cronJobs.runScheduled", {
                when: relativeTime(run.scheduledFor, i18n.language),
              })}
            </span>
            <span className="ml-auto text-xs text-muted-foreground" title={run.finishedAt ?? ""}>
              {run.finishedAt
                ? t("admin.cronJobs.runFinished", {
                    when: relativeTime(run.finishedAt, i18n.language),
                  })
                : "—"}
            </span>
          </div>
          {run.error ? (
            <code className="break-all text-xs text-destructive">{run.error}</code>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function JobDetail({ job }: { job: CronJob }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex flex-col gap-4 pt-2">
      <SettingsSection title={t("admin.cronJobs.schedule")}>
        <SettingsRow label={t("admin.cronJobs.cronExpr")}>
          <code className="rounded bg-muted px-2 py-0.5 text-sm">{job.cronExpr}</code>
        </SettingsRow>
        <SettingsRow label={t("admin.cronJobs.timezone")}>
          <span className="text-sm">{job.timezone}</span>
        </SettingsRow>
        <SettingsRow label={t("admin.cronJobs.nextRunAt")}>
          <span className="text-sm" title={job.nextRunAt}>
            {job.enabled ? relativeTime(job.nextRunAt, i18n.language) : t("admin.cronJobs.paused")}
          </span>
        </SettingsRow>
        <SettingsRow label={t("admin.cronJobs.lastRunAt")}>
          <span className="text-sm" title={job.lastRunAt ?? ""}>
            {job.lastRunAt
              ? relativeTime(job.lastRunAt, i18n.language)
              : t("admin.cronJobs.neverRan")}
          </span>
        </SettingsRow>
        <SettingsRow
          label={t("admin.cronJobs.dispatchMode")}
          description={t(`admin.cronJobs.dispatch_${job.dispatchMode}_hint`, { defaultValue: "" })}
        >
          <span className="text-sm">
            {t(`admin.cronJobs.dispatch_${job.dispatchMode}`, { defaultValue: job.dispatchMode })}
          </span>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        title={t("admin.cronJobs.target")}
        actions={
          <Badge variant="outline">
            {t(`admin.cronJobs.type_${job.targetType}`, { defaultValue: job.targetType })}
          </Badge>
        }
      >
        <pre className="max-h-64 overflow-auto px-4 py-3 text-xs">
          {JSON.stringify(job.targetConfig, null, 2)}
        </pre>
      </SettingsSection>
      <SettingsSection title={t("admin.cronJobs.runs.title")}>
        <CronJobRuns jobId={job.id} />
      </SettingsSection>
    </div>
  );
}

function CronJobsAdminPageContent() {
  const { t, i18n } = useTranslation();
  const { data: jobs, isLoading, error, refetch, isFetching } = useAdminCronJobs();
  const { toggleEnabled, deleteJob } = useAdminCronJobActions();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const open = (jobs ?? []).find((j) => j.id === openId) ?? null;
  const needle = search.trim().toLowerCase();
  const rows = (jobs ?? []).filter(
    (j) => !needle || j.name.toLowerCase().includes(needle) || j.targetType.includes(needle),
  );

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setRowError(null);
    try {
      await fn();
    } catch (err) {
      setRowError(err);
    } finally {
      setBusy(null);
    }
  }

  const typeLabel = (type: string) => t(`admin.cronJobs.type_${type}`, { defaultValue: type });

  const columns: DataListColumn<CronJob>[] = [
    {
      key: "name",
      header: t("admin.cronJobs.name"),
      required: true,
      cell: (job) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{job.name}</div>
          <div className="truncate text-xs text-muted-foreground">{typeLabel(job.targetType)}</div>
        </div>
      ),
    },
    {
      key: "schedule",
      header: t("admin.cronJobs.schedule"),
      width: "14rem",
      cell: (job) => (
        <div className="min-w-0">
          <code className="text-xs">{job.cronExpr}</code>
          <div className="truncate text-xs text-muted-foreground">{job.timezone}</div>
        </div>
      ),
    },
    {
      key: "nextRun",
      header: t("admin.cronJobs.nextRunAt"),
      width: "9rem",
      cell: (job) =>
        job.enabled ? (
          <span title={job.nextRunAt}>{relativeTime(job.nextRunAt, i18n.language)}</span>
        ) : (
          <span className="text-muted-foreground">{t("admin.cronJobs.paused")}</span>
        ),
    },
    {
      key: "lastRun",
      header: t("admin.cronJobs.lastRunAt"),
      width: "9rem",
      cell: (job) =>
        job.lastRunAt ? (
          <span title={job.lastRunAt}>{relativeTime(job.lastRunAt, i18n.language)}</span>
        ) : (
          <span className="text-muted-foreground">{t("admin.cronJobs.neverRan")}</span>
        ),
    },
    {
      key: "enabled",
      header: t("admin.cronJobs.enabled"),
      width: "6rem",
      cell: (job) => (
        <span onClick={(event) => event.stopPropagation()}>
          <Toggle
            checked={job.enabled}
            disabled={busy === job.id}
            aria-label={t("admin.cronJobs.enabled")}
            onCheckedChange={() => void act(job.id, () => toggleEnabled(job))}
          />
        </span>
      ),
    },
  ];

  return (
    <>
      <DataList
        title={t("admin.cronJobs.title")}
        rows={rows}
        getRowId={(job) => job.id}
        columns={columns}
        loading={isLoading}
        error={error}
        emptyText={t("admin.cronJobs.empty")}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: t("admin.cronJobs.searchPlaceholder"),
        }}
        onRefresh={() => void refetch()}
        refreshing={isFetching}
        onRowClick={(job) => setOpenId(job.id)}
        banner={rowError ? <ApiErrorMessage error={rowError} /> : null}
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            {t("admin.cronJobs.createTitle")}
          </Button>
        }
        rowActionsWidth="96px"
        rowActions={(job) => (
          <ConfirmButton
            label={t("common.delete")}
            description={t("admin.cronJobs.deleteConfirm", { name: job.name })}
            destructive
            busy={busy === `delete-${job.id}`}
            onConfirm={() =>
              void act(`delete-${job.id}`, async () => {
                await deleteJob(job.id);
                if (openId === job.id) setOpenId(null);
              })
            }
          />
        )}
      />
      <CreateCronJobDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void refetch();
        }}
      />
      <Sheet open={open !== null} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {open.name}
                  <Badge variant={open.enabled ? "success" : "secondary"}>
                    {open.enabled ? t("admin.cronJobs.on") : t("admin.cronJobs.paused")}
                  </Badge>
                </SheetTitle>
              </SheetHeader>
              <JobDetail job={open} />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function CreateCronJobDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const createJob = useCreateAdminCronJob();
  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [targetType, setTargetType] = useState<string>(TARGET_TYPES[0] ?? "webhook");
  const [dispatchMode, setDispatchMode] = useState<string>(DISPATCH_MODES[0] ?? "outbox");

  // One state group per `TargetType` shape (`metap_cron::model::TargetType`'s doc comment is the
  // source of truth for these). `steps` stays labeled raw JSON: it chains the other shapes, and a
  // recursive step editor is a bigger, separate effort.
  const [wtEntity, setWtEntity] = useState("");
  const [wtRecordId, setWtRecordId] = useState("");
  const [wtAction, setWtAction] = useState("");
  const [bqaEntity, setBqaEntity] = useState("");
  const [bqaAction, setBqaAction] = useState("");
  const [bqaFilters, setBqaFilters] = useState<KeyValueRow[]>([emptyKeyValueRow()]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookMethod, setWebhookMethod] = useState<string>(HTTP_METHODS[1] ?? "POST");
  const [webhookHeaders, setWebhookHeaders] = useState<KeyValueRow[]>([]);
  // JSON sent verbatim as the request body (`WebhookConfig.body: Option<Value>`), no templating.
  const [webhookBody, setWebhookBody] = useState("");
  const [webhookAuthFromSecret, setWebhookAuthFromSecret] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [stepsJson, setStepsJson] = useState('{\n  "steps": []\n}');
  const [targetConfigError, setTargetConfigError] = useState<string | null>(null);

  function reset() {
    setName("");
    setCronExpr("");
    setTimezone("UTC");
    setTargetType(TARGET_TYPES[0] ?? "webhook");
    setDispatchMode(DISPATCH_MODES[0] ?? "outbox");
    setWtEntity("");
    setWtRecordId("");
    setWtAction("");
    setBqaEntity("");
    setBqaAction("");
    setBqaFilters([emptyKeyValueRow()]);
    setWebhookUrl("");
    setWebhookMethod(HTTP_METHODS[1] ?? "POST");
    setWebhookHeaders([]);
    setWebhookBody("");
    setWebhookAuthFromSecret(false);
    setEmailTo("");
    setEmailSubject("");
    setEmailBody("");
    setStepsJson('{\n  "steps": []\n}');
    setTargetConfigError(null);
    createJob.reset();
  }

  function close() {
    reset();
    onClose();
  }

  /** The `target_config` shape `metap_cron::model::TargetType` declares for `targetType`;
   *  `null` when a JSON field doesn't parse. */
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
      reset();
      onCreated();
    } catch {
      // shown from createJob.error
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("admin.cronJobs.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {createJob.error ? (
            <Alert variant="destructive">
              {createJob.error instanceof ApiError
                ? createJob.error.message
                : t("common.somethingWentWrong")}
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("admin.cronJobs.name")} wide>
              <Input
                aria-label={t("admin.cronJobs.name")}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </Field>
            <Field
              label={t("admin.cronJobs.cronExpr")}
              hint={t("admin.cronJobs.cronExprDescription")}
            >
              <Input
                aria-label={t("admin.cronJobs.cronExpr")}
                className="font-mono"
                placeholder="0 */15 * * * *"
                value={cronExpr}
                onChange={(event) => setCronExpr(event.currentTarget.value)}
              />
            </Field>
            <Field label={t("admin.cronJobs.timezone")} hint={t("admin.cronJobs.timezoneHint")}>
              <Input
                aria-label={t("admin.cronJobs.timezone")}
                value={timezone}
                onChange={(event) => setTimezone(event.currentTarget.value)}
              />
            </Field>
            <Field label={t("admin.cronJobs.targetType")}>
              <Select
                aria-label={t("admin.cronJobs.targetType")}
                options={TARGET_TYPES.map((v) => ({
                  value: v,
                  label: t(`admin.cronJobs.type_${v}`, { defaultValue: v }),
                }))}
                value={targetType}
                onValueChange={setTargetType}
              />
            </Field>
            <Field
              label={t("admin.cronJobs.dispatchMode")}
              hint={t(`admin.cronJobs.dispatch_${dispatchMode}_hint`, { defaultValue: "" })}
            >
              <Select
                aria-label={t("admin.cronJobs.dispatchMode")}
                options={DISPATCH_MODES.map((v) => ({
                  value: v,
                  label: t(`admin.cronJobs.dispatch_${v}`, { defaultValue: v }),
                }))}
                value={dispatchMode}
                onValueChange={setDispatchMode}
              />
            </Field>
          </div>

          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-4 py-2 text-sm font-semibold">
              {t("admin.cronJobs.target")}:{" "}
              <span className="font-normal text-muted-foreground">
                {t(`admin.cronJobs.type_${targetType}`, { defaultValue: targetType })}
              </span>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              {targetType === "workflow_transition" ? (
                <>
                  <Field label={t("admin.cronJobs.targetEntity")}>
                    <Input
                      aria-label={t("admin.cronJobs.targetEntity")}
                      placeholder="waf.zones"
                      value={wtEntity}
                      onChange={(event) => setWtEntity(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={t("admin.cronJobs.targetAction")}>
                    <Input
                      aria-label={t("admin.cronJobs.targetAction")}
                      value={wtAction}
                      onChange={(event) => setWtAction(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={t("admin.cronJobs.targetRecordId")} wide>
                    <Input
                      aria-label={t("admin.cronJobs.targetRecordId")}
                      className="font-mono"
                      value={wtRecordId}
                      onChange={(event) => setWtRecordId(event.currentTarget.value)}
                    />
                  </Field>
                </>
              ) : null}
              {targetType === "bulk_query_action" ? (
                <>
                  <Field label={t("admin.cronJobs.targetEntity")}>
                    <Input
                      aria-label={t("admin.cronJobs.targetEntity")}
                      placeholder="waf.zones"
                      value={bqaEntity}
                      onChange={(event) => setBqaEntity(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={t("admin.cronJobs.targetAction")}>
                    <Input
                      aria-label={t("admin.cronJobs.targetAction")}
                      value={bqaAction}
                      onChange={(event) => setBqaAction(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={t("admin.cronJobs.targetFilters")} wide>
                    <KeyValueListEditor
                      rows={bqaFilters}
                      onChange={setBqaFilters}
                      keyLabel={t("admin.cronJobs.filterField")}
                      valueLabel={t("admin.cronJobs.filterValue")}
                      addLabel={t("admin.cronJobs.addFilter")}
                      removeLabel={t("common.delete")}
                    />
                  </Field>
                </>
              ) : null}
              {targetType === "webhook" ? (
                <>
                  <div className="grid gap-2 sm:col-span-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
                    <Field label={t("admin.cronJobs.targetMethod")}>
                      <Select
                        aria-label={t("admin.cronJobs.targetMethod")}
                        options={HTTP_METHODS.map((v) => ({ value: v, label: v }))}
                        value={webhookMethod}
                        onValueChange={setWebhookMethod}
                      />
                    </Field>
                    <Field label={t("admin.cronJobs.targetUrl")}>
                      <Input
                        aria-label={t("admin.cronJobs.targetUrl")}
                        placeholder="https://"
                        value={webhookUrl}
                        onChange={(event) => setWebhookUrl(event.currentTarget.value)}
                      />
                    </Field>
                  </div>
                  <Field label={t("admin.cronJobs.targetHeaders")} wide>
                    <KeyValueListEditor
                      rows={webhookHeaders}
                      onChange={setWebhookHeaders}
                      keyLabel={t("admin.cronJobs.headerName")}
                      valueLabel={t("admin.cronJobs.headerValue")}
                      addLabel={t("admin.cronJobs.addHeader")}
                      removeLabel={t("common.delete")}
                    />
                  </Field>
                  <Field
                    label={t("admin.cronJobs.targetBody")}
                    hint={t("admin.cronJobs.targetBodyDescription")}
                    wide
                  >
                    <Textarea
                      aria-label={t("admin.cronJobs.targetBody")}
                      className="font-mono text-xs"
                      value={webhookBody}
                      onChange={(event) => setWebhookBody(event.currentTarget.value)}
                      error={webhookBodyJsonError ? t("common.invalidJson") : undefined}
                      rows={3}
                    />
                  </Field>
                  <div className="flex items-start justify-between gap-4 sm:col-span-2">
                    <div>
                      <div className="text-sm font-medium">
                        {t("admin.cronJobs.targetAuthFromSecret")}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("admin.cronJobs.targetAuthFromSecretDescription")}
                      </p>
                    </div>
                    <Toggle
                      checked={webhookAuthFromSecret}
                      onCheckedChange={setWebhookAuthFromSecret}
                      aria-label={t("admin.cronJobs.targetAuthFromSecret")}
                    />
                  </div>
                </>
              ) : null}
              {targetType === "email" ? (
                <>
                  <Field
                    label={t("admin.cronJobs.targetEmailTo")}
                    hint={t("admin.cronJobs.targetEmailToDescription")}
                    wide
                  >
                    <Input
                      aria-label={t("admin.cronJobs.targetEmailTo")}
                      value={emailTo}
                      onChange={(event) => setEmailTo(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={t("admin.cronJobs.targetEmailSubject")} wide>
                    <Input
                      aria-label={t("admin.cronJobs.targetEmailSubject")}
                      value={emailSubject}
                      onChange={(event) => setEmailSubject(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={t("admin.cronJobs.targetEmailBody")} wide>
                    <Textarea
                      aria-label={t("admin.cronJobs.targetEmailBody")}
                      value={emailBody}
                      onChange={(event) => setEmailBody(event.currentTarget.value)}
                      rows={4}
                    />
                  </Field>
                </>
              ) : null}
              {targetType === "steps" ? (
                <Field
                  label={t("admin.cronJobs.targetConfig")}
                  hint={t("admin.cronJobs.targetStepsDescription")}
                  wide
                >
                  <Textarea
                    aria-label={t("admin.cronJobs.targetConfig")}
                    className="font-mono text-xs"
                    value={stepsJson}
                    onChange={(event) => setStepsJson(event.currentTarget.value)}
                    error={targetConfigError ?? undefined}
                    rows={8}
                  />
                </Field>
              ) : null}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("shell.cancel")}
          </Button>
          <Button
            onClick={() => void handleCreate()}
            disabled={name.trim().length === 0 || cronExpr.trim().length === 0}
            loading={createJob.isPending}
          >
            {t("admin.cronJobs.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
