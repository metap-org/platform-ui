import type { FieldKind } from "../metadata/types";

const numberFormatter = new Intl.NumberFormat();
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

// value is `unknown` (it's whatever came back in a record's JSONB `data`
// blob) — String(unknown) risks "[object Object]" for a non-primitive, so
// every fallback here narrows explicitly instead of calling String() on an
// untyped value.
function safeString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatNumber(value: unknown): string {
  return typeof value === "number" ? numberFormatter.format(value) : safeString(value);
}

/** A `FieldKind -> formatter` map rather than a `switch` — adding a new `FieldKind` means adding
 *  one entry here instead of finding and editing every `switch (kind)` in the package. Also keeps
 *  this file exhaustive over `FieldKind` the same way the old `switch` was: TypeScript errors if a
 *  key is missing (`Record<FieldKind, ...>`), same guarantee a non-exhaustive `switch` doesn't
 *  give. See `platform-ui/docs/audits/01-frontend-performance-audit.md` finding #7 — a low-code
 *  UI builder will want to enumerate "available widgets" dynamically, which a `switch` can't do. */
const FORMATTERS: Record<FieldKind, (value: unknown) => string> = {
  number: formatNumber,
  money: formatNumber,
  boolean: (value) => (value ? "Yes" : "No"),
  date: (value) =>
    typeof value === "string" ? dateFormatter.format(new Date(value)) : safeString(value),
  datetime: (value) =>
    typeof value === "string" ? dateTimeFormatter.format(new Date(value)) : safeString(value),
  json: (value) => JSON.stringify(value),
  id: safeString,
  string: safeString,
  reference: safeString,
  enum: safeString,
};

export function formatFieldValue(kind: FieldKind, value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return FORMATTERS[kind](value);
}
