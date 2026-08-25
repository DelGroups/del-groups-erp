import type { Locale } from "@/i18n/types";
import { azMessages } from "./az";
import { enMessages } from "./en";
import { ruMessages } from "./ru";
import type { Messages } from "./az";

const catalogs: Record<Locale, Messages> = {
  az: azMessages,
  en: enMessages,
  ru: ruMessages,
};

export function getMessages(locale: Locale): Messages {
  return catalogs[locale] ?? azMessages;
}

export { azMessages, enMessages, ruMessages };
export type { Messages };
