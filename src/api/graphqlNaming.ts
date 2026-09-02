/**
 * Entity name (`"crm.customers"`) -> GraphQL identifier — **must stay byte-for-byte identical**
 * to `metap/crates/metap-graphql/src/naming.rs`'s `list_field_name` (split `.`/`_`/`-`, PascalCase
 * each part, join, lowercase the first char, append `"List"`). If one side changes, the other
 * has to change with it — there's no shared source of truth across the Rust/TS boundary for this
 * mapping, same as every other wire-shape convention this repo hand-mirrors instead of generating
 * (see `metadata/types.ts`'s own doc comment on why `EntitySummary`'s *shape* is generated but
 * conventions like this one aren't).
 */
export function listFieldName(entityName: string): string {
  const pascal = entityName
    .split(/[._-]/)
    .map((part) => (part.length === 0 ? "" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
  const camel = pascal.length === 0 ? pascal : pascal.charAt(0).toLowerCase() + pascal.slice(1);
  return `${camel}List`;
}
