import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  IconButton,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TagsInput,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api/client";
import { ApiErrorMessage } from "../../api/ApiErrorMessage";
import type { EntitySummary } from "../../metadata/types";
import {
  useAdminPolicies,
  useAdminUsers,
  useCreateAdminPolicy,
  useDeleteAdminPolicy,
  useKnownActions,
} from "../adminApi";
import { describeCondition, isBasicShapedRow, type PolicyCondition } from "../policyCondition";
import { ConditionBuilder } from "./ConditionBuilder";
import { collectKnownRoles } from "./policyMatrixHelpers";

const NO_FIELD = "";

/**
 * The ABAC "advanced permissions" view — every policy for this entity that the RBAC matrix
 * (`PermissionMatrix`, this page's sibling tab) can't represent as a plain role checkbox: has a
 * `condition`, a field scope, checks the record instead of the caller's context, or denies
 * instead of allows (see `isBasicShapedRow`). Fetches `useAdminPolicies(entity.name)`
 * independently of `PermissionMatrix` — shared cache entry through `@tanstack/react-query`, not
 * a double round-trip, same note as that component's.
 */
export function AdvancedPoliciesPanel({ entity }: { entity: EntitySummary }) {
  const { t } = useTranslation();
  const { data: policies, isLoading, error, refetch } = useAdminPolicies(entity.name);
  const { data: actions } = useKnownActions();
  const { data: users } = useAdminUsers();
  const createPolicy = useCreateAdminPolicy();
  const deletePolicy = useDeleteAdminPolicy();

  const [action, setAction] = useState<string>("");
  const [roles, setRoles] = useState<string[]>([]);
  const [field, setField] = useState(NO_FIELD);
  const [subject, setSubject] = useState<"context" | "record">("context");
  const [effect, setEffect] = useState<"allow" | "deny">("allow");
  const [condition, setCondition] = useState<PolicyCondition | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const fieldOptions = [
    { value: NO_FIELD, label: t("admin.policies.fieldNone") },
    ...entity.fields.map((f) => ({ value: f.name, label: f.label })),
  ];
  const hasWorkflow = Boolean(entity.workflow);
  const knownRoles = collectKnownRoles(users ?? [], policies ?? [], []);

  function resetForm() {
    setAction("");
    setRoles([]);
    setField(NO_FIELD);
    setSubject("context");
    setEffect("allow");
    setCondition(null);
  }

  async function handleCreate() {
    try {
      await createPolicy.mutateAsync({
        entity: entity.name,
        action,
        roles,
        field: field.trim().length > 0 ? field.trim() : undefined,
        subject,
        effect,
        condition,
      });
      resetForm();
      await refetch();
    } catch {
      // surfaced via createPolicy.error below
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("common.deleteConfirm"))) return;
    setRowError(null);
    try {
      await deletePolicy(id);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  const advanced = (policies ?? []).filter((p) => !isBasicShapedRow(p));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-[520px] flex-col gap-4">
        <h4 className="text-base font-medium text-foreground">{t("admin.policies.createTitle")}</h4>
        {createPolicy.error ? (
          <Alert variant="destructive">
            {createPolicy.error instanceof ApiError
              ? createPolicy.error.message
              : t("common.somethingWentWrong")}
          </Alert>
        ) : null}
        <Select
          label={t("admin.policies.action")}
          options={(actions ?? []).map((a) => ({
            value: a,
            label: a,
            disabled: a === "transition" && !hasWorkflow,
          }))}
          value={action || undefined}
          onValueChange={setAction}
          placeholder={t("admin.policies.actionPlaceholder")}
        />
        <TagsInput
          label={t("admin.users.rolesLabel")}
          value={roles}
          onChange={setRoles}
          suggestions={knownRoles}
          placeholder={t("admin.policies.rolesPlaceholder")}
          helperText={t("admin.policies.rolesDescription")}
        />
        <Select
          label={t("admin.policies.field")}
          helperText={t("admin.policies.fieldDescription")}
          options={fieldOptions}
          value={field}
          onValueChange={setField}
        />
        <Select
          label={t("admin.policies.subject")}
          options={[
            { value: "context", label: "context" },
            { value: "record", label: "record" },
          ]}
          value={subject}
          onValueChange={(v) => setSubject(v as "context" | "record")}
        />
        <Select
          label={t("admin.policies.effect")}
          options={[
            { value: "allow", label: "allow" },
            { value: "deny", label: "deny" },
          ]}
          value={effect}
          onValueChange={(v) => setEffect(v as "allow" | "deny")}
        />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-foreground">
            {t("admin.policies.condition")}
          </label>
          <ConditionBuilder
            value={condition}
            onChange={setCondition}
            subject={subject}
            entity={entity}
          />
        </div>
        <Button
          onClick={() => void handleCreate()}
          disabled={createPolicy.isPending || action.trim().length === 0}
        >
          {createPolicy.isPending ? <Spinner size="sm" className="mr-2" /> : null}
          {t("common.new")}
        </Button>
      </div>

      {rowError ? (
        <Alert variant="destructive" className="flex items-center justify-between gap-2">
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
              <TableHead>{t("admin.policies.action")}</TableHead>
              <TableHead>{t("admin.policies.field")}</TableHead>
              <TableHead>{t("admin.policies.subject")}</TableHead>
              <TableHead>{t("admin.users.rolesLabel")}</TableHead>
              <TableHead>{t("admin.policies.condition")}</TableHead>
              <TableHead>{t("admin.policies.effect")}</TableHead>
              <TableHead>{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {advanced.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>{t("common.noRecords")}</TableCell>
              </TableRow>
            ) : (
              advanced.map((policy) => (
                <TableRow key={policy.id}>
                  <TableCell>{policy.action}</TableCell>
                  <TableCell>{policy.field ?? "—"}</TableCell>
                  <TableCell>{policy.subject}</TableCell>
                  <TableCell>{(policy.roles ?? []).join(", ") || "—"}</TableCell>
                  <TableCell className="max-w-[280px]">
                    {policy.condition ? describeCondition(policy.condition) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={policy.effect === "deny" ? "destructive" : "secondary"}>
                      {policy.effect}
                    </Badge>
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
              ))
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
