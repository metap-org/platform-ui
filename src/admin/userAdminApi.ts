import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { graphqlFetch } from "../api/graphqlClient";
import { useGraphQLQuery } from "../api/useGraphQLQuery";

/**
 * User administration for the caller's tenant (roadmap 113): GraphQL fields the gateway serves
 * from the token issuer's `UserAdminService` over gRPC. Every call needs the admin role; the
 * server also refuses what would hurt the caller or the tenant (disabling or demoting yourself,
 * leaving no active admin), reported as `GraphQLError.code` `self_modification` / `last_admin`.
 */

const GRAPHQL_PATH = "/graphql";

export type UserStatus = "active" | "disabled" | "invited";

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  roles: string[];
  /** "local", or the external IdP that provisioned the member ("oidc", "oauth2"). */
  authProvider: string;
  hasPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  invitedBy: string | null;
  /** Also a member of another tenant: their password is not this tenant's to reset. */
  sharedIdentity: boolean;
  /** An invited member's open invitation expires then; `null` when none is open. */
  invitationExpiresAt: string | null;
};

/** What inviting (or re-sending) returns. Without email (SMTP not set up, or the relay refused),
 *  `emailSent` is false and `acceptUrl` is the link to pass on by hand. */
export type InviteResult = {
  user: AdminUserRow;
  expiresAt: string;
  emailSent: boolean;
  acceptUrl: string | null;
};

export type InviteUserInput = { email: string; displayName?: string; roles: string[] };

