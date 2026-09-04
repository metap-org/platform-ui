import { createContext, useContext, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

export type AuthStatus = "unknown" | "authenticated" | "anonymous";

type AuthContextValue = {
  /** `"unknown"` until the initial `GET /auth/me` check resolves (once per app load — react-query
   *  dedupes this against any other `["currentUser"]` consumer, e.g. `useCurrentUser`, so it's
   *  never a second network call). Every protected `useApiQuery`/`useApiMutation`/etc. gates on
   *  `status === "authenticated"`, same role `token !== null` played before the cookie migration
   *  (`docs/audits/02-auth-permission-workflow-diagram-audit.md`'s follow-up, 2026-09-03). */
  status: AuthStatus;
  /** Call once the backend has already set the session cookie (a successful `POST /auth/login`)
   *  so the rest of the app treats the caller as signed in immediately, instead of waiting on the
   *  next `["currentUser"]` refetch. Clears the query cache first — same reason the old
   *  `setToken` did: nothing fetched under the previous (or no) session should linger.
   *
   *  **Awaits `status` actually reflecting the new session before resolving** (2026-09-04) — a
   *  caller that navigates right after calling this, without awaiting it, raced the refetch:
   *  `queryClient.clear()` alone doesn't update `status` synchronously, so the destination
   *  route's `RequireAuth` could still read the *pre-login* "anonymous" value on its very first
   *  render and bounce straight back to `/login` — found live (`LoginForm`'s `handleSubmit`,
   *  the only caller). Await this before navigating and that race can't happen. */
  markAuthenticated: () => Promise<void>;
  /** `POST /auth/logout` to clear the session cookie server-side (a client can't clear a
   *  `HttpOnly` cookie itself), then resets local state and **awaits `status` actually settling
   *  to "anonymous"** before resolving — same reasoning as `markAuthenticated`'s doc comment,
   *  mirrored here so a caller that navigates to `/login` right after `await logout()` doesn't
   *  land while `status` still reads stale "authenticated" (which would otherwise make
   *  `LoginForm`'s own effect immediately navigate back home). Swallows a `POST /auth/logout`
   *  network failure — the caller is about to be treated as logged out either way, and a logout
   *  that couldn't reach the server is not worth blocking on or surfacing as an error. */
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type MeResponse = { data: unknown };

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // The single source of truth for "am I logged in" — deliberately not gated behind itself (it
  // must run unconditionally on every mount to determine `status` in the first place, unlike
  // every other query in this package). `retry: false`: a 401 here means "not logged in", not a
  // transient failure worth retrying.
  const me = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => apiFetch<MeResponse>("/auth/me"),
    retry: false,
  });

  const status: AuthStatus = me.isLoading ? "unknown" : me.isError ? "anonymous" : "authenticated";

  // `clear()` alone is enough to force a refetch — `AuthProvider`'s own `me` query above is
  // always actively mounted, so clearing the cache it's part of makes react-query recreate and
  // re-run it immediately, the same way `AuthContext`'s old `setToken` relied on a bare `clear()`.
  // `refetchQueries` (not just `clear()`) is what makes this function's returned promise
  // actually resolve once `status` has settled — see this fn's doc comment on the interface
  // above for why that matters to callers.
  const markAuthenticated = useCallback(async () => {
    queryClient.clear();
    await queryClient.refetchQueries({ queryKey: ["currentUser"], type: "active" });
  }, [queryClient]);

  const logout = useCallback(async () => {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    queryClient.clear();
    await queryClient.refetchQueries({ queryKey: ["currentUser"], type: "active" });
  }, [queryClient]);

  const value = useMemo(
    () => ({ status, markAuthenticated, logout }),
    [status, markAuthenticated, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
