import type { Dispatch, SetStateAction } from "react";
import { Fragment, memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  IconButton,
  Input,
  MultiSelect,
  NumberInput,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TagsInput,
  Textarea,
  Toggle,
} from "@metap/ui";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { ApiErrorMessage } from "../api/ApiErrorMessage";
import {
  useLowCodeActions,
  useLowCodeEntities,
  useLowCodeVersions,
  type LowCodeVersionSummary,
} from "./adminApi";

// Every FieldKind `metap_metadata::FieldKind` declares except "id" — the id column is
// implicit/system-managed (`records.id`), never something an author picks for a new field.
const FIELD_KINDS = [
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "money",
  "enum",
  "reference",
  "json",
];

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton
      variant="ghost"
      size="sm"
      aria-label="Dismiss"
      onClick={onClick}
      icon={
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      }
    />
  );
}

type FieldRow = {
  name: string;
  label: string;
  kind: string;
  required: boolean;
  indexed: boolean;
  unique: boolean;
  searchable: boolean;
  // "substring" (default, ILIKE) or "fts" (Postgres full-text search) — only meaningful when
  // `searchable` is true. Mirrors `EntityField.search_mode`'s doc comment in
  // `crates/metap-metadata/src/entity.rs`.
  searchMode: string;
  sortable: boolean;
  // A real string[], not a comma-joined string — only meaningful when kind === "enum". A
  // comma-joined representation would silently corrupt any enum value that itself contains a
  // comma the next time it round-trips through save/load (split(",") can't tell "a value with
  // a comma" apart from two separate values); `TagsInput` above edits this array directly, no
  // join/split needed.
  enumValues: string[];
  refEntity: string; // only meaningful when kind === "reference"
  refDisplayField: string; // only meaningful when kind === "reference"
};

function emptyFieldRow(): FieldRow {
  return {
    name: "",
    label: "",
    kind: "string",
    required: false,
    indexed: false,
    unique: false,
    searchable: false,
    searchMode: "substring",
    sortable: false,
    enumValues: [],
    refEntity: "",
    refDisplayField: "",
  };
}

/** Wire shape is `metap_metadata::EntityField` (camelCase JSON) — matches
 * `crates/metap-metadata/src/entity.rs`. Optional flags are only emitted when true/non-empty,
 * mirroring that struct's `#[serde(skip_serializing_if = "Option::is_none")]` fields, so a
 * freshly-built field doesn't carry a pile of `false`/empty noise the server never asked for. */
function fieldRowToWire(row: FieldRow): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    name: row.name.trim(),
    label: row.label.trim(),
    kind: row.kind,
  };
  if (row.required) wire.required = true;
  if (row.indexed) wire.indexed = true;
  if (row.unique) wire.unique = true;
  if (row.searchable) {
    wire.searchable = true;
    if (row.searchMode === "fts") {
      wire.searchMode = "fts";
    }
  }
  if (row.sortable) wire.sortable = true;
  if (row.kind === "enum") {
    wire.enumValues = row.enumValues;
  }
  if (row.kind === "reference" && row.refEntity.trim().length > 0) {
    wire.refEntity = row.refEntity.trim();
    if (row.refDisplayField.trim().length > 0) {
      wire.refDisplayField = row.refDisplayField.trim();
    }
  }
  return wire;
}

function wireToFieldRow(field: unknown): FieldRow {
  const f = (field ?? {}) as Record<string, unknown>;
  return {
    name: typeof f.name === "string" ? f.name : "",
    label: typeof f.label === "string" ? f.label : "",
    kind: typeof f.kind === "string" ? f.kind : "string",
    required: f.required === true,
    indexed: f.indexed === true,
    unique: f.unique === true,
    searchable: f.searchable === true,
    searchMode: f.searchMode === "fts" ? "fts" : "substring",
    sortable: f.sortable === true,
    enumValues: Array.isArray(f.enumValues)
      ? f.enumValues.filter((v): v is string => typeof v === "string")
      : [],
    refEntity: typeof f.refEntity === "string" ? f.refEntity : "",
    refDisplayField: typeof f.refDisplayField === "string" ? f.refDisplayField : "",
  };
}

/** Memoized so editing/toggling one field row doesn't force every *other* row's `Select` to
 * re-render too — `onUpdate`/`onRemove` are stable (`useCallback` in `FieldBuilder`) and `row`
 * only gets a new reference when *this* row's own data actually changes, so `memo`'s shallow
 * prop comparison correctly skips unrelated rows. This is the fix for the multi-second lag
 * reported when toggling `required`/`searchable` with several fields in the table — every
 * checkbox click was re-rendering the entire table, including every other row's dropdown. */
