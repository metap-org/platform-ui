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
/** Methods a browser can trigger cross-site without the request ever touching CORS (a plain HTML
 * form, an `<img>`/`<script>` src) — exactly the shape CSRF depends on, and exactly what the
 * server (`crates/metap-http/src/auth.rs`'s cookie branch) requires the CSRF header for. GET/HEAD
 * are also excluded on the general REST principle that they never mutate, matching the backend's
 * own `Method::GET | Method::HEAD | Method::OPTIONS` exemption. */
function needsCsrfHeader(method: string | undefined): boolean {
  const safe = new Set(["GET", "HEAD", "OPTIONS"]);
  return !safe.has((method ?? "GET").toUpperCase());
}

/** No `token` parameter (removed 2026-09-03, alongside the backend's move to cookie-based
 * sessions — `docs/audits/02-auth-permission-workflow-diagram-audit.md`'s follow-up). The session
 * is a `HttpOnly` cookie the browser attaches on its own; `credentials: "include"` is what makes
 * `fetch` actually send (and store, on `/auth/login`'s response) it — the default of
 * `"same-origin"` would still work for a same-origin dev proxy, but not once the frontend and API
 * are on genuinely different origins, which `credentials: "include"` handles either way. The CSRF
 * header is attached automatically for any mutating request, so no call site needs to remember
 * it — see `needsCsrfHeader`/`readCsrfCookie` above. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const csrfToken = needsCsrfHeader(init?.method) ? readCsrfCookie() : null;
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
