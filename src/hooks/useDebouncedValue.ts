import { useEffect, useState } from "react";

/** No `@mantine/hooks`-equivalent utility package for this — `@metap/ui` is deliberately scoped to
 * components (Tailwind/Radix/shadcn), not general hooks (see that repo's `docs/component-status.md`
 * infra-debt table, 2026-08-31 entry: a pure logic hook with no rendering was tried there once and
 * reverted, since it doesn't fall under the "component/styling" boundary between the two repos).
 * Lives here instead — the single shared copy for both call sites that used to hand-roll their own
 * (`field/ReferenceFieldInput.tsx`, `list/GeneratedList.tsx`). Under `hooks/`, not `shared/` — this
 * whole package already *is* the "shared" layer, so a `shared/` subfolder inside it is redundant;
 * `hooks/` names what the thing actually is instead. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