const FieldRowEditor = memo(function FieldRowEditor({
  row,
  index,
  onUpdate,
  onRemove,
}: {
  row: FieldRow;
  index: number;
  onUpdate: (index: number, patch: Partial<FieldRow>) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <TableRow>
      <TableCell>
        <Input
          value={row.name}
          onChange={(e) => onUpdate(index, { name: e.currentTarget.value })}
        />
      </TableCell>
      <TableCell>
        <Input
          value={row.label}
          onChange={(e) => onUpdate(index, { label: e.currentTarget.value })}
        />
      </TableCell>
      <TableCell>
        <Select
          options={FIELD_KINDS.map((k) => ({ value: k, label: k }))}
          value={row.kind}
          onValueChange={(value) => onUpdate(index, { kind: value })}
        />
      </TableCell>
      <TableCell>
        <Checkbox
          checked={row.required}
          onCheckedChange={(checked) => onUpdate(index, { required: checked })}
        />
      </TableCell>
      <TableCell>
        <Checkbox
          checked={row.indexed}
          onCheckedChange={(checked) => onUpdate(index, { indexed: checked })}
        />
      </TableCell>
      <TableCell>
        <Checkbox
          checked={row.unique}
          onCheckedChange={(checked) => onUpdate(index, { unique: checked })}
        />
      </TableCell>
      <TableCell>
        <Checkbox
          checked={row.searchable}
          onCheckedChange={(checked) => onUpdate(index, { searchable: checked })}
        />
      </TableCell>
      <TableCell>
        <Select
          options={[
            { value: "substring", label: t("admin.lowcode.searchModeSubstring") },
            { value: "fts", label: t("admin.lowcode.searchModeFts") },
          ]}
          value={row.searchMode}
          disabled={!row.searchable}
          onValueChange={(value) => onUpdate(index, { searchMode: value })}
        />
      </TableCell>
      <TableCell>
        <Checkbox
          checked={row.sortable}
          onCheckedChange={(checked) => onUpdate(index, { sortable: checked })}
        />
      </TableCell>
      <TableCell>
        {row.kind === "enum" ? (
          <TagsInput
            placeholder={t("admin.lowcode.enumValuesPlaceholder")}
            value={row.enumValues}
            onChange={(value) => onUpdate(index, { enumValues: value })}
          />
        ) : row.kind === "reference" ? (
          <div className="flex flex-col gap-1">
            <Input
              placeholder={t("admin.lowcode.refEntityPlaceholder")}
              value={row.refEntity}
              onChange={(e) => onUpdate(index, { refEntity: e.currentTarget.value })}
            />
            <Input
              placeholder={t("admin.lowcode.refDisplayFieldPlaceholder")}
              value={row.refDisplayField}
              onChange={(e) => onUpdate(index, { refDisplayField: e.currentTarget.value })}
            />
          </div>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={t("common.delete")}
          onClick={() => onRemove(index)}
          className="text-destructive hover:text-destructive"
          icon={<span className="text-base leading-none">×</span>}
        />
      </TableCell>
    </TableRow>
  );
});

function FieldBuilder({
  fields,
  onChange,
}: {
  fields: FieldRow[];
  onChange: Dispatch<SetStateAction<FieldRow[]>>;
}) {
  const { t } = useTranslation();

  // Stable across renders (deps on `onChange`, which is `setFields` and never changes) — the
  // functional-update form means these never need `fields` itself as a dependency, so every
  // `FieldRowEditor` always receives the *same* callback reference. See that component's doc
  // comment for why this matters for perf.
  const updateRow = useCallback(
    (index: number, patch: Partial<FieldRow>) => {
      onChange((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    },
    [onChange],
  );

  const removeRow = useCallback(
    (index: number) => {
      onChange((prev) => prev.filter((_, i) => i !== index));
    },
    [onChange],
  );

  const addRow = useCallback(() => {
    onChange((prev) => [...prev, emptyFieldRow()]);
  }, [onChange]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{t("admin.lowcode.fields")}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("admin.lowcode.fieldName")}</TableHead>
            <TableHead>{t("admin.lowcode.fieldLabel")}</TableHead>
            <TableHead>{t("admin.lowcode.fieldKind")}</TableHead>
            <TableHead>{t("admin.lowcode.fieldRequired")}</TableHead>
            <TableHead>{t("admin.lowcode.fieldIndexed")}</TableHead>
            <TableHead>{t("admin.lowcode.fieldUnique")}</TableHead>
            <TableHead>{t("admin.lowcode.fieldSearchable")}</TableHead>
            <TableHead>{t("admin.lowcode.fieldSearchMode")}</TableHead>
            <TableHead>{t("admin.lowcode.fieldSortable")}</TableHead>
            <TableHead>{t("admin.lowcode.fieldExtra")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11}>{t("admin.lowcode.noFields")}</TableCell>
            </TableRow>
          ) : (
            fields.map((row, index) => (
              <FieldRowEditor
                key={index}
                row={row}
                index={index}
                onUpdate={updateRow}
                onRemove={removeRow}
              />
            ))
          )}
        </TableBody>
      </Table>
      <Button variant="outline" size="sm" onClick={addRow}>
        {t("admin.lowcode.addField")}
      </Button>
    </div>
  );
}

// Always resolvable regardless of declared fields — mirrors
// `crates/metap-metadata/src/compiler.rs`'s `IMPLICIT_SYSTEM_FIELDS`, which
// `compiler::validate` treats as known field names for `listViews`/`defaultSort` purposes.
const IMPLICIT_SYSTEM_FIELDS = ["createdAt", "updatedAt"];

type ListViewRow = {
  name: string;
  label: string;
  fields: string[];
  filters: string[];
  sortField: string; // "" = no default sort
  sortDesc: boolean;
  maxLimit: number;
};

function emptyListViewRow(): ListViewRow {
  return {
    name: "default",
    label: "",
    fields: [],
    filters: [],
    sortField: "",
    sortDesc: false,
    maxLimit: 50,
  };
}

/** Wire shape is `metap_metadata::EntityListView` — `defaultSort` is a single string, `-field`
 * for descending (see `crates/metap-query/src/query_planner.rs`'s sort parsing), not a
 * separate direction field — `sortField`/`sortDesc` only exist as two form inputs, combined
 * into one string here. */
function listViewRowToWire(row: ListViewRow): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    name: row.name.trim(),
    label: row.label.trim(),
    fields: row.fields,
    filters: row.filters,
    maxLimit: row.maxLimit,
  };
  if (row.sortField.trim().length > 0) {
    wire.defaultSort = row.sortDesc ? `-${row.sortField}` : row.sortField;
  }
  return wire;
}

