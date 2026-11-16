/** Deep links into the Policies page (roadmap 114). */

/** One role's permissions, in the page's "by role" view. */
export function policiesRoleHref(role: string): string {
  return `/admin/policies?view=roles&role=${encodeURIComponent(role)}`;
}

/** One entity in the "by entity" view; `advanced` opens its advanced policies, where they are edited. */
export function policiesEntityHref(entity: string, tab: "basic" | "advanced" = "basic"): string {
  return `/admin/policies?view=entity&entity=${encodeURIComponent(entity)}&tab=${tab}`;
}
