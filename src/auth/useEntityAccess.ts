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

function allows(access: EntityAccess, action: EntityAccessAction): boolean {
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

/** True when the caller may `action` the entity. While the map is loading, or for an entity the
 *  backend did not list, answers `false` — nothing is offered before it is known to be allowed.
 *  For a control that acts (a button). */
export function useCanAccessEntity(entity: string, action: EntityAccessAction = "read"): boolean {
  const { data } = useEntityAccess();
  const access = data?.[entity];
  return access ? allows(access, action) : false;
}

/** True only when the backend answered and said no. Unknown (still loading, the request failed,
 *  or an entity the answering service does not hold, e.g. a product split over several services
 *  behind one proxy) is not a denial. For navigation: hiding a menu entry on "unknown" would hide
 *  the whole app whenever the access map is unreachable, and the server still checks every
 *  request the screen makes. */
export function useEntityDenied(entity: string, action: EntityAccessAction = "read"): boolean {
  const { data } = useEntityAccess();
  const access = data?.[entity];
  return access ? !allows(access, action) : false;
}
