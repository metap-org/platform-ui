// `Intl` formatters are expensive to construct (`toLocaleString(locale, options)` builds a new
// DateTimeFormat on every call), and these helpers run once per row or cell in lists. Build each
// formatter once per locale and options and reuse it.
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
function dateTimeFormat(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${JSON.stringify(options)}`;
  let format = dateTimeFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateTimeFormats.set(key, format);
  }
  return format;
}

const relativeTimeFormats = new Map<string, Intl.RelativeTimeFormat>();
function relativeTimeFormat(locale: string): Intl.RelativeTimeFormat {
  let format = relativeTimeFormats.get(locale);
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeTimeFormats.set(locale, format);
  }
  return format;
}

const FULL_DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};

/** A full date and time in the UI locale (what `toLocaleString()` gives, without rebuilding the
 *  formatter on every call): a row's absolute time in a `title`, an audit entry's timestamp. */
export function formatDateTime(value: string | number | Date, locale?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTimeFormat(locale, FULL_DATE_TIME).format(date);
}

/** `2026-09-03T10:00:00Z` -> `Sep 3, 10:00`. For an already-truncated bucket timestamp (e.g. a
 *  time-series axis label), so only has to be short enough to fit an axis, not a full date.
 *  Moved here from `metap-demo-waf/data-plane/web` (2026-09-05, `docs/features/
 *  26-waf-primitives-to-design-system.md`) — pure formatting, no business vocabulary. */
export function shortDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Same as `shortDate` but date-only (no time-of-day) — a day-bucketed axis label. */
export function dayLabel(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
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
  const format = relativeTimeFormat(locale);
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(seconds, "second");
}
