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

const TARGET_TYPES = ["workflow_transition", "bulk_query_action", "webhook"];
const DISPATCH_MODES = ["outbox", "direct"];

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
  const [targetConfigText, setTargetConfigText] = useState("{}");
  const [targetConfigError, setTargetConfigError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  async function handleCreate() {
    setTargetConfigError(null);
    let targetConfig: unknown;
    try {
      targetConfig = JSON.parse(targetConfigText || "{}");
    } catch {
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
      setTargetConfigText("{}");
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
        <Textarea
          label={t("admin.cronJobs.targetConfig")}
          helperText={t("admin.cronJobs.targetConfigDescription")}
          value={targetConfigText}
          onChange={(event) => setTargetConfigText(event.currentTarget.value)}
          error={targetConfigError ?? undefined}
          rows={3}
        />
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
