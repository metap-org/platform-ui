import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useIsFetching } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
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
import { changePassword, switchTenant, tenantLabel, useMyTenants } from "../auth/accountApi";
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

/** Moves the session to another tenant of the signed-in person (roadmap 113). Rendered only for
 *  a person in more than one tenant. */
function TenantSwitcher() {
  const { t } = useTranslation();
  const { data: tenants } = useMyTenants();
  const current = tenants?.find((tenant) => tenant.current);

  if (!tenants || tenants.length < 2) return null;

  async function handleSelect(tenantId: string) {
    if (tenantId === current?.tenantId) return;
    try {
      await switchTenant(tenantId);
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : String(error);
      toast(t("shell.switchFailed", { detail }), { variant: "destructive" });
    }
  }

  return (
    <Select
      className="h-8 w-44 text-sm"
      aria-label={t("shell.switchTenant")}
      value={current?.tenantId}
      options={tenants.map((tenant) => ({
        value: tenant.tenantId,
        label: tenantLabel(tenant, (id) => t("shell.unnamedTenant", { id })),
      }))}
      onValueChange={(value) => void handleSelect(value)}
    />
  );
}

const PASSWORD_ERROR_KEYS: Record<string, string> = {
  wrong_password: "shell.wrongPassword",
  weak_password: "shell.weakPassword",
};

function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset(nextOpen: boolean) {
    if (!nextOpen) {
      setCurrent("");
      setNext("");
      setRepeat("");
      setError(null);
    }
    onOpenChange(nextOpen);
  }

  async function handleSave() {
    if (next !== repeat) {
      setError(t("shell.passwordMismatch"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changePassword(current, next);
      toast(t("shell.passwordChanged"));
      reset(false);
    } catch (err) {
      const key = err instanceof ApiError ? PASSWORD_ERROR_KEYS[err.code] : undefined;
      setError(
        key ? t(key) : err instanceof ApiError ? err.message : t("common.somethingWentWrong"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("shell.changePassword")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Input
            label={t("shell.currentPassword")}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.currentTarget.value)}
          />
          <Input
            label={t("shell.newPassword")}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.currentTarget.value)}
          />
          <Input
            label={t("shell.confirmPassword")}
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.currentTarget.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => reset(false)}>
            {t("shell.cancel")}
          </Button>
          <Button
            loading={saving}
            disabled={!current || !next || !repeat}
            onClick={() => void handleSave()}
          >
            {t("shell.changePassword")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
function AccountMenu({
  onLogout,
  accountSecurityPath,
  localeSwitcher,
}: {
  onLogout: () => void;
  accountSecurityPath: string | null;
  localeSwitcher: boolean;
}) {
  const { t } = useTranslation();
  const navAdapter = useNavigationAdapter();
  const { data: user } = useCurrentUser();
  const email = useCurrentUserEmail();
  const name = email ?? user?.userId ?? "";
  const [passwordOpen, setPasswordOpen] = useState(false);

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
        {localeSwitcher ? (
          <>
            <div className="px-2 py-1.5">
              <LocaleSwitcher compact />
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {accountSecurityPath ? (
          <DropdownMenuItem onSelect={() => navAdapter.navigate(accountSecurityPath)}>
            {t("shell.accountSecurity")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
          {t("shell.changePassword")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout}>{t("shell.logout")}</DropdownMenuItem>
      </DropdownMenuContent>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
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
  brandLabel,
  navItems,
  children,
  accountSecurityPath = "/account/security",
  localeSwitcher = true,
}: {
  /** The product's mark: a name, or a logo with a name. A string is also its accessible label. */
  brand: ReactNode;
  /** Accessible name when `brand` is not a plain string (a logo has none of its own). */
  brandLabel?: string;
  navItems: ShellNavItem[];
  children: ReactNode;
  /** Where the account menu's "Account security" entry goes (mount `AccountSecurityPage` there);
   *  `null` hides the entry. */
  accountSecurityPath?: string | null;
  /** Show the language switcher in the account menu (default). A product that offers it on its
   *  own settings screen turns this off and renders `LocaleSwitcher` there. */
  localeSwitcher?: boolean;
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

  const brandName = brandLabel ?? (typeof brand === "string" ? brand : undefined);
  // The same mark sits on the navigation rail (whose text color is the rail's own token, since a
  // theme may make the rail dark) and on the page-colored top bar on small screens.
  const brandLink = (onRail: boolean) => (
    <navAdapter.Link
      to={navAdapter.toHome()}
      aria-label={brandName}
      className={`flex min-w-0 items-center gap-2 truncate px-1 text-sm font-bold no-underline ${
        onRail ? "text-sidebar-accent-foreground" : "text-foreground"
      }`}
    >
      {brand}
    </navAdapter.Link>
  );
  // Buttons that live on the rail take its colors, not the page's.
  const railButton =
    "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

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
            {collapsed ? null : brandLink(true)}
            <IconButton
              variant="ghost"
              size="sm"
              className={`h-8 w-8 ${railButton}`}
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
            <SheetTitle className="sr-only">{brandName}</SheetTitle>
            <Sidebar className="w-full border-r-0">
              <SidebarHeader>{brandLink(true)}</SidebarHeader>
              <SidebarContent>
                <NavGroups items={navItems} onNavigate={() => setMobileNavOpen(false)} />
              </SidebarContent>
              <SidebarFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  className={railButton}
                  onClick={() => void handleLogout()}
                >
                  {t("shell.logout")}
                </Button>
              </SidebarFooter>
            </Sidebar>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3">
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
              <div className="md:hidden">{brandLink(false)}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden md:block">
                <TenantSwitcher />
              </div>
              <AccountMenu
                onLogout={() => void handleLogout()}
                accountSecurityPath={accountSecurityPath}
                localeSwitcher={localeSwitcher}
              />
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
