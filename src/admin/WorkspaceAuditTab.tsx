import { useState } from "react";
import { Alert, Badge, Button, DateTimePicker, Input, Select, Spinner } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { useTenantUsers } from "../auth/useTenantUsers";
import { relativeTime } from "../lib/dates";
import {
  downloadAuditExport,
  useAuditEntries,
  verifyAuditChain,
  type AuditChainReport,
  type AuditEntry,
  type AuditFilter,
} from "./workspaceAdvancedApi";

const ACTIONS = ["create", "update", "delete", "transition"] as const;
const ALL = "__all__";

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "∅";
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join(", ") : "∅";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** `{ field: [before, after] }`; anything else is shown raw. */
function readDiff(raw: string): [string, unknown, unknown][] | string | null {
  if (!raw || raw === "{}" || raw === "null") return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed).map(([field, change]) =>
      Array.isArray(change) && change.length === 2
        ? [field, change[0], change[1]]
        : [field, undefined, change],
    );
  } catch {
    return raw;
  }
}

/**
 * The tenant's whole audit trail (roadmap 115 M9): who did what to which record, filtered by
 * person, entity, record, action and time, a page at a time; exported as CSV or JSON; and the
 * tamper-evident hash chain checked end to end.
 */
export function WorkspaceAuditTab() {
  const { t, i18n } = useTranslation();
  const people = useTenantUsers();
  const [actor, setActor] = useState(ALL);
  const [entity, setEntity] = useState("");
  const [recordId, setRecordId] = useState("");
  const [action, setAction] = useState(ALL);
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [applied, setApplied] = useState<AuditFilter>({});
  const [report, setReport] = useState<AuditChainReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const audit = useAuditEntries(applied);
  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? [];
  const who = (id: string) =>
    id ? (people.find((p) => p.id === id)?.email ?? id.slice(0, 8)) : t("workspace.auditSystem");

  function apply() {
    setApplied({
      actorUserId: actor === ALL ? undefined : actor,
      entity: entity.trim() || undefined,
      recordId: recordId.trim() || undefined,
      actions: action === ALL ? undefined : [action],
      from: from ? from.toISOString() : undefined,
      to: to ? to.toISOString() : undefined,
    });
  }

  function clear() {
    setActor(ALL);
    setEntity("");
    setRecordId("");
    setAction(ALL);
    setFrom(null);
    setTo(null);
    setApplied({});
  }

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select
          label={t("workspace.auditActor")}
          options={[
            { value: ALL, label: t("workspace.auditAnyone") },
            ...people.map((p) => ({ value: p.id, label: p.email || p.id })),
          ]}
          value={actor}
          onValueChange={setActor}
        />
        <Input
          label={t("workspace.auditEntity")}
          placeholder="waf.zones"
          value={entity}
          onChange={(e) => setEntity(e.currentTarget.value)}
        />
        <Input
          label={t("workspace.auditRecord")}
          placeholder={t("workspace.auditRecordPlaceholder")}
          value={recordId}
          onChange={(e) => setRecordId(e.currentTarget.value)}
        />
        <Select
          label={t("workspace.auditAction")}
          options={[
            { value: ALL, label: t("workspace.auditAnyAction") },
            ...ACTIONS.map((a) => ({ value: a, label: t(`workspace.auditAction_${a}`) })),
          ]}
          value={action}
          onValueChange={setAction}
        />
        <DateTimePicker label={t("workspace.auditFrom")} value={from} onValueChange={setFrom} />
        <DateTimePicker label={t("workspace.auditTo")} value={to} onValueChange={setTo} />
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
          <Button size="sm" onClick={apply}>
            {t("workspace.auditApply")}
          </Button>
          <Button size="sm" variant="ghost" onClick={clear}>
            {t("workspace.auditClear")}
          </Button>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              loading={busy === "csv"}
              onClick={() => void run("csv", () => downloadAuditExport(applied, "csv"))}
            >
              {t("workspace.auditExportCsv")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={busy === "json"}
              onClick={() => void run("json", () => downloadAuditExport(applied, "json"))}
            >
              {t("workspace.auditExportJson")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={busy === "verify"}
              onClick={() => void run("verify", async () => setReport(await verifyAuditChain()))}
            >
              {t("workspace.auditVerify")}
            </Button>
          </span>
        </div>
      </div>

      {error ? <ApiErrorMessage error={error} /> : null}
      {report ? (
        <Alert variant={report.ok ? "default" : "destructive"}>
          {report.ok
            ? t("workspace.auditChainOk", { count: report.checked, head: report.headSeq })
            : t("workspace.auditChainBroken", {
                seq: report.brokenSeq,
                reason: report.reason,
                count: report.checked,
              })}
        </Alert>
      ) : null}

      {audit.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : audit.error ? (
        <ApiErrorMessage error={audit.error} />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("workspace.auditEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {entries.map((entry) => (
            <AuditRow key={entry.id} entry={entry} who={who} locale={i18n.language} />
          ))}
        </ul>
      )}
      {audit.hasNextPage ? (
        <Button
          variant="outline"
          className="self-center"
          loading={audit.isFetchingNextPage}
          onClick={() => void audit.fetchNextPage()}
        >
          {t("workspace.auditMore")}
        </Button>
      ) : null}
    </div>
  );
}

function AuditRow({
  entry,
  who,
  locale,
}: {
  entry: AuditEntry;
  who: (id: string) => string;
  locale: string;
}) {
  const { t } = useTranslation();
  const diff = readDiff(entry.diffJson);
  const actionKey = (ACTIONS as readonly string[]).includes(entry.action)
    ? t(`workspace.auditAction_${entry.action}`)
    : entry.action;
  return (
    <li className="flex flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-normal">
          {entry.transitionAction ? `${actionKey}: ${entry.transitionAction}` : actionKey}
        </Badge>
        <span className="font-mono text-xs">{entry.entity}</span>
        <span className="truncate font-mono text-xs text-muted-foreground" title={entry.recordId}>
          {entry.recordId.slice(0, 8)}
        </span>
        <span className="text-muted-foreground">{who(entry.actorUserId)}</span>
        <span
          className="ml-auto shrink-0 text-xs text-muted-foreground"
          title={new Date(entry.occurredAt).toLocaleString()}
        >
          {entry.seq ? `#${entry.seq} · ` : ""}
          {relativeTime(entry.occurredAt, locale)}
        </span>
      </div>
      {entry.reason ? <p className="text-xs text-muted-foreground">{entry.reason}</p> : null}
      {typeof diff === "string" ? (
        <code className="break-all text-xs text-muted-foreground">{diff}</code>
      ) : diff ? (
        <ul className="flex flex-col gap-0.5 text-xs">
          {diff.map(([field, before, after]) => (
            <li key={field} className="break-all">
              <span className="font-medium">{field}</span>:{" "}
              <span className="text-muted-foreground line-through">{formatValue(before)}</span>
              {" → "}
              <span>{formatValue(after)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
