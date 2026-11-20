import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { ApiError, apiFetch } from "../api/client";
import { useApiQuery } from "../api/useApiQuery";

/**
 * Two-factor authentication and login sessions of the signed-in person (roadmap 115 M3/M4).
 * Signed-in calls are `/me/mfa*` and `/me/sessions*` on the token issuer; the steps of a sign-in
 * that is not finished yet are `/auth/login/mfa` and `/auth/mfa/setup*`, because they end by
 * setting the session cookie and there is no session to authenticate with yet.
 */

export type MfaStatus = { enabled: boolean; recoveryCodesLeft: number };

/** What enrolling shows: the secret to type by hand, and the `otpauth://` link the QR encodes. */
export type MfaEnrollment = { secret: string; otpauthUri: string };

export type LoginSession = {
  id: string;
  /** The session this browser is using. */
  current: boolean;
  tenantId: string;
  tenantName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string;
  userAgent: string;
};

const MFA_KEY = ["account", "mfaStatus"];
const SESSIONS_KEY = ["account", "sessions"];

export function useMfaStatus() {
  return useApiQuery<MfaStatus>(MFA_KEY, "/me/mfa");
}

export function useMySessions() {
  return useApiQuery<{ sessions: LoginSession[] }, LoginSession[]>(
    SESSIONS_KEY,
    "/me/sessions",
    (r) => r.sessions,
  );
}

/** Mutations of the signed-in person's own MFA and sessions; each refreshes what it changed.
 *  A wrong code rejects with `ApiError.code` `mfa_invalid_code`. */
export function useAccountSecurityActions() {
  const queryClient = useQueryClient();
  const refreshMfa = () => queryClient.invalidateQueries({ queryKey: MFA_KEY });
  const refreshSessions = () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });

  const post = (body?: unknown): RequestInit => ({
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });

  return {
    beginMfaEnrollment: () => apiFetch<MfaEnrollment>("/me/mfa/enrollment", post()),
    /** Turns MFA on; the recovery codes come back once, here. */
    async confirmMfaEnrollment(code: string): Promise<string[]> {
      const r = await apiFetch<{ codes: string[] }>("/me/mfa/enrollment/confirm", post({ code }));
      void refreshMfa();
      return r.codes;
    },
    async disableMfa(code: string) {
      await apiFetch("/me/mfa/disable", post({ code }));
      void refreshMfa();
    },
    /** New recovery codes; the old ones stop working. */
    async regenerateRecoveryCodes(code: string): Promise<string[]> {
      const r = await apiFetch<{ codes: string[] }>("/me/mfa/recovery-codes", post({ code }));
      void refreshMfa();
      return r.codes;
    },
    async revokeSession(id: string) {
      await apiFetch(`/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      void refreshSessions();
    },
    /** Signs out every session of the person but this one; resolves to how many ended. */
    async revokeOtherSessions(): Promise<number> {
      const r = await apiFetch<{ count: number }>("/me/sessions/revoke-others", post());
      void refreshSessions();
      return r.count;
    },
  };
}

// --- The second step of a sign-in (REST) ------------------------------------------------------

/** Posts the TOTP or recovery code of a sign-in that answered `mfaRequired`; sets the session
 *  cookie. Rejects with `ApiError.code` `mfa_invalid_code`, or `mfa_challenge` once the step has
 *  expired or run out of tries (start the sign-in again). */
export async function loginWithMfaCode(mfaToken: string, code: string) {
  await apiFetch("/auth/login/mfa", {
    method: "POST",
    body: JSON.stringify({ mfaToken, code: code.trim() }),
  });
}

/** Starts the enrolment a tenant forces on a sign-in that answered `mfaSetupRequired`. */
export async function beginRequiredMfaSetup(mfaToken: string): Promise<MfaEnrollment> {
  const r = await apiFetch<{ data: MfaEnrollment }>("/auth/mfa/setup", {
    method: "POST",
    body: JSON.stringify({ mfaToken }),
  });
  return r.data;
}

/** Confirms that enrolment with the first code, which also finishes the sign-in (session cookie
 *  set). Resolves to the recovery codes, shown once. */
export async function confirmRequiredMfaSetup(mfaToken: string, code: string): Promise<string[]> {
  const r = await apiFetch<{ data: { recoveryCodes?: string[] } }>("/auth/mfa/setup/confirm", {
    method: "POST",
    body: JSON.stringify({ mfaToken, code: code.trim() }),
  });
  return r.data.recoveryCodes ?? [];
}

export type SsoDiscovery = { ssoAvailable: boolean; tenantId?: string; startUrl?: string };

/** Whether the email's domain belongs to exactly one tenant with single sign-on, and where to
 *  start it (`startUrl`, a full-page navigation to the identity provider). */
export async function discoverSso(email: string): Promise<SsoDiscovery> {
  const r = await apiFetch<{ data: SsoDiscovery }>(
    `/auth/sso/discover?email=${encodeURIComponent(email.trim())}`,
  );
  return r.data;
}

/** A short "Chrome on Windows" style label from a User-Agent string; the raw string otherwise. */
export function describeUserAgent(ua: string): string {
  if (!ua) return "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl\//.test(ua)
              ? "curl"
              : "";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  if (!browser && !os) return ua.length > 60 ? `${ua.slice(0, 57)}…` : ua;
  return [browser, os].filter(Boolean).join(" · ");
}

/** Text for an error from an MFA step. */
export function describeMfaError(err: unknown, t: TFunction): string {
  const code = err instanceof ApiError ? err.code : undefined;
  switch (code) {
    case "mfa_invalid_code":
      return t("security.invalidCode");
    case "mfa_challenge":
      return t("security.challengeExpired");
    case "mfa_already_on":
      return t("security.alreadyOn");
    case "mfa_not_enrolled":
      return t("security.notEnrolled");
    default:
      return err instanceof Error && err.message ? err.message : t("common.somethingWentWrong");
  }
}
