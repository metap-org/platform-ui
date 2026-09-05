import { useEffect, useMemo, useState } from "react";
import { CommandPalette } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useCurrentUser } from "../auth/useCurrentUser";
import { useNavigationAdapter } from "../navigation/NavigationContext";
import type { ShellNavItem } from "./AppShellLayout";

/** `Cmd/Ctrl+K` opens a palette listing every nav item the current user can see, same role
 *  filtering `NavLink` already applies — `docs/features/24-command-palette-and-state-
 *  persistence.md`'s v1 scope (navigation only, no entity/record search, no persisted recent
 *  items). Mounted once by `AppShellLayout`, same as `ErrorBoundary`/the global loading
 *  indicator, so every consumer app gets it for free without wiring anything itself. */
export function AppCommandPalette({ navItems }: { navItems: ShellNavItem[] }) {
  const { t } = useTranslation();
  const navAdapter = useNavigationAdapter();
  const { data: user } = useCurrentUser();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const items = useMemo(
    () =>
      navItems
        .filter((item) => !item.roles?.length || item.roles.some((r) => user?.roles.includes(r)))
        .map((item) => ({ id: item.to, label: item.label })),
    [navItems, user],
  );

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      items={items}
      onSelect={(to) => navAdapter.navigate(to)}
      placeholder={t("shell.commandPalettePlaceholder")}
      emptyMessage={t("shell.commandPaletteEmpty")}
    />
  );
}
