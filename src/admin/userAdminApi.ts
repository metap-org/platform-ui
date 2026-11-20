import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { apiFetch } from "../api/client";
import { emptyToNull } from "../api/emptyToNull";
import { useApiQuery } from "../api/useApiQuery";

/**
 * User administration for the caller's tenant (roadmap 113): `/admin/users*` on the token issuer.
 * Every call needs the admin role; the server also refuses what would hurt the caller or the
 * tenant (disabling or demoting yourself, leaving no active admin), reported as `ApiError.code`
 * `self_modification` / `last_admin`.
 */

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
  /** The tenant's owner (roadmap 115 M8): other admins can't disable, demote or reset them. */
  isOwner: boolean;
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

/** A role as the REST API sends it, in this app's shape. */
export function toAdminRole(role: AdminRole): AdminRole {
  return emptyToNull(role, ["label", "description", "createdAt", "updatedAt"]);
}

/** A member as the REST API sends it, in this app's shape. */
export function toAdminUser(user: AdminUserRow): AdminUserRow {
  return emptyToNull(user, ["lastLoginAt", "invitedBy", "invitationExpiresAt"]);
}

/** An audit page as the REST API sends it, in this app's shape. */
export function toAuditPage(page: { events: UserAuditEvent[]; nextCursor: string }): {
  events: UserAuditEvent[];
  nextCursor: string | null;
} {
  return {
    events: page.events.map((e) => emptyToNull(e, ["actorUserId"])),
    nextCursor: page.nextCursor || null,
  };
}

function toInviteResult(r: InviteResult): InviteResult {
  return { ...r, user: toAdminUser(r.user), acceptUrl: r.acceptUrl || null };
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function post(body?: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body ?? {}) };
}

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

export function useUsers(params: UsersQuery) {
  return useApiQuery<
    { total: number; users: AdminUserRow[] },
    { total: number; users: AdminUserRow[] }
  >(["admin", "users", params], `/admin/users${query(params)}`, (r) => ({
    total: r.total,
    users: r.users.map(toAdminUser),
  }));
}

export function useUser(id: string | null) {
  return useApiQuery<AdminUserRow, AdminUserRow | null>(
    ["admin", "users", "one", id],
    `/admin/users/${encodeURIComponent(id ?? "")}`,
    toAdminUser,
    id !== null,
  );
}

/** The tenant's role catalog — what a member may be given. `search` matches name, label or
 *  description. */
export function useRoles(search?: string) {
  return useApiQuery<{ roles: AdminRole[] }, AdminRole[]>(
    ["admin", "roles", "list", search ?? ""],
    `/admin/roles${query({ search })}`,
    (r) => r.roles.map(toAdminRole),
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
      apiFetch<{ events: UserAuditEvent[]; nextCursor: string }>(
        `/admin/users/${encodeURIComponent(id ?? "")}/audit${query({ cursor: pageParam ?? undefined, limit: pageSize })}`,
      ).then(toAuditPage),
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

  const userPath = (id: string, rest = "") => `/admin/users/${encodeURIComponent(id)}${rest}`;

  async function userMutation(id: string, path: string, init: RequestInit) {
    const user = toAdminUser(await apiFetch<AdminUserRow>(path, init));
    await refresh(id);
    return user;
  }

  return {
    async createUser(input: CreateUserInput) {
      const res = await apiFetch<{ user: AdminUserRow; createdIdentity: boolean }>(
        "/admin/users",
        post(input),
      );
      await refresh();
      return { ...res, user: toAdminUser(res.user) };
    },
    async inviteUser(input: InviteUserInput): Promise<InviteResult> {
      const res = toInviteResult(await apiFetch<InviteResult>("/admin/invitations", post(input)));
      await refresh(res.user.id);
      return res;
    },
    /** A fresh link; the previous one stops working. */
    async resendInvitation(id: string): Promise<InviteResult> {
      const res = toInviteResult(
        await apiFetch<InviteResult>(userPath(id, "/invitation/resend"), post()),
      );
      await refresh(id);
      return res;
    },
    updateUser: (id: string, displayName: string) =>
      userMutation(id, userPath(id), { method: "PATCH", body: JSON.stringify({ displayName }) }),
    disableUser: (id: string) => userMutation(id, userPath(id, "/disable"), post()),
    enableUser: (id: string) => userMutation(id, userPath(id, "/enable"), post()),
    assignRole: (userId: string, role: string) =>
      userMutation(userId, userPath(userId, "/roles"), post({ role })),
    revokeRole: (userId: string, role: string) =>
      userMutation(userId, userPath(userId, `/roles/${encodeURIComponent(role)}`), {
        method: "DELETE",
      }),
    async removeUser(id: string) {
      await apiFetch(userPath(id), { method: "DELETE" });
      await refresh(id);
    },
    /** Removes the member's second factor so they can sign in with the password alone (and
     *  set a new one); for someone who lost their phone and their recovery codes. */
    async resetMfa(id: string) {
      await apiFetch(userPath(id, "/mfa/reset"), post());
      await refresh(id);
    },
    async resetPassword(id: string, password: string) {
      await apiFetch(userPath(id, "/password"), post({ password }));
      await refresh(id);
    },
  };
}

/** Members with their roles, first 200 — what the permission matrix shows under each role. */
export function useUserRoleAssignments() {
  const query = useUsers({ offset: 0, limit: 200 });
  return { ...query, data: query.data?.users };
}