function wireToListViewRow(view: unknown): ListViewRow {
  const v = (view ?? {}) as Record<string, unknown>;
  const defaultSort = typeof v.defaultSort === "string" ? v.defaultSort : "";
  const sortDesc = defaultSort.startsWith("-");
  return {
    name: typeof v.name === "string" ? v.name : "",
    label: typeof v.label === "string" ? v.label : "",
    fields: Array.isArray(v.fields)
      ? v.fields.filter((f): f is string => typeof f === "string")
      : [],
    filters: Array.isArray(v.filters)
      ? v.filters.filter((f): f is string => typeof f === "string")
      : [],
    sortField: sortDesc ? defaultSort.slice(1) : defaultSort,
    sortDesc,
    maxLimit: typeof v.maxLimit === "number" ? v.maxLimit : 50,
  };
}

/** Memoized for the same reason as `FieldRowEditor` — `fieldNames`/`sortOptions` only get a
 * new reference when the underlying field list actually changes (`useMemo` in the parent), so
 * an edit in one list-view card doesn't re-render every other card's `MultiSelect`. */
const ListViewRowEditor = memo(function ListViewRowEditor({
  row,
  index,
  fieldNames,
  sortOptions,
  onUpdate,
  onRemove,
}: {
  row: ListViewRow;
  index: number;
  fieldNames: string[];
  sortOptions: { value: string; label: string }[];
  onUpdate: (index: number, patch: Partial<ListViewRow>) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useTranslation();
  const fieldOptions = fieldNames.map((f) => ({ value: f, label: f }));

  return (
    <div className="flex flex-col gap-2 rounded border border-border p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label={t("admin.lowcode.listViewName")}
            value={row.name}
            onChange={(e) => onUpdate(index, { name: e.currentTarget.value })}
          />
        </div>
        <div className="flex-1">
          <Input
            label={t("admin.lowcode.listViewLabel")}
            value={row.label}
            onChange={(e) => onUpdate(index, { label: e.currentTarget.value })}
          />
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={t("common.delete")}
          onClick={() => onRemove(index)}
          className="text-destructive hover:text-destructive"
          icon={<span className="text-base leading-none">×</span>}
        />
      </div>
      <MultiSelect
        label={t("admin.lowcode.listViewFields")}
        options={fieldOptions}
        value={row.fields}
        onChange={(value) => onUpdate(index, { fields: value })}
      />
      <MultiSelect
        label={t("admin.lowcode.listViewFilters")}
        options={fieldOptions}
        value={row.filters}
        onChange={(value) => onUpdate(index, { filters: value })}
      />
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select
            label={t("admin.lowcode.listViewDefaultSort")}
            options={sortOptions}
            value={row.sortField}
            onValueChange={(value) => onUpdate(index, { sortField: value })}
          />
        </div>
        <Checkbox
          label={t("admin.lowcode.listViewDescending")}
          checked={row.sortDesc}
          disabled={row.sortField.trim().length === 0}
          onCheckedChange={(checked) => onUpdate(index, { sortDesc: checked })}
        />
        <NumberInput
          label={t("admin.lowcode.listViewMaxLimit")}
          value={row.maxLimit}
          onChange={(value) => onUpdate(index, { maxLimit: value })}
          min={1}
          max={200}
        />
      </div>
    </div>
  );
});

function ListViewBuilder({
  listViews,
  fieldNames,
  onChange,
}: {
  listViews: ListViewRow[];
  fieldNames: string[];
  onChange: Dispatch<SetStateAction<ListViewRow[]>>;
}) {
  const { t } = useTranslation();
  const sortOptions = useMemo(
    () => [
      { value: "", label: t("admin.lowcode.noDefaultSort") },
      ...fieldNames.map((f) => ({ value: f, label: f })),
    ],
    [fieldNames, t],
  );

  const updateRow = useCallback(
    (index: number, patch: Partial<ListViewRow>) => {
      onChange((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    },
    [onChange],
  );

  const removeRow = useCallback(
    (index: number) => {
      onChange((prev) => prev.filter((_, i) => i !== index));
    },
    [onChange],
  );

  const addRow = useCallback(() => {
    onChange((prev) => [...prev, emptyListViewRow()]);
  }, [onChange]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{t("admin.lowcode.listViews")}</p>
      {listViews.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.lowcode.noListViews")}</p>
      ) : null}
      {listViews.map((row, index) => (
        <ListViewRowEditor
          key={index}
          row={row}
          index={index}
          fieldNames={fieldNames}
          sortOptions={sortOptions}
          onUpdate={updateRow}
          onRemove={removeRow}
        />
      ))}
      <Button variant="outline" size="sm" onClick={addRow}>
        {t("admin.lowcode.addListView")}
      </Button>
    </div>
  );
}

type TransitionRow = {
  action: string;
  from: string;
  to: string;
  label: string;
  // Raw JSON text for a `PolicyCondition`, same editing pattern as `PoliciesAdminPage`'s
  // `conditionText` — `guard` is a recursive untagged enum (Attribute/All/Any), not something
  // this page hand-models a structured editor for. "" = no guard (unconditional transition).
  guardText: string;
};

function emptyTransitionRow(): TransitionRow {
  return { action: "", from: "", to: "", label: "", guardText: "" };
}

function wireToTransitionRow(transition: unknown): TransitionRow {
  const t = (transition ?? {}) as Record<string, unknown>;
  return {
    action: typeof t.action === "string" ? t.action : "",
    from: typeof t.from === "string" ? t.from : "",
    to: typeof t.to === "string" ? t.to : "",
    label: typeof t.label === "string" ? t.label : "",
    guardText: t.guard !== undefined ? JSON.stringify(t.guard) : "",
  };
}

/** Throws on invalid guard JSON — the caller (`workflowRowToWire`) is expected to catch this
 * and turn it into a form error, same as `PoliciesAdminPage.handleCreate`'s `JSON.parse`. */
function transitionRowToWire(row: TransitionRow): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    action: row.action.trim(),
    from: row.from.trim(),
    to: row.to.trim(),
    label: row.label.trim(),
  };
  if (row.guardText.trim().length > 0) {
    wire.guard = JSON.parse(row.guardText);
  }
  return wire;
}

