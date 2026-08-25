export const LOCALES = ["az", "en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "az";

export const LOCALE_COOKIE = "erp_locale";

export const LOCALE_LABELS: Record<Locale, string> = {
  az: "Azərbaycan",
  en: "English",
  ru: "Русский",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function resolveLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** BCP-47 tag for Intl formatters */
export function intlLocale(locale: Locale): string {
  switch (locale) {
    case "az":
      return "az-AZ";
    case "en":
      return "en-US";
    case "ru":
      return "ru-RU";
  }
}
