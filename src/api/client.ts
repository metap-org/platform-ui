export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

type ErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
    traceId: string;
    fieldErrors?: Record<string, string[]>;
  };
};

/** `document.cookie`'s only non-`HttpOnly` cookie the backend sets (`metap_csrf`, alongside the
 * `HttpOnly` session one) — see `crates/metap-http/src/cookies.rs`'s doc comment for the
 * double-submit scheme this backs. `null` when absent (never logged in yet, or an older backend
 * that hasn't adopted cookie sessions at all — `apiFetch` degrades to sending no CSRF header,
 * which such a backend never checks for in the first place). */
function readCsrfCookie(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.match(/(?:^|; )metap_csrf=([^;]*)/);
  const value = match?.[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}

const CSRF_HEADER_NAME = "X-CSRF-Token";

/** No `token` parameter (removed 2026-09-03, alongside the backend's move to cookie-based
 * sessions — `docs/audits/02-auth-permission-workflow-diagram-audit.md`'s follow-up). The session
 * is a `HttpOnly` cookie the browser attaches on its own; `credentials: "include"` is what makes
 * `fetch` actually send (and store, on `/auth/login`'s response) it — the default of
 * `"same-origin"` would still work for a same-origin dev proxy, but not once the frontend and API
 * are on genuinely different origins, which `credentials: "include"` handles either way.
 *
 * The CSRF header is attached to **every** request whenever the cookie exists, not only to
 * mutating ones (changed 2026-09-03 for the backend's audit 04 A#4 fix). Sending it on a safe
 * request costs nothing — the server exempts those methods and never looks at it — while the
 * previous method-based filter meant a *credential-issuing* `GET` like `/auth/token` could not be
 * CSRF-gated server-side without the frontend silently breaking. Keeping the rule "attach it if we
 * have it" here means the backend can gate any endpoint it needs to without a matching change in
 * this file, and there is no second list of "which GETs are special" to keep in sync. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const csrfToken = readCsrfCookie();
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ErrorBody | null;

    if (body?.error) {
      throw new ApiError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.fieldErrors,
      );
    }

    throw new ApiError(response.status, "unknown_error", response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