/** One role of the tenant's catalog (roadmap 114). */
export type AdminRole = {
  id: string;
  /** The key members and policies refer to; never changes. */
  name: string;
  /** `null` when unset: show the name instead (`roleDisplayName`). */
  label: string | null;
  description: string | null;
  /** Active members holding the role. */
  userCount: number;
  /** Policies naming the role. */
  policyCount: number;
  /** Defined by the platform (`admin`, `platform_admin`): can't be deleted. */
  builtin: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export const ROLE_FIELDS =
  "id name label description userCount policyCount builtin createdAt updatedAt";

/** What to show for a role: its label, else its name. */
export function roleDisplayName(role: Pick<AdminRole, "name" | "label">): string {
  return role.label || role.name;
}

export type UsersQuery = {
  search?: string;
  status?: UserStatus;
  role?: string;
  offset: number;
  limit: number;
};

const USER_FIELDS =
  "id email displayName status roles authProvider hasPassword lastLoginAt createdAt invitedBy sharedIdentity invitationExpiresAt";

const USERS_QUERY = `query AdminUsers($search: String, $status: String, $role: String, $offset: Int, $limit: Int) {
  users(search: $search, status: $status, role: $role, offset: $offset, limit: $limit) {
    total users { ${USER_FIELDS} }
  }
}`;

export function useUsers(query: UsersQuery) {
  return useGraphQLQuery<
    { users: { total: number; users: AdminUserRow[] } },
    { total: number; users: AdminUserRow[] }
  >(["admin", "users", query], GRAPHQL_PATH, USERS_QUERY, query, (r) => r.users);
}

export function useUser(id: string | null) {
  return useGraphQLQuery<{ user: AdminUserRow | null }, AdminUserRow | null>(
    ["admin", "users", "one", id],
    GRAPHQL_PATH,
    `query AdminUser($id: ID!) { user(id: $id) { ${USER_FIELDS} } }`,
    { id },
    (r) => r.user,
    id !== null,
  );
}

/** The tenant's role catalog — what a member may be given. `search` matches name, label or
 *  description. */
export function useRoles(search?: string) {
  return useGraphQLQuery<{ roles: AdminRole[] }, AdminRole[]>(
    ["admin", "roles", "list", search ?? ""],
    GRAPHQL_PATH,
    `query AdminRoles($search: String) { roles(search: $search) { ${ROLE_FIELDS} } }`,
    { search: search || undefined },
    (r) => r.roles,
  );
}

export type UserAuditEvent = {
  id: string;
  action: "create" | "update" | "delete";
  actorUserId: string | null;
  occurredAt: string;
  /** `{field: {before, after}}`, changed fields only. */
  diff: Record<string, { before: unknown; after: unknown }>;
};

/** One user's administrative history, newest first, a page at a time. */
export function useUserAudit(id: string | null, pageSize = 20) {
  const { status } = useAuth();
  return useInfiniteQuery({
    queryKey: ["admin", "userAudit", id],
    enabled: status === "authenticated" && id !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      graphqlFetch<{ userAudit: { events: UserAuditEvent[]; nextCursor: string | null } }>(
        GRAPHQL_PATH,
        `query UserAudit($id: ID!, $cursor: String, $limit: Int) {
          userAudit(id: $id, cursor: $cursor, limit: $limit) { events { id action actorUserId occurredAt diff } nextCursor }
        }`,
        { id, cursor: pageParam, limit: pageSize },
      ).then((r) => r.userAudit),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export type CreateUserInput = {
  email: string;
  password?: string;
  displayName?: string;
  roles: string[];
};

/** Every mutation refreshes the user list, every role query (counts, members) and that user's history. Plain async
 *  functions rather than bound `useMutation` hooks: each takes a different user id, and the page
 *  tracks pending/error state per action. */
export function useUserAdminActions() {
  const queryClient = useQueryClient();

  async function refresh(id?: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "roles"] }),
      id ? queryClient.invalidateQueries({ queryKey: ["admin", "userAudit", id] }) : null,
    ]);
  }

  async function userMutation(
    field: string,
    signature: string,
    args: string,
    variables: Record<string, unknown>,
  ) {
    const data = await graphqlFetch<Record<string, AdminUserRow>>(
      GRAPHQL_PATH,
      `mutation(${signature}) { ${field}(${args}) { ${USER_FIELDS} } }`,
      variables,
    );
    await refresh(data[field]?.id);
    return data[field];
  }

  return {
    async createUser(input: CreateUserInput) {
      const data = await graphqlFetch<{
        createUser: { user: AdminUserRow; createdIdentity: boolean };
      }>(
        GRAPHQL_PATH,
        `mutation($input: CreateUserInput!) { createUser(input: $input) { createdIdentity user { ${USER_FIELDS} } } }`,
        { input },
      );
      await refresh();
      return data.createUser;
    },
    async inviteUser(input: InviteUserInput): Promise<InviteResult> {
      const data = await graphqlFetch<{ inviteUser: InviteResult }>(
        GRAPHQL_PATH,
        `mutation($input: InviteUserInput!) { inviteUser(input: $input) { emailSent acceptUrl expiresAt user { ${USER_FIELDS} } } }`,
        { input },
      );
      await refresh(data.inviteUser.user.id);
      return data.inviteUser;
    },
    /** A fresh link; the previous one stops working. */
    async resendInvitation(id: string): Promise<InviteResult> {
      const data = await graphqlFetch<{ resendInvitation: InviteResult }>(
        GRAPHQL_PATH,
        `mutation($id: ID!) { resendInvitation(id: $id) { emailSent acceptUrl expiresAt user { ${USER_FIELDS} } } }`,
        { id },
      );
      await refresh(id);
      return data.resendInvitation;
    },
    updateUser: (id: string, displayName: string) =>
      userMutation(
        "updateUser",
        "$id: ID!, $displayName: String!",
        "id: $id, displayName: $displayName",
        { id, displayName },
      ),
    disableUser: (id: string) => userMutation("disableUser", "$id: ID!", "id: $id", { id }),
    enableUser: (id: string) => userMutation("enableUser", "$id: ID!", "id: $id", { id }),
    assignRole: (userId: string, role: string) =>
      userMutation(
        "assignUserRole",
        "$userId: ID!, $role: String!",
        "userId: $userId, role: $role",
        { userId, role },
      ),
    revokeRole: (userId: string, role: string) =>
      userMutation(
        "revokeUserRole",
        "$userId: ID!, $role: String!",
        "userId: $userId, role: $role",
        { userId, role },
      ),
    async removeUser(id: string) {
      await graphqlFetch(GRAPHQL_PATH, "mutation($id: ID!) { removeUser(id: $id) }", { id });
      await refresh(id);
    },
    async resetPassword(id: string, password: string) {
      await graphqlFetch(
        GRAPHQL_PATH,
        "mutation($id: ID!, $password: String!) { resetUserPassword(id: $id, password: $password) }",
        {
          id,
          password,
        },
      );
      await refresh(id);
    },
  };
}

/** Members with their roles, first 200 — what the permission matrix shows under each role. */
export function useUserRoleAssignments() {
  const query = useUsers({ offset: 0, limit: 200 });
  return { ...query, data: query.data?.users };
}
