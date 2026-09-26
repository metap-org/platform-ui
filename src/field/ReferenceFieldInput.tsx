import { useMemo, useState } from "react";
import { Autocomplete } from "@metap/ui";
import { useGraphQLRecord, useGraphQLRecords, type GraphQLRecord } from "../api/graphqlRecords";
import type { EntityField } from "../metadata/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

function labelFor(record: GraphQLRecord, refDisplayField: string | undefined): string {
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

  // `/api/${refEntity}/*` (REST) doesn't exist since Phase 90 removed REST entity CRUD — found
  // live 2026-09-26, this component was never migrated in Phase 93.
  const { data: currentRecord } = useGraphQLRecord(
    refEntity ?? "",
    refEntity ? currentValue : undefined,
  );

  // No search text yet -> just the first page, unfiltered, so a small reference set (a handful
  // of projects, say) shows options immediately on open instead of looking empty/broken until
  // the caller types something (found live: the combobox for `jira.sprints.project` looked like
  // it wasn't loading anything at all). An empty filter value would now mean "IS NULL" since
  // `metap-query`'s empty-filter-value fix, so this branch omits the filter entirely rather than
  // sending it empty.
  const searchFilters =
    debouncedSearch.length > 0 && field.refDisplayField
      ? { [field.refDisplayField]: debouncedSearch }
      : {};
  const { data: searchResults } = useGraphQLRecords(
    refEntity ?? "",
    searchFilters,
    10,
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
