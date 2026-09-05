import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useIsFetching } from "@tanstack/react-query";
import { Badge, Button, IconButton, ToastProvider } from "@metap/ui";
import { useAuth } from "../auth/AuthContext";
import { useHasRole } from "../auth/Can";
import { useCurrentUser } from "../auth/useCurrentUser";
import { useCurrentUserEmail } from "../auth/useTenantUsers";
import { LocaleSwitcher } from "../i18n/LocaleSwitcher";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { ErrorBoundary } from "./ErrorBoundary";
import { AppCommandPalette } from "./AppCommandPalette";

export type ShellNavItem = {
  to: string;
  label: string;
  /** Hidden unless the current user holds one of these roles; visible to everyone if omitted **or
   * empty**. An empty array reads as "no role requirement", not "no one may see this" — the latter
   * was the old behavior purely because `[]` is truthy in JS, which nothing intended
   * (`docs/audits/02-auth-permission-workflow-diagram-audit.md` finding B7). */
  roles?: string[];
};

function NavLink({ item }: { item: ShellNavItem }) {
  const navAdapter = useNavigationAdapter();
  const allowedByRole = useHasRole(item.roles ?? []);

  if (item.roles?.length && !allowedByRole) {
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
 * Mantine `AppShell`-based version onto the `@metap/ui` design system). Also mounts `@metap/ui`'s
 * `ToastProvider` once here, so `GeneratedForm`/`GeneratedList`'s success toasts (and any future
 * `toast(...)` call anywhere under this shell) render without every consumer app wiring its own
 * provider — the same "the library provides it" shape as `AuthContext`/`LocaleProvider`. Also
 * renders `LocaleSwitcher` in the header (2026-09-05) — every `LocaleProvider`-wrapped app already
 * gets working `en`/`vi` translation via `useTranslation()`, but until now nothing actually
 * rendered a way to change it, in any consumer app (`../metap-demo-crm`/`../metap-demo-jira`/
 * `../metap-demo-waf` all wrap `LocaleProvider` yet none mounted `LocaleSwitcher` anywhere). */
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
  const { logout } = useAuth();
  const { data: user } = useCurrentUser();
  // The JWT only carries a user id (`sub`), never email — see `useCurrentUserEmail`'s own doc
  // comment. `useTenantUsers()` underneath fetches the whole tenant user list once (not
  // per-render), so this costs nothing extra beyond what `useCurrentUser` already fetches.
  const email = useCurrentUserEmail();
  const navAdapter = useNavigationAdapter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Any query in-flight anywhere under this shell, not just the current screen's own `Spinner` —
  // `docs/features/23-ux-infrastructure-core.md`'s "global loading state", additive to (not a
  // replacement for) per-screen loading UI.
  const fetchingCount = useIsFetching();

  async function handleLogout() {
    await logout();
    navAdapter.navigate(navAdapter.toLogin());
  }

  return (
    <ToastProvider>
      <div className="min-h-screen bg-background">
        <AppCommandPalette navItems={navItems} />
        {fetchingCount > 0 ? (
          <div
            role="progressbar"
            aria-label={t("shell.loading")}
            className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-primary"
          />
        ) : null}
        <header className="h-[60px] border-b border-border">
          <div className="flex h-full items-center justify-between gap-4 px-4">
            <div className="flex items-center gap-6">
              <navAdapter.Link
                to={navAdapter.toHome()}
                className="font-bold text-foreground no-underline"
              >
                {brand}
              </navAdapter.Link>
              {/* Collapses below `md` — the hamburger toggle right after it takes over.
                  `docs/features/23-ux-infrastructure-core.md`'s "responsive/mobile", previously
                  0 handling here (`frontend-checklist.md`, "gần như chưa có"). */}
              <nav className="hidden items-center gap-4 md:flex">
                {navItems.map((item) => (
                  <NavLink key={item.to} item={item} />
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden w-32 md:block">
                <LocaleSwitcher compact />
              </div>
              {email ? (
                <span className="hidden text-sm text-foreground/70 md:inline">{email}</span>
              ) : null}
              {user ? (
                <div className="hidden items-center gap-1 md:flex">
                  {user.roles.map((role) => (
                    <Badge key={role} variant="outline">
                      {role}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="hidden md:inline-flex"
                onClick={() => void handleLogout()}
              >
                {t("shell.logout")}
              </Button>
              <IconButton
                variant="ghost"
                size="sm"
                className="md:hidden"
                aria-label={t("shell.toggleNav")}
                aria-expanded={mobileNavOpen}
                onClick={() => setMobileNavOpen((open) => !open)}
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="h-5 w-5"
                  >
                    {mobileNavOpen ? (
                      <path d="M6 6l12 12M18 6L6 18" />
                    ) : (
                      <path d="M4 6h16M4 12h16M4 18h16" />
                    )}
                  </svg>
                }
              />
            </div>
          </div>
          {mobileNavOpen ? (
            <div className="border-t border-border px-4 py-3 md:hidden">
              <nav className="flex flex-col gap-3">
                {navItems.map((item) => (
                  <NavLink key={item.to} item={item} />
                ))}
              </nav>
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <LocaleSwitcher compact />
                {email ? <span className="text-sm text-foreground/70">{email}</span> : null}
                <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
                  {t("shell.logout")}
                </Button>
              </div>
            </div>
          ) : null}
        </header>
        <main className="p-4">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </ToastProvider>
  );
}
