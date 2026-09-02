import { useTenantUsers } from "../auth/useTenantUsers";

/** Resolves a plain-string field holding a `metap` user id (e.g. `Incident.assignedTo`) to that
 * user's email — driven by a `FieldDisplayHint` with `resolveVia: "users"` (see that type's doc
 * comment, `metap-metadata`). No batch/non-batch split like `ReferenceFieldValue` needs: every
 * instance calls `useTenantUsers()` with the same query key (`["tenant-users"]`), so react-query
 * dedupes them into 1 request per page regardless of how many cells render it — the tenant user
 * list is small and already fetched once for the shell's own "logged in as" display. Falls back
 * to the raw id if it isn't found in the tenant's user list (e.g. a since-removed user). */
export function UserFieldValue({ value }: { value: unknown }) {
  const users = useTenantUsers();
  const id = typeof value === "string" ? value : null;
  const email = id ? users.find((u) => u.id === id)?.email : null;
  return <>{email ?? String(value)}</>;
}
