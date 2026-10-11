import { cookies } from "next/headers";
import { DEFAULT_LOCALE, MESSAGES, isLocale, translate, type Locale, type Messages } from "./messages";

export const LOCALE_COOKIE = "cp_locale";

export interface I18n {
  locale: Locale;
  messages: Messages;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/** The admin's chosen language (cookie), az by default. */
export async function getI18n(): Promise<I18n> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(value) ? value : DEFAULT_LOCALE;
  const messages = MESSAGES[locale];
  return { locale, messages, t: (key, vars) => translate(messages, key, vars) };
}
