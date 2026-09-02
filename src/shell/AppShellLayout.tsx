import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button } from "@metap/ui";
import { useAuth } from "../auth/AuthContext";
import { useHasRole } from "../auth/Can";
import { useCurrentUser } from "../auth/useCurrentUser";
import { useCurrentUserEmail } from "../auth/useTenantUsers";
import { useNavigationAdapter } from "../navigation/NavigationContext";

export type ShellNavItem = {
  to: string;
  label: string;
  /** Hidden unless the current user holds one of these roles; visible to everyone if omitted. */
  roles?: string[];
};

function NavLink({ item }: { item: ShellNavItem }) {
  const navAdapter = useNavigationAdapter();
  const allowedByRole = useHasRole(item.roles ?? []);

  if (item.roles && !allowedByRole) {
    return null;
  }

  return (
    <navAdapter.Link
      to={item.to}
      className="text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
    >
      {item.label}
    </navAdapter.Link>
  );
}

/** The shared page chrome every `@metap/platform-ui` consumer app assembles its authenticated
 * routes into, instead of hand-rolling header/nav per app (ported from `packages/platform-react`'s
 * Mantine `AppShell`-based version onto the `@metap/ui` design system). */
export function AppShellLayout({
  brand,
  navItems,
  children,
}: {
  brand: string;
  navItems: ShellNavItem[];
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setToken } = useAuth();
  const { data: user } = useCurrentUser();
  // The JWT only carries a user id (`sub`), never email — see `useCurrentUserEmail`'s own doc
  // comment. `useTenantUsers()` underneath fetches the whole tenant user list once (not
  // per-render), so this costs nothing extra beyond what `useCurrentUser` already fetches.
  const email = useCurrentUserEmail();
  const navAdapter = useNavigationAdapter();

  function handleLogout() {
    setToken(null);
    navAdapter.navigate(navAdapter.toLogin());
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="h-[60px] border-b border-border">
        <div className="flex h-full items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <navAdapter.Link
              to={navAdapter.toHome()}
              className="font-bold text-foreground no-underline"
            >
              {brand}
            </navAdapter.Link>
            <nav className="flex items-center gap-4">
              {navItems.map((item) => (
                <NavLink key={item.to} item={item} />
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {email ? <span className="text-sm text-foreground/70">{email}</span> : null}
            {user ? (
              <div className="flex items-center gap-1">
                {user.roles.map((role) => (
                  <Badge key={role} variant="outline">
                    {role}
                  </Badge>
                ))}
              </div>
            ) : null}
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              {t("shell.logout")}
            </Button>
          </div>
        </div>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
