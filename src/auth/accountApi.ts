import { apiFetch } from "../api/client";
import { useApiQuery } from "../api/useApiQuery";

/**
 * The caller's own account (roadmap 113): `/me/*` on the token issuer; switching tenant and
 * changing the password are `/auth/*` because the server answers them with a new session cookie.
 */

export type MyTenant = { tenantId: string; name: string | null; current: boolean };

/** Every tenant the signed-in person can switch to, the current one flagged. */
export function useMyTenants() {
  return useApiQuery<{ tenants: MyTenant[] }, MyTenant[]>(
    ["account", "myTenants"],
    "/me/tenants",
    (r) => r.tenants.map((t) => ({ ...t, name: t.name || null })),
  );
}

/** Moves the session to another tenant of the same person, then reloads the app: every cached
 *  query belongs to the old tenant, and a full reload is the only way to be sure none survives. */
export async function switchTenant(tenantId: string) {
  await apiFetch("/auth/switch-tenant", { method: "POST", body: JSON.stringify({ tenantId }) });
  window.location.assign("/");
}

/** Sets the caller's password. The server signs out every other session of the person (all
 *  tenants, all devices) and hands this one a fresh cookie. Rejects with `ApiError.code`
 *  `wrong_password` or `weak_password`. */
export async function changePassword(currentPassword: string, newPassword: string) {
  await apiFetch("/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

/** A tenant's label in pickers: its name, else a short form of its id (tenant names arrive with
 *  platform tenant administration, roadmap 113 P3). */
export function tenantLabel(
  t: { tenantId: string; name: string | null },
  unnamed: (id: string) => string,
) {
  return t.name ?? unnamed(t.tenantId.slice(0, 8));
}

/** What the invitation page asks for (roadmap 113 P2): `set` a password for a brand-new account,
 *  `confirm` an existing account with its current one, or `provider` (an account that signs in
 *  through an identity provider, which the link alone can't prove). */
export type InvitationInfo = {
  email: string;
  displayName: string;
  tenantId: string;
  tenantName: string | null;
  expiresAt: string;
  passwordMode: "set" | "confirm" | "provider";
  minPasswordLength: number;
};

/** Rejects with `ApiError.code` `invitation_invalid` for an unknown, expired, used or withdrawn
 *  link (deliberately one code). */
export async function lookupInvitation(token: string) {
  const response = await apiFetch<{ data: InvitationInfo }>("/auth/invitations/lookup", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  return response.data;
}

/** Joins the tenant and signs in (the server sets the session cookie). */
export async function acceptInvitation(token: string, password: string, displayName?: string) {
  await apiFetch("/auth/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ token, password, displayName }),
  });
}

/** Always succeeds the same way, whether or not the email has an account. */
export async function requestPasswordReset(email: string) {
  await apiFetch("/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) });
}

/** Sets the new password from a reset link; signs every session out (sign in again after).
 *  Rejects with `reset_token_invalid` or `weak_password`. */
export async function resetPassword(token: string, password: string) {
  await apiFetch("/auth/password/reset", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

/** The `?token=` of an emailed link. */
export function readTokenFromUrl(): string {
  return new URL(window.location.href).searchParams.get("token") ?? "";
}

/** Drops `?token=` from the address bar once read, so the link isn't left in history or sent on as
 *  a Referer. */
export function stripTokenFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("token")) return;
  url.searchParams.delete("token");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

// --- Self-service signup (roadmap 115 M2) ------------------------------------------------------

/** Whether this deployment lets anyone register a tenant of their own (`/auth/signup/status`). */
export function useSignupOpen() {
  return useApiQuery<{ data: { enabled: boolean } }, boolean>(
    ["account", "signupStatus"],
    "/auth/signup/status",
    (r) => r.data.enabled,
    true,
    { staleTime: 5 * 60 * 1000 },
  );
}

export type SignupInput = {
  tenantName: string;
  email: string;
  displayName?: string;
  password: string;
};

/** Emails a confirmation link; answers the same whether or not the address already has an
 *  account, so it cannot be used to find out who does. Rejects with `signup_disabled`,
 *  `validation_failed` (`fieldErrors`) or `captcha_failed`. */
export async function startSignup(input: SignupInput) {
  await apiFetch("/auth/signup", { method: "POST", body: JSON.stringify(input) });
}

/** Opens the confirmed link: creates the tenant with the person as its admin and signs them in
 *  (cookie). `mfaRequired` when the address already has an account with a second factor: sign in
 *  the usual way then. Rejects with `signup_invalid`. */
export async function completeSignup(token: string): Promise<{ mfaRequired: boolean }> {
  const res = await apiFetch<{ data?: { mfaRequired?: boolean } }>("/auth/signup/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  return { mfaRequired: Boolean(res?.data?.mfaRequired) };
}
