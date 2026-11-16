import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { graphqlFetch } from "../api/graphqlClient";
import { useGraphQLQuery } from "../api/useGraphQLQuery";
import { ROLE_FIELDS, type AdminRole, type UserAuditEvent } from "./userAdminApi";

/**
 * The tenant's role catalog (roadmap 114): GraphQL fields the gateway serves from the token
 * issuer's `RoleAdminService` over gRPC. Admin role required. Deleting a role still in use is
 * refused with `GraphQLError.code` `role_in_use`, whose `fieldErrors.members` / `.policies` say what
 * blocks it (at most 5 each, then a "+N" entry). Assigning a role to someone stays
 * `useUserAdminActions().assignRole` / `revokeRole`.
 */

const GRAPHQL_PATH = "/graphql";

export function useRole(name: string | null) {
  return useGraphQLQuery<{ role: AdminRole | null }, AdminRole | null>(
    ["admin", "roles", "one", name],
    GRAPHQL_PATH,
    `query AdminRole($name: String!) { role(name: $name) { ${ROLE_FIELDS} } }`,
    { name },
    (r) => r.role,
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
    queryFn: ({ pageParam }) =>
      graphqlFetch<{ roleAudit: { events: UserAuditEvent[]; nextCursor: string | null } }>(
        GRAPHQL_PATH,
        `query RoleAudit($name: String!, $cursor: String, $limit: Int) {
          roleAudit(name: $name, cursor: $cursor, limit: $limit) { events { id action actorUserId occurredAt diff } nextCursor }
        }`,
        { name, cursor: pageParam, limit: pageSize },
      ).then((r) => r.roleAudit),
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

const PERMISSIONS_SELECTION =
  "role grants { entity action } advanced { id entity action roles effect field subject condition }";

export function useRolePermissions(name: string | null) {
  return useGraphQLQuery<{ rolePermissions: RolePermissions }, RolePermissions>(
    ["admin", "roles", "permissions", name],
    GRAPHQL_PATH,
    `query RolePermissions($name: String!) { rolePermissions(name: $name) { ${PERMISSIONS_SELECTION} } }`,
    { name },
    (r) => r.rolePermissions,
    name !== null,
  );
}

/** One-off read of another role's permissions (the editor's "copy from"). */
export async function fetchRolePermissions(name: string): Promise<RolePermissions> {
  const data = await graphqlFetch<{ rolePermissions: RolePermissions }>(
    GRAPHQL_PATH,
    `query($name: String!) { rolePermissions(name: $name) { ${PERMISSIONS_SELECTION} } }`,
    { name },
  );
  return data.rolePermissions;
}

/** Every mutation refreshes all role queries (list, detail, permissions, history). */
export function useRoleAdminActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });

  async function roleMutation(field: "createRole" | "updateRole", input: RoleInput) {
    const copy = field === "createRole";
    const data = await graphqlFetch<Record<string, AdminRole>>(
      GRAPHQL_PATH,
      `mutation($name: String!, $label: String, $description: String${copy ? ", $copyFrom: String" : ""}) {
        ${field}(name: $name, label: $label, description: $description${copy ? ", copyFrom: $copyFrom" : ""}) { ${ROLE_FIELDS} }
      }`,
      copy ? input : { name: input.name, label: input.label, description: input.description },
    );
    await refresh();
    return data[field] as AdminRole;
  }

  return {
    createRole: (input: RoleInput) => roleMutation("createRole", input),
    updateRole: (input: RoleInput) => roleMutation("updateRole", input),
    /** Replaces the role's basic permissions with `grants` (its advanced policies stay). */
    async setRolePermissions(role: string, grants: RoleGrant[]) {
      const data = await graphqlFetch<{ setRolePermissions: RolePermissions }>(
        GRAPHQL_PATH,
        `mutation($role: String!, $grants: [RoleGrantInput!]!) {
          setRolePermissions(role: $role, grants: $grants) { ${PERMISSIONS_SELECTION} }
        }`,
        { role, grants },
      );
      await refresh();
      return data.setRolePermissions;
    },
    async deleteRole(name: string) {
      await graphqlFetch(GRAPHQL_PATH, "mutation($name: String!) { deleteRole(name: $name) }", {
        name,
      });
      await refresh();
    },
  };
}
