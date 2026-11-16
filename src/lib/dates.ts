/** `2026-09-03T10:00:00Z` -> `Sep 3, 10:00`. For an already-truncated bucket timestamp (e.g. a
 *  time-series axis label), so only has to be short enough to fit an axis, not a full date.
 *  Moved here from `metap-demo-waf/data-plane/web` (2026-09-05, `docs/features/
 *  26-waf-primitives-to-design-system.md`) — pure formatting, no business vocabulary. */
export function shortDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Same as `shortDate` but date-only (no time-of-day) — a day-bucketed axis label. */
export function dayLabel(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "5 minutes ago" in the UI locale; the absolute time goes in the cell's title. */
export function relativeTime(iso: string, locale: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(seconds, "second");
}
