import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Spinner, toast } from "@metap/ui";
import { useTranslation } from "react-i18next";
import {
  createGraphQLRecord,
  updateGraphQLRecord,
  useGraphQLRecord,
  useInvalidateGraphQLRecords,
  type GraphQLRecord,
} from "../api/graphqlRecords";
import { GraphQLError } from "../api/graphqlClient";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { useEntity } from "../metadata/useEntity";
import { FieldInput } from "../field/FieldInput";
import { useEntityLabels } from "../i18n/useEntityLabels";

type RecordDto = GraphQLRecord;

/** Only the keys where `current` differs from `baseline` — powers both dirty-state (any diff at
 *  all means dirty) and the real partial-update payload (`docs/features/
 *  19-generated-form-mutation-ergonomics.md`). `JSON.stringify` comparison is a pragmatic choice
 *  for metadata-driven field values (primitives, arrays, small JSON blobs) — not a deep-equal
 *  library, but sufficient here and avoids a new dependency for this. Backend's `update()`
 *  already merges `raw_data` into the existing row (`crates/metap-crud/src/crud_service/
 *  update.rs`) rather than replacing it wholesale, so sending only the diff was always a safe
 *  partial update, not something this change had to earn on the server side too. */
function diffFromBaseline(
  current: Record<string, unknown>,
  baseline: Record<string, unknown>,
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (JSON.stringify(value) !== JSON.stringify(baseline[key])) {
      diff[key] = value;
    }
  }
  return diff;
}

export function GeneratedForm({
  entityName,
  recordId,
  onSaved,
}: {
  entityName: string;
  recordId?: string;
  onSaved: (record: RecordDto) => void;
}) {
  const { t } = useTranslation();
  const { entityLabel, fieldLabel } = useEntityLabels(entityName);
  const invalidateRecords = useInvalidateGraphQLRecords();
  const { data: entity, isLoading: entityLoading, error: entityError } = useEntity(entityName);
  const {
    data: existing,
    isLoading: existingLoading,
    error: existingError,
  } = useGraphQLRecord(entityName, recordId);

  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (existing) {
      setFormData(existing.data);
    }
  }, [existing]);

  // "" for create (nothing to diff against — every filled field reads as dirty, matching the old
  // unconditional-submit behavior via `saveDisabled` below never applying in create mode anyway).
  const baseline = existing?.data ?? {};
  const isDirty = Object.keys(diffFromBaseline(formData, baseline)).length > 0;

  // Covers refresh/close-tab — the in-app SPA-navigation guard (`useBlocker`) is deliberately
  // NOT wired here: it requires a data router (`createBrowserRouter`), which no
  // `@metap/platform-ui` consumer app uses today (all on plain `<BrowserRouter>`) — calling it
  // would throw at runtime instead of degrading, so this stays scoped to what every consumer
  // actually supports (`docs/features/19-generated-form-mutation-ergonomics.md`'s risk note,
  // confirmed live rather than assumed).
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const writableFields =
    recordId && existing ? new Set(existing.capabilities.writableFields) : null;

  // No optimistic update on the GraphQL path (there was one for the update mutation over REST) —
  // `useGraphQLRecord`'s cache holds the *raw* GraphQL response shape (`useGraphQLQuery`'s
  // `select` reshapes on read, not on write), so hand-editing it optimistically would mean
  // re-flattening `formData` back into that raw per-field shape instead of the friendly
  // `GraphQLRecord` one — fragile for a UX nicety. `invalidateRecords()` after success (below)
  // refetches instead, same "a moment of staleness beats fragile cache surgery" tradeoff
  // `useInvalidateGraphQLRecords`'s own doc comment already accepts for `GeneratedList`.
  const createMutation = useMutation({
    mutationFn: (vars: { data: Record<string, unknown> }) =>
      createGraphQLRecord(entityName, vars.data),
  });
  const updateMutation = useMutation({
    mutationFn: (vars: { version: number; data: Record<string, unknown> }) =>
      updateGraphQLRecord(entityName, recordId!, vars.version, vars.data),
  });

  if (entityLoading || (recordId && existingLoading)) {
    return <Spinner />;
  }
  if (entityError) {
    return <ApiErrorMessage error={entityError} />;
  }
  if (recordId && existingError) {
    return <ApiErrorMessage error={existingError} />;
  }
  if (!entity) {
    return <div>{t("common.entityNotFound")}</div>;
  }

  function setFieldValue(fieldName: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [fieldName]: value }));
  }

  async function handleSubmit() {
    setFormError(null);
    setFieldErrors({});

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(formData)) {
      const field = entity!.fields.find((f) => f.name === key);
      if (field?.kind === "json" && typeof value === "string") {
        try {
          payload[key] = value.trim() === "" ? undefined : JSON.parse(value);
        } catch {
          setFieldErrors({ [key]: [t("common.invalidJson")] });
          return;
        }
      } else {
        payload[key] = value;
      }
    }

    try {
      // Edit mode: only the fields that actually differ from what was loaded — the real partial
      // update (`docs/features/19-generated-form-mutation-ergonomics.md`). Create mode keeps
      // sending the full payload, unchanged (there is no baseline to diff against).
      const response = recordId
        ? await updateMutation.mutateAsync({
            version: existing!.version,
            data: diffFromBaseline(payload, baseline),
          })
        : await createMutation.mutateAsync({ data: payload });
      // Both flows were silent on success (only errors surfaced, via `formError`/`fieldErrors`
      // below) — this is the one piece of positive feedback that was missing, not a duplicate of
      // the inline error `Alert`.
      toast(
        t(recordId ? "form.updateSuccess" : "form.createSuccess", {
          label: entityLabel(entity!.label),
        }),
      );
      invalidateRecords();
      onSaved(response.data);
    } catch (error) {
      if (error instanceof GraphQLError) {
        setFieldErrors(error.fieldErrors ?? {});
        if (!error.fieldErrors) {
          setFormError(error.message);
        }
      } else {
        setFormError(t("common.somethingWentWrong"));
      }
    }
  }

  const submitting = createMutation.isPending || updateMutation.isPending;
  // Only edit mode gates Save on dirty — create mode keeps its original "always submittable"
  // behavior (an empty create form still surfaces field validation on submit, not a disabled
  // button with no explanation).
  const saveDisabled = Boolean(recordId) && !isDirty;

  return (
    <div className="mx-auto max-w-sm py-8">
      <h2 className="mb-4 text-xl font-semibold text-foreground">
        {recordId
          ? t("form.editTitle", { label: entityLabel(entity.label) })
          : t("form.newTitle", { label: entityLabel(entity.label) })}
      </h2>
      {recordId && isDirty ? (
        <p className="mb-2 text-sm text-muted-foreground">{t("form.unsavedChanges")}</p>
      ) : null}
      {formError ? (
        <Alert variant="destructive" className="mb-4">
          {formError}
        </Alert>
      ) : null}
      <div className="flex flex-col gap-4">
        {entity.fields
          .filter((field) => field.kind !== "id")
          .map((field) => (
            <FieldInput
              key={field.name}
              field={field}
              label={fieldLabel(field.name, field.label)}
              value={formData[field.name]}
              onChange={(value) => setFieldValue(field.name, value)}
              error={fieldErrors[field.name]?.join(", ")}
              disabled={writableFields ? !writableFields.has(field.name) : false}
            />
          ))}
        <Button onClick={() => void handleSubmit()} loading={submitting} disabled={saveDisabled}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
