import { useMemo, useState } from "react";
import { Autocomplete } from "@metap/ui";
import { useApiQuery } from "../api/useApiQuery";
import type { EntityField } from "../metadata/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type RecordDto = {
  id: string;
  code: string | null;
  status: string | null;
  version: number;
  data: Record<string, unknown>;
};

function labelFor(record: RecordDto, refDisplayField: string | undefined): string {
  const raw = refDisplayField ? record.data[refDisplayField] : undefined;
  return typeof raw === "string" ? raw : record.id;
}

export function ReferenceFieldInput({
  field,
  value,
  onChange,
  error,
  disabled,
}: {
  field: EntityField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  disabled?: boolean;
}) {
  const label = field.label + (field.required ? " *" : "");
  const helperText = disabled ? "You can't edit this field" : undefined;
  const refEntity = field.refEntity;
  const currentValue = typeof value === "string" ? value : undefined;

  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const { data: currentRecord } = useApiQuery<{ data: RecordDto }, RecordDto>(
    ["record", refEntity, currentValue],
    `/api/${refEntity}/${currentValue}`,
    (response) => response.data,
    Boolean(refEntity && currentValue),
  );

  // No search text yet -> just the first page, unfiltered, so a small reference set (a handful
  // of projects, say) shows options immediately on open instead of looking empty/broken until
  // the caller types something (found live: the combobox for `jira.sprints.project` looked like
  // it wasn't loading anything at all). `?field=` (empty) would now mean "IS NULL" since
  // `metap-query`'s empty-filter-value fix, so this branch omits the param entirely rather than
  // sending it empty.
  const searchPath =
    debouncedSearch.length > 0
      ? `/api/${refEntity}?${field.refDisplayField}=${encodeURIComponent(debouncedSearch)}&limit=10`
      : `/api/${refEntity}?limit=10`;
  const { data: searchResults } = useApiQuery<{ data: RecordDto[] }, RecordDto[]>(
    ["reference-search", refEntity, field.refDisplayField, debouncedSearch],
    searchPath,
    (response) => response.data,
    Boolean(refEntity && field.refDisplayField),
  );

  // Small (~11-element) set, so this was never a real cost — memoized only for consistency with
  // the memoization style used elsewhere (`platform-ui/docs/audits/01-frontend-performance-audit.md`
  // finding #5).
  const options = useMemo(() => {
    const map = new Map<string, string>();
    if (currentRecord) {
      map.set(currentRecord.id, labelFor(currentRecord, field.refDisplayField));
    }
    for (const record of searchResults ?? []) {
      map.set(record.id, labelFor(record, field.refDisplayField));
    }
    return [...map.entries()].map(([optionValue, optionLabel]) => ({
      value: optionValue,
      label: optionLabel,
    }));
  }, [currentRecord, searchResults, field.refDisplayField]);

  return (
    <Autocomplete
      label={label}
      helperText={helperText}
      options={options}
      value={currentValue}
      inputValue={searchInput}
      onInputChange={setSearchInput}
      onValueChange={(selected) => onChange(selected ?? undefined)}
      error={error}
      disabled={disabled}
    />
  );
}