type WorkflowRow = {
  // "" = no workflow configured for this draft at all — `EntityWorkflow` is optional
  // (`Option<EntityWorkflow>`) on the wire, and this page represents "unset" by an empty
  // state field rather than a separate boolean toggle, same spirit as `ListViewRow.sortField`
  // ("" = no default sort).
  stateField: string;
  initialState: string;
  terminalStates: string[];
  transitions: TransitionRow[];
};

function emptyWorkflowRow(): WorkflowRow {
  return { stateField: "", initialState: "", terminalStates: [], transitions: [] };
}

function wireToWorkflowRow(workflow: unknown): WorkflowRow {
  if (workflow === null || typeof workflow !== "object") {
    return emptyWorkflowRow();
  }
  const w = workflow as Record<string, unknown>;
  return {
    stateField: typeof w.stateField === "string" ? w.stateField : "",
    initialState: typeof w.initialState === "string" ? w.initialState : "",
    terminalStates: Array.isArray(w.terminalStates)
      ? w.terminalStates.filter((s): s is string => typeof s === "string")
      : [],
    transitions: Array.isArray(w.transitions) ? w.transitions.map(wireToTransitionRow) : [],
  };
}

/** Returns `undefined` (not an empty object) when `stateField` is blank, so
 * `JSON.stringify({ ...body, workflow })` omits the key entirely — matches
 * `LowCodeEntityDefinition::workflow`'s `#[serde(default, skip_serializing_if =
 * "Option::is_none")]` on the Rust side, an absent key rather than `null`. Throws on the
 * first invalid guard JSON among the transitions — the caller surfaces that as a form error. */
