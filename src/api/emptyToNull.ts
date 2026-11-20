/** The admin REST API (metap's adminapi) sends an absent optional string as `""`; this app's
 *  types say `null` for it. Returns `value` with each of `keys` that is `""` set to `null`. */
export function emptyToNull<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  const out = { ...value } as Record<keyof T, unknown>;
  for (const key of keys) {
    if (out[key] === "") out[key] = null;
  }
  return out as T;
}
