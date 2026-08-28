import { useState } from "react";
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
} from "@ui/ui-lib";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { useEntities } from "../metadata/useEntities";
import { useEntity } from "../metadata/useEntity";
import { useAdminPolicies, useCreateAdminPolicy, useDeleteAdminPolicy } from "./adminApi";

const ACTIONS = ["read", "create", "update", "delete", "write"];
const NO_FIELD = "";

export function PoliciesAdminPage() {
  const { t } = useTranslation();
  const { data: policies, isLoading, error, refetch } = useAdminPolicies();
  const { data: entities } = useEntities();
  const createPolicy = useCreateAdminPolicy();
  const deletePolicy = useDeleteAdminPolicy();

  const [entity, setEntity] = useState("");
  const [action, setAction] = useState<string>(ACTIONS[0]!);
  const [roles, setRoles] = useState("");
  const [field, setField] = useState(NO_FIELD);
  const { data: selectedEntity } = useEntity(entity);
  const fieldOptions = [
    { value: NO_FIELD, label: t("admin.policies.fieldNone") },
    ...(selectedEntity?.fields.map((f) => ({ value: f.name, label: f.label })) ?? []),
  ];
  const [subject, setSubject] = useState<string>("context");
  const [conditionText, setConditionText] = useState("");
  const [conditionError, setConditionError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function handleCreate() {
    setConditionError(null);
    let condition: unknown;
    if (conditionText.trim().length > 0) {
      try {
        condition = JSON.parse(conditionText);
      } catch {
        setConditionError(t("common.invalidJson"));
        return;
      }
    }

    try {
      await createPolicy.mutateAsync({
        entity,
        action,
        roles: roles
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
        field: field.trim().length > 0 ? field.trim() : undefined,
        subject,
        condition,
      });
      setEntity("");
      setAction(ACTIONS[0]!);
      setRoles("");
      setField(NO_FIELD);
      setConditionText("");
      await refetch();
    } catch {
      // surfaced via createPolicy.error below
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("common.deleteConfirm"))) {
      return;
    }
    setRowError(null);
    try {
      await deletePolicy(id);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  return (
    <div className="py-8">
      <h2 className="mb-4 text-xl font-semibold text-foreground">{t("admin.policies.title")}</h2>

      <div className="mb-8 flex max-w-[480px] flex-col gap-4">
        <h4 className="text-base font-medium text-foreground">{t("admin.policies.createTitle")}</h4>
        {createPolicy.error ? (
          <Alert variant="destructive">
            {createPolicy.error instanceof ApiError
              ? createPolicy.error.message
              : t("common.somethingWentWrong")}
          </Alert>
        ) : null}
        <Select
          label={t("admin.policies.entity")}
          options={(entities ?? []).map((e) => ({ value: e.name, label: e.label }))}
          value={entity || undefined}
          onValueChange={(value) => {
            setEntity(value);
            setField(NO_FIELD);
          }}
          placeholder={t("admin.policies.entityPlaceholder")}
        />
        <Select
          label={t("admin.policies.action")}
          options={ACTIONS.map((a) => ({ value: a, label: a }))}
          value={action}
          onValueChange={(value) => setAction(value)}
        />
        <Input
          label={t("admin.users.rolesLabel")}
          helperText={t("admin.users.rolesDescription")}
          value={roles}
          onChange={(event) => setRoles(event.currentTarget.value)}
        />
        <Select
          label={t("admin.policies.field")}
          helperText={t("admin.policies.fieldDescription")}
          options={fieldOptions}
          value={field}
          disabled={entity.length === 0}
          onValueChange={(value) => setField(value)}
        />
        <Select
          label={t("admin.policies.subject")}
          options={[
            { value: "context", label: "context" },
            { value: "record", label: "record" },
          ]}
          value={subject}
          onValueChange={(value) => setSubject(value)}
        />
        <Textarea
          label={t("admin.policies.condition")}
          helperText={t("admin.policies.conditionDescription")}
          value={conditionText}
          onChange={(event) => setConditionText(event.currentTarget.value)}
          error={conditionError ?? undefined}
          rows={2}
        />
        <Button
          onClick={() => void handleCreate()}
          disabled={
            createPolicy.isPending || entity.trim().length === 0 || action.trim().length === 0
          }
        >
          {createPolicy.isPending ? <Spinner size="sm" className="mr-2" /> : null}
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
              <TableHead>{t("admin.policies.entity")}</TableHead>
              <TableHead>{t("admin.policies.action")}</TableHead>
              <TableHead>{t("admin.policies.field")}</TableHead>
              <TableHead>{t("admin.policies.subject")}</TableHead>
              <TableHead>{t("admin.users.rolesLabel")}</TableHead>
              <TableHead>{t("admin.policies.condition")}</TableHead>
              <TableHead>{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(policies ?? []).map((policy) => (
              <TableRow key={policy.id}>
                <TableCell>{policy.entity}</TableCell>
                <TableCell>{policy.action}</TableCell>
                <TableCell>{policy.field ?? "—"}</TableCell>
                <TableCell>{policy.subject}</TableCell>
                <TableCell>{(policy.roles ?? []).join(", ") || "—"}</TableCell>
                <TableCell>
                  {policy.condition ? (
                    <pre className="max-w-[260px] whitespace-pre-wrap rounded bg-muted p-1 font-mono text-xs text-foreground">
                      {JSON.stringify(policy.condition)}
                    </pre>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void handleDelete(policy.id)}
                  >
                    {t("common.delete")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
