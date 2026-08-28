"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { getMessages } from "@/i18n/messages";
import { translate, formatDateTime, formatDate } from "@/i18n/translate";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  intlLocale,
  resolveLocale,
  type Locale,
} from "@/i18n/types";
import { updateUserLocaleAction } from "@/lib/actions/locale";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatDateTime: (value: string | null | undefined) => string;
  formatDate: (value: string | null | undefined) => string;
  intlTag: string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readCookieLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`)
  );
  const value = match?.[1] ? decodeURIComponent(match[1]) : null;
  return value === "az" || value === "en" || value === "ru" ? value : null;
}

function writeCookieLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
}

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  const { profile, ready, user } = useAuth();
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    if (!ready) return;
    const profileLocale = profile?.locale;
    if (profileLocale) {
      const resolved = resolveLocale(profileLocale);
      setLocaleState(resolved);
      writeCookieLocale(resolved);
      return;
    }
    const cookieLocale = readCookieLocale();
    if (cookieLocale) {
      setLocaleState(cookieLocale);
    }
  }, [ready, profile?.locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    async (next: Locale) => {
      setLocaleState(next);
      writeCookieLocale(next);

      if (user) {
        const result = await updateUserLocaleAction(next);
        if (!result.success) {
          console.warn("Locale profile update failed:", result.error);
        }
      }
    },
    [user]
  );

  const messages = useMemo(() => getMessages(locale), [locale]);
  const intlTag = intlLocale(locale);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(messages, key, params),
      formatDateTime: (value) => formatDateTime(intlTag, value),
      formatDate: (value) => formatDate(intlTag, value),
      intlTag,
    }),
    [locale, setLocale, messages, intlTag]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
