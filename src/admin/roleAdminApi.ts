import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../api/client";
import { emptyToNull } from "../api/emptyToNull";
import { useApiQuery } from "../api/useApiQuery";
import { toAdminRole, toAuditPage, type AdminRole, type UserAuditEvent } from "./userAdminApi";

/**
 * The tenant's role catalog (roadmap 114): `/admin/roles*` on the token issuer. Admin role
 * required. Deleting a role still in use is refused with `ApiError.code` `role_in_use`, whose
 * `fieldErrors.members` / `.policies` say what blocks it (at most 5 each, then a "+N" entry).
 * Assigning a role to someone stays `useUserAdminActions().assignRole` / `revokeRole`.
 */

const rolePath = (name: string, rest = "") => `/admin/roles/${encodeURIComponent(name)}${rest}`;

export function useRole(name: string | null) {
  return useApiQuery<AdminRole, AdminRole | null>(
    ["admin", "roles", "one", name],
    rolePath(name ?? ""),
    toAdminRole,
    name !== null,
  );
}

/** One role's administrative history, newest first, a page at a time. */
export function useRoleAudit(name: string | null, pageSize = 20) {
  const { status } = useAuth();
  return useInfiniteQuery({
    queryKey: ["admin", "roles", "audit", name],
    enabled: status === "authenticated" && name !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: String(pageSize) });
      if (pageParam) q.set("cursor", pageParam);
      return apiFetch<{ events: UserAuditEvent[]; nextCursor: string }>(
        `${rolePath(name ?? "", "/audit")}?${q.toString()}`,
      ).then(toAuditPage);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export type RoleInput = {
  name: string;
  label?: string;
  description?: string;
  /** createRole only: start with this role's basic permissions. */
  copyFrom?: string;
};

/** One basic permission: `action` is read/create/update/delete, `transition` (every workflow
 *  action) or `transition:<workflow action>`. */
export type RoleGrant = { entity: string; action: string };

/** A policy naming the role that isn't a plain grant (condition, field, record subject or deny). */
export type RolePolicy = {
  id: string;
  entity: string;
  action: string;
  roles: string[];
  effect: "allow" | "deny";
  field: string | null;
  subject: "context" | "record";
  condition: unknown;
};

export type RolePermissions = { role: string; grants: RoleGrant[]; advanced: RolePolicy[] };

function toRolePermissions(p: RolePermissions): RolePermissions {
  return { ...p, advanced: p.advanced.map((a) => emptyToNull(a, ["field"])) };
}

export function useRolePermissions(name: string | null) {
  return useApiQuery<RolePermissions, RolePermissions>(
    ["admin", "roles", "permissions", name],
    rolePath(name ?? "", "/permissions"),
    toRolePermissions,
    name !== null,
  );
}

/** One-off read of another role's permissions (the editor's "copy from"). */
export async function fetchRolePermissions(name: string): Promise<RolePermissions> {
  return toRolePermissions(await apiFetch<RolePermissions>(rolePath(name, "/permissions")));
}

/** Every mutation refreshes all role queries (list, detail, permissions, history). */
export function useRoleAdminActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });

  return {
    async createRole(input: RoleInput) {
      const role = await apiFetch<AdminRole>("/admin/roles", {
        method: "POST",
        body: JSON.stringify(input),
      });
      await refresh();
      return toAdminRole(role);
    },
    async updateRole(input: RoleInput) {
      const role = await apiFetch<AdminRole>(rolePath(input.name), {
        method: "PATCH",
        body: JSON.stringify({ label: input.label, description: input.description }),
      });
      await refresh();
      return toAdminRole(role);
    },
    /** Replaces the role's basic permissions with `grants` (its advanced policies stay). */
    async setRolePermissions(role: string, grants: RoleGrant[]) {
      const res = await apiFetch<RolePermissions>(rolePath(role, "/permissions"), {
        method: "PUT",
        body: JSON.stringify({ grants }),
      });
      await refresh();
      return toRolePermissions(res);
    },
    async deleteRole(name: string) {
      await apiFetch(rolePath(name), { method: "DELETE" });
      await refresh();
    },
  };
}
