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
