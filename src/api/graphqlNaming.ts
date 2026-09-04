/**
 * Entity name (`"crm.customers"`) -> GraphQL identifier conversions — **must stay byte-for-byte
 * identical** to `metap/crates/metap-graphql/src/naming.rs`. If one side changes, the other has to
 * change with it — there's no shared source of truth across the Rust/TS boundary for this mapping,
 * same as every other wire-shape convention this repo hand-mirrors instead of generating (see
 * `metadata/types.ts`'s own doc comment on why `EntitySummary`'s *shape* is generated but
 * conventions like this one aren't).
 *
 * Started as just `listFieldName` (`RelatedRecordsPanel`'s one need); the other 5 were added once
 * a second consumer (`metap-demo-waf`'s `data-plane/web/src/api/waf.ts`, migrating its REST calls
 * to GraphQL) needed the full set `naming.rs` exposes — `get`/`create`/`update`/`delete`/
 * `transition` field names, plus the bare type name every one of those is built from.
 */

function pascalCase(entityName: string): string {
  return entityName
    .split(/[._-]/)
    .map((part) => (part.length === 0 ? "" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

function camelCase(entityName: string): string {
  const pascal = pascalCase(entityName);
  return pascal.length === 0 ? pascal : pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** The entity's GraphQL `Object` type name — e.g. `"crm.customers"` -> `"CrmCustomers"`. */
export function typeName(entityName: string): string {
  return pascalCase(entityName);
}

/** `Query.{camel}(id: ID!)` — single-record fetch. */
export function getFieldName(entityName: string): string {
  return camelCase(entityName);
}

export function listFieldName(entityName: string): string {
  return `${camelCase(entityName)}List`;
}

export function createFieldName(entityName: string): string {
  return `create${typeName(entityName)}`;
}

export function updateFieldName(entityName: string): string {
  return `update${typeName(entityName)}`;
}

export function deleteFieldName(entityName: string): string {
  return `delete${typeName(entityName)}`;
}

export function transitionFieldName(entityName: string): string {
  return `transition${typeName(entityName)}`;
}
