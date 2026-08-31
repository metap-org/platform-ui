// Frontend-only declarations for how a field displays/behaves *within a page* (List/Detail) —
// same shape of decision as `i18n/entityLabels.ts`'s label overrides, and deliberately the same
// pattern: NOT a backend/`EntityDefinition` change (no new field on the Rust struct, no
// `openapi.rs`/`generate:types` round trip). `GeneratedList`/`RecordDetail` previously had no
// declared source for this at all — each screen hardcoded its own fixed convention (List: label
// as a table column header; Detail: label stacked above the value via a guessed `field.kind ===
// "json"` -> full-width heuristic; every `reference` field rendered as plain, unclickable text
// despite already knowing its target entity+id). This file is that missing declaration point.
//
// A missing entity/field entry here just falls back to the previous hardcoded default — nothing
// requires an entry to render correctly, so this dict only needs filling in where the default
// isn't good enough for a specific field. Not self-service, same caveat as `entityLabelOverrides`:
// a real downstream consumer of `platform-ui` maintains its own copy for its own entities.

export type FieldLayoutHint = {
  /** `RecordDetail`'s 2-column grid: how many columns this field's value spans. Default: 2
   *  (full-width) for `"json"` fields, 1 otherwise — matches the pre-declaration heuristic, so
   *  declaring nothing changes nothing. */
  span?: 1 | 2;
  /** Whether the field's value is a clickable navigation target. Currently only meaningful for
   *  `"reference"` fields (links to the referenced record's own detail page via
   *  `navAdapter.toRecordDetail`) — default `true`, since a reference value that can't be
   *  followed was a gap, not a deliberate choice. Set `false` to opt a specific field out (e.g.
   *  the target is rarely useful to jump to, or the app wants that field read-only-looking). */
  interactive?: boolean;
};

export type EntityLayoutOverrides = {
  fields?: Record<string, FieldLayoutHint>;
};

export const entityLayoutOverrides: Record<string, EntityLayoutOverrides> = {};

/** `fieldKind` (optional — omit when the caller has no field context, e.g. resolving `interactive`
 *  alone) only feeds the default `span` — a declared `span` always wins over it. */
export function getFieldLayoutHint(
  entityName: string,
  fieldName: string,
  fieldKind?: string,
): Required<FieldLayoutHint> {
  const declared = entityLayoutOverrides[entityName]?.fields?.[fieldName];
  return {
    span: declared?.span ?? (fieldKind === "json" ? 2 : 1),
    interactive: declared?.interactive ?? true,
  };
}