function workflowRowToWire(row: WorkflowRow): Record<string, unknown> | undefined {
  if (row.stateField.trim().length === 0) {
    return undefined;
  }
  return {
    stateField: row.stateField.trim(),
    initialState: row.initialState.trim(),
    terminalStates: row.terminalStates,
    transitions: row.transitions.map(transitionRowToWire),
  };
}

/** Memoized for the same reason as `FieldRowEditor`/`ListViewRowEditor` — a keystroke in one
 * transition's guard textarea shouldn't re-render every other transition's `Select`s. */
const TransitionRowEditor = memo(function TransitionRowEditor({
  row,
  index,
  stateOptions,
  onUpdate,
  onRemove,
}: {
  row: TransitionRow;
  index: number;
  stateOptions: string[];
  onUpdate: (index: number, patch: Partial<TransitionRow>) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2 rounded border border-border p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label={t("admin.lowcode.workflow.transitionAction")}
            value={row.action}
            onChange={(e) => onUpdate(index, { action: e.currentTarget.value })}
          />
        </div>
        <div className="flex-1">
          <Input
            label={t("admin.lowcode.workflow.transitionLabel")}
            value={row.label}
            onChange={(e) => onUpdate(index, { label: e.currentTarget.value })}
          />
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={t("common.delete")}
          onClick={() => onRemove(index)}
          className="text-destructive hover:text-destructive"
          icon={<span className="text-base leading-none">×</span>}
        />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label={t("admin.lowcode.workflow.transitionFrom")}
            helperText={t("admin.lowcode.workflow.transitionFromDescription")}
            list={`transition-states-${index}`}
            value={row.from}
            onChange={(e) => onUpdate(index, { from: e.currentTarget.value })}
          />
        </div>
        <div className="flex-1">
          <Input
            label={t("admin.lowcode.workflow.transitionTo")}
            list={`transition-states-${index}`}
            value={row.to}
            onChange={(e) => onUpdate(index, { to: e.currentTarget.value })}
          />
        </div>
      </div>
      <datalist id={`transition-states-${index}`}>
        {stateOptions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <Textarea
        label={t("admin.lowcode.workflow.transitionGuard")}
        helperText={t("admin.lowcode.workflow.transitionGuardDescription")}
        value={row.guardText}
        onChange={(e) => onUpdate(index, { guardText: e.currentTarget.value })}
        rows={1}
      />
    </div>
  );
});

function WorkflowBuilder({
  workflow,
  fieldNames,
  onChange,
}: {
  workflow: WorkflowRow;
  fieldNames: string[];
  onChange: Dispatch<SetStateAction<WorkflowRow>>;
}) {
  const { t } = useTranslation();

  const updateTransition = useCallback(
    (index: number, patch: Partial<TransitionRow>) => {
      onChange((prev) => ({
        ...prev,
        transitions: prev.transitions.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      }));
    },
    [onChange],
  );

  const removeTransition = useCallback(
    (index: number) => {
      onChange((prev) => ({
        ...prev,
        transitions: prev.transitions.filter((_, i) => i !== index),
      }));
    },
    [onChange],
  );

  const addTransition = useCallback(() => {
    onChange((prev) => ({ ...prev, transitions: [...prev.transitions, emptyTransitionRow()] }));
  }, [onChange]);

  if (workflow.stateField.trim().length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">{t("admin.lowcode.workflow.title")}</p>
        <p className="text-sm text-muted-foreground">{t("admin.lowcode.workflow.noWorkflow")}</p>
        <Button
          variant="outline"
          size="sm"
          disabled={fieldNames.length === 0}
          onClick={() => onChange({ ...emptyWorkflowRow(), stateField: fieldNames[0] ?? "" })}
          className="self-start"
        >
          {t("admin.lowcode.workflow.addWorkflow")}
        </Button>
      </div>
    );
  }

  const stateOptions = [
    ...new Set([
      ...(workflow.initialState.trim().length > 0 ? [workflow.initialState.trim()] : []),
      ...workflow.terminalStates,
      ...workflow.transitions.flatMap((tr) => [tr.from.trim(), tr.to.trim()].filter(Boolean)),
    ]),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{t("admin.lowcode.workflow.title")}</p>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => onChange(emptyWorkflowRow())}
        >
          {t("admin.lowcode.workflow.removeWorkflow")}
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select
            label={t("admin.lowcode.workflow.stateField")}
            options={fieldNames.map((f) => ({ value: f, label: f }))}
            value={workflow.stateField}
            onValueChange={(value) =>
              onChange((prev) => ({ ...prev, stateField: value || prev.stateField }))
            }
          />
        </div>
        <div className="flex-1">
          <Input
            label={t("admin.lowcode.workflow.initialState")}
            value={workflow.initialState}
            onChange={(e) => onChange((prev) => ({ ...prev, initialState: e.currentTarget.value }))}
          />
        </div>
      </div>
      <TagsInput
        label={t("admin.lowcode.workflow.terminalStates")}
        placeholder={t("admin.lowcode.workflow.terminalStatesPlaceholder")}
        value={workflow.terminalStates}
        onChange={(value) => onChange((prev) => ({ ...prev, terminalStates: value }))}
      />
      <p className="mt-2 text-sm font-medium text-foreground">
        {t("admin.lowcode.workflow.transitions")}
      </p>
      {workflow.transitions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.lowcode.workflow.noTransitions")}</p>
      ) : null}
      {workflow.transitions.map((row, index) => (
        <TransitionRowEditor
          key={index}
          row={row}
          index={index}
          stateOptions={stateOptions}
          onUpdate={updateTransition}
          onRemove={removeTransition}
        />
      ))}
      <Button variant="outline" size="sm" onClick={addTransition} className="self-start">
        {t("admin.lowcode.workflow.addTransition")}
      </Button>
    </div>
  );
}

