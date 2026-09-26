import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { graphqlFetch } from "../api/graphqlClient";
import { useAuth } from "../auth/AuthContext";
import { i18n } from "./i18n";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./resources";

type LocaleContextValue = {
  locale: string;
  setLocale: (locale: string) => Promise<void>;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

function isSupportedLocale(value: string): value is (typeof SUPPORTED_LOCALES)[number] {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// Must be nested inside `AuthProvider` — reads `status` to gate loading/persisting the caller's
// locale (`myPreferences`/`setMyPreferences` GraphQL fields, `/preferences`'s replacement since
// 2026-09-26 — `metap-graphql-http::platform_fields`) until a session (cookie-based since
// 2026-09-03) actually exists. Also wraps `I18nextProvider` so any consumer of `platform-ui` gets
// a working `useTranslation()` without wiring i18next itself.
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [locale, setLocaleState] = useState<string>(DEFAULT_LOCALE);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }
    let cancelled = false;
    graphqlFetch<{ myPreferences: { locale: string } }>("/graphql", "{ myPreferences { locale } }")
      .then((response) => {
        if (!cancelled && isSupportedLocale(response.myPreferences.locale)) {
          setLocaleState(response.myPreferences.locale);
          void i18n.changeLanguage(response.myPreferences.locale);
        }
      })
      .catch(() => {
        // No preference saved yet, or the request failed — not user-facing, keep whatever
        // locale is already active.
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const setLocale = useCallback(
    async (next: string) => {
      setLocaleState(next);
      await i18n.changeLanguage(next);
      if (status === "authenticated") {
        await graphqlFetch(
          "/graphql",
          "mutation($locale: String!) { setMyPreferences(locale: $locale) { locale } }",
          { locale: next },
        );
      }
    },
    [status],
  );

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <I18nextProvider i18n={i18n}>
      <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
    </I18nextProvider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }

  return context;
}
