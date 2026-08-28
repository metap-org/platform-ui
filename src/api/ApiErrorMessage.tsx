import { useNavigationAdapter } from "../navigation/NavigationContext";
import { ApiError } from "./client";

/** No i18n yet (deferred — see repo README) — hardcoded English strings, unlike
 * `packages/platform-react`'s `react-i18next`-backed version this was ported from. */
export function ApiErrorMessage({ error }: { error: unknown }) {
  const adapter = useNavigationAdapter();

  if (error instanceof ApiError && error.status === 401) {
    return (
      <div className="text-sm text-destructive">
        Your session has expired.{" "}
        <adapter.Link to={adapter.toLogin()} className="underline hover:no-underline">
          Sign in again
        </adapter.Link>
        .
      </div>
    );
  }

  return (
    <div className="text-sm text-destructive">
      Error: {error instanceof Error ? error.message : String(error)}
    </div>
  );
}
