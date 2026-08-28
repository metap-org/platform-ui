import { createContext, useContext } from "react";
import type { Context, FunctionComponent, ReactNode } from "react";

export type NavigationAdapter = {
  toRecordList: (entityName: string) => string;
  toNewRecord: (entityName: string) => string;
  toRecordDetail: (entityName: string, id: string) => string;
  toEditRecord: (entityName: string, id: string) => string;
  toLogin: () => string;
  /** Where a successful login should redirect to — the authenticated app's landing page. */
  toHome: () => string;
  navigate: (path: string) => void;
  /** `className` (not part of `packages/platform-react`'s adapter shape) so a design-system-styled
   * caller can apply Tailwind utility classes directly — shadcn-style components have no Mantine
   * `component={Link}` polymorphism prop, so every nav-link site here renders `adapter.Link`
   * itself instead of wrapping it in a UI-library anchor component. */
  Link: FunctionComponent<{ to: string; children: ReactNode; className?: string }>;
};

export const NavigationContext: Context<NavigationAdapter | null> =
  createContext<NavigationAdapter | null>(null);

export function useNavigationAdapter(): NavigationAdapter {
  const adapter = useContext(NavigationContext);
  if (!adapter) {
    throw new Error(
      "useNavigationAdapter() called with no NavigationContext.Provider above it — every @metap/platform-ui consumer must provide one.",
    );
  }
  return adapter;
}
