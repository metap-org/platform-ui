import { useApiQuery } from "../api/useApiQuery";

/** What the caller may do with one entity (entity-level policy, from `GET /metadata/entity-access`). */
export type EntityAccess = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

export type EntityAccessAction = "read" | "create" | "update" | "delete";

/** Per-entity permission map for the signed-in user. UI-only gating (hide a menu entry, a button):
 *  the server re-checks every request regardless. Refetched on window focus, since an admin can
 *  change a user's roles mid-session. */
export function useEntityAccess() {
  return useApiQuery<{ data: Record<string, EntityAccess> }, Record<string, EntityAccess>>(
    ["entity-access"],
    "/metadata/entity-access",
    (response) => response.data,
    true,
    { staleTime: 60_000 },
  );
}

/** True when the caller may `action` the entity. While the map is loading, or for an entity the
 *  backend did not list, answers `false` — nothing is offered before it is known to be allowed. */
export function useCanAccessEntity(entity: string, action: EntityAccessAction = "read"): boolean {
  const { data } = useEntityAccess();
  const access = data?.[entity];
  if (!access) return false;
  switch (action) {
    case "read":
      return access.canRead;
    case "create":
      return access.canCreate;
    case "update":
      return access.canUpdate;
    case "delete":
      return access.canDelete;
  }
}
