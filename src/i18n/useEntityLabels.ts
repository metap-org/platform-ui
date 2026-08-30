import { useCallback, useMemo } from "react";
import { useLocale } from "./LocaleProvider";
import { entityLabelOverrides } from "./entityLabels";

// Must be called inside `LocaleProvider` (same requirement as `useLocale`, which this wraps).
export function useEntityLabels(entityName: string) {
  const { locale } = useLocale();
  const overrides = entityLabelOverrides[locale]?.[entityName];

  // `useCallback` so a caller that passes these down to a `memo`-wrapped child (none does today,
  // but see `platform-ui/docs/audits/01-frontend-performance-audit.md` finding #6) gets a stable
  // reference across renders instead of a fresh closure every time this hook runs.
  const entityLabel = useCallback((fallback: string) => overrides?.entity ?? fallback, [overrides]);
  const fieldLabel = useCallback(
    (fieldName: string, fallback: string) => overrides?.fields?.[fieldName] ?? fallback,
    [overrides],
  );
  const transitionLabel = useCallback(
    (action: string, fallback: string) => overrides?.transitions?.[action] ?? fallback,
    [overrides],
  );

  return useMemo(
    () => ({ entityLabel, fieldLabel, transitionLabel }),
    [entityLabel, fieldLabel, transitionLabel],
  );
}
