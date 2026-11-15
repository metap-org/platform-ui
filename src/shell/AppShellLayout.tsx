import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useIsFetching } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Select,
  Sheet,
  SheetContent,
  SheetTitle,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
  ToastProvider,
  toast,
} from "@metap/ui";
import {
  useImpersonationActions,
  useImpersonationStatus,
  usePlatformTenants,
} from "../admin/impersonation";
import { useAuth } from "../auth/AuthContext";
import { useHasRole } from "../auth/Can";
import { useEntityDenied, type EntityAccessAction } from "../auth/useEntityAccess";
import { useCurrentUser } from "../auth/useCurrentUser";
import { useCurrentUserEmail } from "../auth/useTenantUsers";
import { ApiError } from "../api/client";
import { LocaleSwitcher } from "../i18n/LocaleSwitcher";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import { ErrorBoundary } from "./ErrorBoundary";
import { AppCommandPalette } from "./AppCommandPalette";

/** Platform-admin-only — only ever rendered once `useHasRole("platform_admin")` is true, which
 *  itself is only ever true while *not* impersonating (see `useImpersonationStatus`'s doc
 *  comment), so this and the banner below are mutually exclusive in practice. */
function TenantSwitcher() {
  const { t } = useTranslation();
  const { data: tenants } = usePlatformTenants(true);
  const { startImpersonation } = useImpersonationActions();

  async function handleSelect(tenantId: string | undefined) {
    if (!tenantId) return;
    try {
      await startImpersonation(tenantId);
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : String(error);
      toast(t("shell.impersonationFailed", { detail }), { variant: "destructive" });
    }
  }

  return (
    <Select
      className="h-9 w-40 text-sm"
      placeholder={t("shell.viewAsTenant")}
      options={(tenants ?? []).map((tenant) => ({ value: tenant.id, label: tenant.id }))}
      onValueChange={(value) => void handleSelect(value)}
    />
  );
}

/** Persistent, impossible-to-miss reminder while impersonating — the whole reason `useHasRole`
 *  can't be trusted to show this (roles reflect the *target* tenant during impersonation, not
 *  `platform_admin`), see `useImpersonationStatus`'s doc comment. */
function ImpersonationBanner() {
  const { t } = useTranslation();
  const { data: currentUser } = useCurrentUser();
  const { exitImpersonation } = useImpersonationActions();
  const [exiting, setExiting] = useState(false);

  async function handleExit() {
    setExiting(true);
    try {
      await exitImpersonation();
    } finally {
      setExiting(false);
    }
  }

  return (
    <Alert className="flex items-center justify-between gap-3 rounded-none border-x-0 border-t-0 border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
      <span className="text-sm font-medium">
        {t("shell.impersonatingBanner", { tenantId: currentUser?.tenantId ?? "" })}
      </span>
      <Button variant="outline" size="sm" loading={exiting} onClick={() => void handleExit()}>
        {t("shell.exitImpersonation")}
      </Button>
    </Alert>
  );
}

export type ShellNavItem = {
  to: string;
  label: string;
  /** Sidebar section heading. Consecutive items with the same `group` render under one heading,
   *  in the order given; items without one render first, under no heading. */
  group?: string;
  /** Shown before the label, and alone when the sidebar is collapsed (initials otherwise). */
  icon?: ReactNode;
  /** Hidden unless the current user holds one of these roles; visible to everyone if omitted **or
   * empty**. An empty array reads as "no role requirement", not "no one may see this" — the latter
   * was the old behavior purely because `[]` is truthy in JS, which nothing intended
   * (`docs/audits/02-auth-permission-workflow-diagram-audit.md` finding B7). */
  roles?: string[];
  /** Hidden when the access map says the caller may not `entityAction` (default `read`) this
   * entity — entity-level policy, so an entry does not lead to a screen that would only answer 403.
   * Needs no role list. Shown while the map loads or when it does not list the entity
   * (`useEntityDenied`), so an unreachable map never empties the menu. */
  entity?: string;
  entityAction?: EntityAccessAction;
};

/** `/` is active only on itself; any other entry also on its sub-paths (`/zones/:id`). */
function isActivePath(pathname: string | undefined, to: string): boolean {
  if (!pathname) return false;
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

function NavItem({ item, onNavigate }: { item: ShellNavItem; onNavigate?: () => void }) {
  const navAdapter = useNavigationAdapter();
  const allowedByRole = useHasRole(item.roles ?? []);
  const deniedByEntity = useEntityDenied(item.entity ?? "", item.entityAction ?? "read");

  if (item.roles?.length && !allowedByRole) {
    return null;
  }
  if (item.entity && deniedByEntity) {
    return null;
  }

  return (
    <SidebarItem
      asChild
      label={item.label}
      icon={item.icon}
      active={isActivePath(navAdapter.pathname, item.to)}
      onClick={onNavigate}
    >
      <navAdapter.Link to={item.to}>{null}</navAdapter.Link>
    </SidebarItem>
  );
}

/** Splits nav items into consecutive runs by `group`, keeping the caller's order. */
function groupNavItems(items: ShellNavItem[]): { label?: string; items: ShellNavItem[] }[] {
  const groups: { label?: string; items: ShellNavItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.group) last.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }
  return groups;
}

