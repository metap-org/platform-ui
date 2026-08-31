import type { ReactNode } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { NavigationContext } from "./NavigationContext";
import type { NavigationAdapter } from "./NavigationContext";

/** Optional, ready-made `NavigationAdapter` for `react-router-dom` — `NavigationContext`'s
 * interface stays router-agnostic (a consumer could implement its own for Next.js, TanStack
 * Router, etc.), but `react-router-dom` is already a `peerDependency` of this package, and every
 * consumer app so far (`apps/crm-fe`, `apps/jira-fe`) used to hand-roll this exact same file
 * (byte-for-byte identical in both, found 2026-08-31) rather than share one. */
function useReactRouterNavigationAdapter(): NavigationAdapter {
  const navigate = useNavigate();

  return {
    toRecordList: (entityName) => `/records/${entityName}`,
    toNewRecord: (entityName) => `/records/${entityName}/new`,
    toRecordDetail: (entityName, id) => `/records/${entityName}/${id}`,
    toEditRecord: (entityName, id) => `/records/${entityName}/${id}/edit`,
    toLogin: () => "/login",
    toHome: () => "/",
    navigate,
    Link: RouterLink,
  };
}

export function ReactRouterNavigationProvider({ children }: { children: ReactNode }) {
  const adapter = useReactRouterNavigationAdapter();
  return <NavigationContext.Provider value={adapter}>{children}</NavigationContext.Provider>;
}