function LowCodeVersionHistory({
  name,
  onRollback,
}: {
  name: string;
  onRollback: (versionNumber: number) => void;
}) {
  const { t } = useTranslation();
  const { data: versions, isLoading, error } = useLowCodeVersions(name);

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
          <TableHead>{t("admin.lowcode.versions.version")}</TableHead>
          <TableHead>{t("admin.lowcode.versions.publishedAt")}</TableHead>
          <TableHead>{t("admin.lowcode.versions.restoredFrom")}</TableHead>
          <TableHead>{t("common.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(versions ?? []).length === 0 ? (
          <TableRow>
            <TableCell colSpan={4}>{t("common.noRecords")}</TableCell>
          </TableRow>
        ) : (
          (versions as LowCodeVersionSummary[]).map((v) => (
            <TableRow key={v.versionNumber}>
              <TableCell>{v.versionNumber}</TableCell>
              <TableCell>{v.publishedAt}</TableCell>
              <TableCell>{v.restoredFromVersion ?? "—"}</TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" onClick={() => onRollback(v.versionNumber)}>
                  {t("admin.lowcode.versions.rollback")}
                </Button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export function LowCodeEntitiesAdminPage() {
  const { t } = useTranslation();
  const { data: entities, isLoading, error, refetch } = useLowCodeEntities();
  const { getDraft, saveDraft, publish, previewPublish, rollback, setEnabled } =
    useLowCodeActions();

  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [listViews, setListViews] = useState<ListViewRow[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowRow>(emptyWorkflowRow());
  const [formError, setFormError] = useState<string | null>(null);
  const [cleanupNote, setCleanupNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  // Bumped on every handleLoad call, checked when its getDraft() resolves — clicking Edit on
  // two different entities in quick succession fires two overlapping requests, and without
  // this a slower, stale response could land *after* a faster, newer one and silently
  // overwrite the form with the wrong entity's data.
  const loadRequestId = useRef(0);

  function resetForm() {
    setName("");
    setLabel("");
    setFields([]);
    setListViews([]);
    setWorkflow(emptyWorkflowRow());
    setFormError(null);
  }

  async function handleLoad(targetName: string) {
    if (targetName.trim().length === 0) {
      return;
    }
    const requestId = ++loadRequestId.current;
    setFormError(null);
    try {
      const draft = await getDraft(targetName.trim());
      if (requestId !== loadRequestId.current) {
        return; // a newer handleLoad call has since started — this response is stale
      }
      if (draft) {
        setLabel(draft.label);
        setFields(draft.fields.map(wireToFieldRow));
        setListViews(draft.listViews.map(wireToListViewRow));
        setWorkflow(wireToWorkflowRow(draft.workflow));
      } else {
        setLabel("");
        setFields([]);
        setListViews([]);
        setWorkflow(emptyWorkflowRow());
      }
    } catch (err) {
      if (requestId !== loadRequestId.current) {
        return;
      }
      setFormError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  async function handleSaveDraft() {
    setFormError(null);
    setCleanupNote(null);

    if (fields.some((f) => f.name.trim().length === 0 || f.label.trim().length === 0)) {
      setFormError(t("admin.lowcode.fieldNameLabelRequired"));
      return;
    }
    if (listViews.some((v) => v.name.trim().length === 0 || v.label.trim().length === 0)) {
      setFormError(t("admin.lowcode.listViewNameLabelRequired"));
      return;
    }
    if (
      workflow.stateField.trim().length > 0 &&
      (workflow.initialState.trim().length === 0 ||
        workflow.transitions.some(
          (tr) =>
            tr.action.trim().length === 0 ||
            tr.from.trim().length === 0 ||
            tr.to.trim().length === 0 ||
            tr.label.trim().length === 0,
        ))
    ) {
      setFormError(t("admin.lowcode.workflow.transitionFieldsRequired"));
      return;
    }
    let workflowWire: Record<string, unknown> | undefined;
    try {
      workflowWire = workflowRowToWire(workflow);
    } catch {
      setFormError(t("admin.lowcode.workflow.invalidGuardJson"));
      return;
    }

    // Renaming a field (or removing it) can leave a list view's fields/filters/sortField
    // still pointing at the old name — `fieldNames` only tracks *current* field names, it
    // doesn't get reconciled into `listViews` live. Sanitize right before save so the
    // payload never references a field that no longer exists (the server would otherwise
    // silently persist a broken list view), and update the form + tell the operator so the
    // cleanup isn't invisible.
    const validFieldNames = new Set(fieldNames);
    let danglingReferencesRemoved = false;
    const sanitizedListViews = listViews.map((v) => {
      const cleanedFields = v.fields.filter((f) => validFieldNames.has(f));
      const cleanedFilters = v.filters.filter((f) => validFieldNames.has(f));
      const sortStillValid = v.sortField.trim().length === 0 || validFieldNames.has(v.sortField);
      if (
        cleanedFields.length !== v.fields.length ||
        cleanedFilters.length !== v.filters.length ||
        !sortStillValid
      ) {
        danglingReferencesRemoved = true;
      }
      return {
        ...v,
        fields: cleanedFields,
        filters: cleanedFilters,
        sortField: sortStillValid ? v.sortField : "",
        sortDesc: sortStillValid ? v.sortDesc : false,
      };
    });
    if (danglingReferencesRemoved) {
      setListViews(sanitizedListViews);
      setCleanupNote(t("admin.lowcode.listViewCleanupNote"));
    }

    setSaving(true);
    try {
      await saveDraft(name.trim(), {
        label,
        fields: fields.map(fieldRowToWire),
        listViews: sanitizedListViews.map(listViewRowToWire),
        workflow: workflowWire,
      });
      await refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    } finally {
      setSaving(false);
    }
  }

  // `useMemo`'d so this array only gets a new reference when `fields` itself changes —
  // otherwise every keystroke/checkbox toggle anywhere on the page would hand `ListViewBuilder`
  // a brand-new `fieldNames` array, cascading into every `MultiSelect`'s `options` prop and
  // defeating `ListViewRowEditor`'s memoization.
  const fieldNames = useMemo(
    () => [...fields.map((f) => f.name.trim()).filter(Boolean), ...IMPLICIT_SYSTEM_FIELDS],
    [fields],
  );

  async function handlePublish(entityName: string) {
    setRowError(null);
    setPreviewNote(null);
    try {
      await publish(entityName);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  // Read-only — validates the draft the same way Publish would, without writing a version row.
  // Shown as its own info note (`previewNote`), not `rowError`, so a *successful* preview
  // doesn't read as an error and doesn't get cleared by other rows' error handling.
  async function handlePreview(entityName: string) {
    setRowError(null);
    setPreviewNote(null);
    try {
      const result = await previewPublish(entityName);
      setPreviewNote(
        t("admin.lowcode.previewValid", { entity: entityName, version: result.wouldBeVersion }),
      );
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  async function handleRollback(entityName: string, versionNumber: number) {
    if (!window.confirm(t("admin.lowcode.versions.rollbackConfirm", { version: versionNumber }))) {
      return;
    }
    setRowError(null);
    try {
      await rollback(entityName, versionNumber);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  const entityRows = [...(entities?.entities ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  // Entity name is the storage key for both `low_code_entity_drafts` and
  // `low_code_entity_versions` — there's no rename operation, changing it just creates a
  // second, unrelated entity. Lock it once it matches something that already has a draft or a
  // published version, so an operator editing an existing entity can't accidentally fork it
  // by typing over the name field; "New" (resetForm) is the only way back to an editable name.
  const nameIsLocked = entityRows.some((e) => e.name === name.trim());

  async function handleToggleEnabled(entityName: string, enabled: boolean) {
    setRowError(null);
    try {
      await setEnabled(entityName, enabled);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : t("common.somethingWentWrong"));
    }
  }

  return (
    <div className="py-8">
      <h2 className="mb-4 text-xl font-semibold text-foreground">{t("admin.lowcode.title")}</h2>

      <div className="mb-8 flex max-w-[860px] flex-col gap-3">
        <h4 className="text-base font-medium text-foreground">{t("admin.lowcode.editTitle")}</h4>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        {cleanupNote ? (
          <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            {cleanupNote}
          </Alert>
        ) : null}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label={t("admin.lowcode.entityName")}
              helperText={
                nameIsLocked
                  ? t("admin.lowcode.entityNameLockedDescription")
                  : t("admin.lowcode.entityNameDescription")
              }
              value={name}
              disabled={nameIsLocked}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => void handleLoad(name)}
            disabled={name.trim().length === 0}
          >
            {t("admin.lowcode.load")}
          </Button>
        </div>
        <Input
          label={t("admin.lowcode.label")}
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
        <FieldBuilder fields={fields} onChange={setFields} />
        <ListViewBuilder listViews={listViews} fieldNames={fieldNames} onChange={setListViews} />
        <WorkflowBuilder workflow={workflow} fieldNames={fieldNames} onChange={setWorkflow} />
        <div className="flex items-center gap-2">
          <Button
            onClick={() => void handleSaveDraft()}
            disabled={saving || name.trim().length === 0 || label.trim().length === 0}
          >
            {saving ? <Spinner size="sm" className="mr-2" /> : null}
            {t("admin.lowcode.saveDraft")}
          </Button>
          <Button variant="ghost" onClick={resetForm}>
            {t("common.new")}
          </Button>
        </div>
      </div>

      {rowError ? (
        <Alert variant="destructive" className="mb-4 flex items-center justify-between gap-2">
          <span>{rowError}</span>
          <DismissButton onClick={() => setRowError(null)} />
        </Alert>
      ) : null}
      {previewNote ? (
        <Alert className="mb-4 flex items-center justify-between gap-2 border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-400">
          <span>{previewNote}</span>
          <DismissButton onClick={() => setPreviewNote(null)} />
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
              <TableHead>{t("admin.lowcode.entityName")}</TableHead>
              <TableHead>{t("admin.lowcode.status")}</TableHead>
              <TableHead>{t("admin.lowcode.enabled")}</TableHead>
              <TableHead>{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entityRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>{t("common.noRecords")}</TableCell>
              </TableRow>
            ) : (
              entityRows.map((entityRow) => {
                const entityName = entityRow.name;
                return (
                  <Fragment key={entityName}>
                    <TableRow>
                      <TableCell>{entityName}</TableCell>
                      <TableCell>
                        <Badge variant={entityRow.published ? "success" : "secondary"}>
                          {entityRow.published
                            ? t("admin.lowcode.published")
                            : t("admin.lowcode.draftOnly")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Toggle
                          checked={entityRow.enabled}
                          disabled={!entityRow.published}
                          onCheckedChange={(checked) =>
                            void handleToggleEnabled(entityName, checked)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setName(entityName);
                              void handleLoad(entityName);
                            }}
                          >
                            {t("common.edit")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handlePreview(entityName)}
                          >
                            {t("admin.lowcode.preview")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handlePublish(entityName)}
                          >
                            {t("admin.lowcode.publish")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedName((current) =>
                                current === entityName ? null : entityName,
                              )
                            }
                          >
                            {expandedName === entityName
                              ? t("workflow.hide")
                              : t("admin.lowcode.versions.title")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedName === entityName ? (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <LowCodeVersionHistory
                            name={entityName}
                            onRollback={(versionNumber) =>
                              void handleRollback(entityName, versionNumber)
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
