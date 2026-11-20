import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { ApiError, apiFetch } from "../api/client";
import { graphqlFetch, GraphQLError } from "../api/graphqlClient";
import { useGraphQLQuery } from "../api/useGraphQLQuery";

/**
 * Two-factor authentication and login sessions of the signed-in person (roadmap 115 M3/M4).
 * Signed-in calls are GraphQL (the issuer's `AccountService` over gRPC); the steps of a sign-in
 * that is not finished yet are REST (`/auth/login/mfa`, `/auth/mfa/setup*`), because they end by
 * setting the session cookie and there is no session to authenticate a GraphQL call with yet.
 */

const GRAPHQL_PATH = "/graphql";

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
  return useGraphQLQuery<{ mfaStatus: MfaStatus }, MfaStatus>(
    MFA_KEY,
    GRAPHQL_PATH,
    "{ mfaStatus { enabled recoveryCodesLeft } }",
    undefined,
    (r) => r.mfaStatus,
  );
}

export function useMySessions() {
  return useGraphQLQuery<{ mySessions: LoginSession[] }, LoginSession[]>(
    SESSIONS_KEY,
    GRAPHQL_PATH,
    "{ mySessions { id current tenantId tenantName createdAt lastSeenAt expiresAt ip userAgent } }",
    undefined,
    (r) => r.mySessions,
  );
}

/** Mutations of the signed-in person's own MFA and sessions; each refreshes what it changed.
 *  A wrong code rejects with `GraphQLError.code` `mfa_invalid_code`. */
export function useAccountSecurityActions() {
  const queryClient = useQueryClient();
  const refreshMfa = () => queryClient.invalidateQueries({ queryKey: MFA_KEY });
  const refreshSessions = () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });

  return {
    async beginMfaEnrollment(): Promise<MfaEnrollment> {
      const r = await graphqlFetch<{ beginMfaEnrollment: MfaEnrollment }>(
        GRAPHQL_PATH,
        "mutation { beginMfaEnrollment { secret otpauthUri } }",
      );
      return r.beginMfaEnrollment;
    },
    /** Turns MFA on; the recovery codes come back once, here. */
    async confirmMfaEnrollment(code: string): Promise<string[]> {
      const r = await graphqlFetch<{ confirmMfaEnrollment: string[] }>(
        GRAPHQL_PATH,
        "mutation($code: String!) { confirmMfaEnrollment(code: $code) }",
        { code },
      );
      void refreshMfa();
      return r.confirmMfaEnrollment;
    },
    async disableMfa(code: string) {
      await graphqlFetch(GRAPHQL_PATH, "mutation($code: String!) { disableMfa(code: $code) }", {
        code,
      });
      void refreshMfa();
    },
    /** New recovery codes; the old ones stop working. */
    async regenerateRecoveryCodes(code: string): Promise<string[]> {
      const r = await graphqlFetch<{ regenerateRecoveryCodes: string[] }>(
        GRAPHQL_PATH,
        "mutation($code: String!) { regenerateRecoveryCodes(code: $code) }",
        { code },
      );
      void refreshMfa();
      return r.regenerateRecoveryCodes;
    },
    async revokeSession(id: string) {
      await graphqlFetch(GRAPHQL_PATH, "mutation($id: ID!) { revokeSession(id: $id) }", { id });
      void refreshSessions();
    },
    /** Signs out every session of the person but this one; resolves to how many ended. */
    async revokeOtherSessions(): Promise<number> {
      const r = await graphqlFetch<{ revokeOtherSessions: number }>(
        GRAPHQL_PATH,
        "mutation { revokeOtherSessions }",
      );
      void refreshSessions();
      return r.revokeOtherSessions;
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

/** Text for an error from an MFA step, REST (`ApiError`) or GraphQL (`GraphQLError`) alike. */
export function describeMfaError(err: unknown, t: TFunction): string {
  const code = err instanceof ApiError || err instanceof GraphQLError ? err.code : undefined;
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
