import { Select } from "@metap/ui";
import { useTranslation } from "react-i18next";
import { useLocale } from "./LocaleProvider";
import { SUPPORTED_LOCALES } from "./resources";

const LOCALE_LABELS: Record<string, string> = { en: "English", vi: "Tiếng Việt" };

/** `compact` drops the visible "Language" label (kept as `aria-label` instead) for a header-sized
 * widget — used by `AppShellLayout` so every consumer app gets a locale switcher in its chrome for
 * free, same reasoning as that component mounting `ToastProvider` once for everyone. A dedicated
 * preferences screen wanting the labelled, full-size version can still render this with
 * `compact={false}` (the default). */
export function LocaleSwitcher({ compact = false }: { compact?: boolean } = {}) {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();

  return (
    <Select
      label={compact ? undefined : t("preferences.locale")}
      aria-label={compact ? t("preferences.locale") : undefined}
      options={SUPPORTED_LOCALES.map((code) => ({
        value: code,
        label: LOCALE_LABELS[code] ?? code,
      }))}
      value={locale}
      onValueChange={(value) => void setLocale(value)}
    />
  );
}
