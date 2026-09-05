import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Spinner, toast } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useApiQuery } from "../api/useApiQuery";
import { useApiMutation } from "../api/useApiMutation";
import { ApiError } from "../api/client";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import { useEntity } from "../metadata/useEntity";
import { FieldInput } from "../field/FieldInput";
import { useEntityLabels } from "../i18n/useEntityLabels";
import type { RecordCapabilities } from "../detail/recordCapabilities";

type RecordDto = {
  id: string;
  version: number;
  data: Record<string, unknown>;
  capabilities: RecordCapabilities;
};

type RecordQueryData = { data: RecordDto };

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
  const queryClient = useQueryClient();
  const { data: entity, isLoading: entityLoading, error: entityError } = useEntity(entityName);
  const recordQueryKey = ["record", entityName, recordId];
  const {
    data: existing,
    isLoading: existingLoading,
    error: existingError,
  } = useApiQuery<RecordQueryData, RecordDto>(
    recordQueryKey,
    `/api/${entityName}/${recordId}`,
    (response) => response.data,
    Boolean(recordId),
  );

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

  const createMutation = useApiMutation<{ data: RecordDto }, { data: Record<string, unknown> }>(
    "POST",
    `/api/${entityName}`,
  );
  const updateMutation = useApiMutation<
    { data: RecordDto },
    { version: number; data: Record<string, unknown> },
    { previous: RecordQueryData | undefined }
  >("PATCH", `/api/${entityName}/${recordId}`, {
    // Optimistic — UI reflects the patch immediately, rolls back on failure. Update only (not
    // create/delete): scoped out in the feature brief, tempId/data-loss tradeoffs differ enough
    // to need their own pass if ever done.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: recordQueryKey });
      const previous = queryClient.getQueryData<RecordQueryData>(recordQueryKey);
      if (previous) {
        queryClient.setQueryData<RecordQueryData>(recordQueryKey, {
          data: { ...previous.data, data: { ...previous.data.data, ...vars.data } },
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(recordQueryKey, context.previous);
      }
    },
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
      onSaved(response.data);
    } catch (error) {
      if (error instanceof ApiError) {
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