function NavGroups({ items, onNavigate }: { items: ShellNavItem[]; onNavigate?: () => void }) {
  return (
    <>
      {groupNavItems(items).map((group, index) => (
        <SidebarGroup key={`${group.label ?? ""}-${index}`} label={group.label}>
          {group.items.map((item) => (
            <NavItem key={item.to} item={item} onNavigate={onNavigate} />
          ))}
        </SidebarGroup>
      ))}
    </>
  );
}

const COLLAPSED_STORAGE_KEY = "metap.shell.sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage blocked (private mode, policy): the toggle still works for this page view.
  }
}

function ChevronIcon({ left }: { left: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-4 w-4"
    >
      <path d={left ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-5 w-5"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

/** Email, roles and logout behind one button, instead of spreading them across the top bar. */
function AccountMenu({ onLogout }: { onLogout: () => void }) {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const email = useCurrentUserEmail();
  const name = email ?? user?.userId ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("shell.userMenu")} className="gap-2">
          <span
            aria-hidden
            className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
          >
            {name.slice(0, 2).toUpperCase() || "?"}
          </span>
          <span className="hidden max-w-[12rem] truncate text-sm lg:inline">{name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate text-sm font-medium">{name}</span>
          {user?.roles.length ? (
            <span className="flex flex-wrap gap-1">
              {user.roles.map((role) => (
                <Badge key={role} variant="outline" className="font-normal">
                  {role}
                </Badge>
              ))}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <LocaleSwitcher compact />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>{t("shell.logout")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The shared page chrome every `@metap/platform-ui` consumer app assembles its authenticated
 * routes into, instead of hand-rolling header/nav per app. Layout (2026-11-15): a collapsible left
 * sidebar holds the navigation, grouped by `ShellNavItem.group` (a top bar ran out of width once a
 * product had more than a handful of sections); a slim top bar keeps only the tenant switcher and
 * the account menu (email, roles, language, logout); on small screens the sidebar opens as a
 * sheet from the left. Also mounts `@metap/ui`'s `ToastProvider` once here, so
 * `GeneratedForm`/`GeneratedList`'s success toasts (and any `toast(...)` under this shell) render
 * without every consumer app wiring its own provider. */
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
  const navAdapter = useNavigationAdapter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Any query in-flight anywhere under this shell, not just the current screen's own `Spinner` —
  // `docs/features/23-ux-infrastructure-core.md`'s "global loading state", additive to (not a
  // replacement for) per-screen loading UI.
  const fetchingCount = useIsFetching();
  const isPlatformAdmin = useHasRole("platform_admin");
  const { data: impersonationStatus } = useImpersonationStatus();
  const isImpersonating = impersonationStatus?.impersonating === true;

  async function handleLogout() {
    await logout();
    navAdapter.navigate(navAdapter.toLogin());
  }

  function toggleCollapsed() {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  }

  const brandLink = (
    <navAdapter.Link
      to={navAdapter.toHome()}
      className="truncate px-1 text-sm font-bold text-foreground no-underline"
    >
      {brand}
    </navAdapter.Link>
  );

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <AppCommandPalette navItems={navItems} />
        {fetchingCount > 0 ? (
          <div
            role="progressbar"
            aria-label={t("shell.loading")}
            className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-primary"
          />
        ) : null}

        <Sidebar collapsed={collapsed} className="hidden md:flex">
          <SidebarHeader className={collapsed ? "justify-center" : "justify-between"}>
            {collapsed ? null : brandLink}
            <IconButton
              variant="ghost"
              size="sm"
              className="h-8 w-8"
              aria-label={collapsed ? t("shell.expandNav") : t("shell.collapseNav")}
              onClick={toggleCollapsed}
              icon={<ChevronIcon left={!collapsed} />}
            />
          </SidebarHeader>
          <SidebarContent>
            <NavGroups items={navItems} />
          </SidebarContent>
        </Sidebar>

        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-64 max-w-[80vw] gap-0 p-0">
            <SheetTitle className="sr-only">{brand}</SheetTitle>
            <Sidebar className="w-full border-r-0">
              <SidebarHeader>{brandLink}</SidebarHeader>
              <SidebarContent>
                <NavGroups items={navItems} onNavigate={() => setMobileNavOpen(false)} />
              </SidebarContent>
              <SidebarFooter>
                <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
                  {t("shell.logout")}
                </Button>
              </SidebarFooter>
            </Sidebar>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
            <div className="flex min-w-0 items-center gap-2">
              <IconButton
                variant="ghost"
                size="sm"
                className="md:hidden"
                aria-label={t("shell.toggleNav")}
                aria-expanded={mobileNavOpen}
                onClick={() => setMobileNavOpen(true)}
                icon={<MenuIcon />}
              />
              <div className="md:hidden">{brandLink}</div>
            </div>
            <div className="flex items-center gap-2">
              {isPlatformAdmin && !isImpersonating ? (
                <div className="hidden md:block">
                  <TenantSwitcher />
                </div>
              ) : null}
              <AccountMenu onLogout={() => void handleLogout()} />
            </div>
          </header>
          {isImpersonating ? <ImpersonationBanner /> : null}
          <main className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
