/** Lets `apiFetch`/`graphqlFetch` — plain functions with no React tree to sit in — tell
 *  `AuthContext` "the session just came back 401" without either side importing the other.
 *  `AuthContext` is the only real listener today (forces an immediate `["currentUser"]` refetch
 *  so `status` flips to "anonymous" without waiting for the next window-focus/reconnect refetch —
 *  `docs/features/31-session-expiry-redirect-and-refresh.md`), but this stays a plain event bus
 *  rather than a `platform-ui`-specific hook so a future non-React consumer could listen too.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifySessionExpired(): void {
  listeners.forEach((listener) => listener());
}
