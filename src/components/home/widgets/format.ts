"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { formatFigure } from "@/design-system/logic";
import { dateFormat } from "@/lib/dates/localeDate";

/** Amounts in AZN and plain counts, in the user's locale (formatFigure). */
export function useFigures() {
  const { t, locale } = useI18n();
  return {
    t,
    locale,
    money: (n: number | null | undefined, decimals = 0) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? "—" : `${formatFigure(Number(n), decimals, locale)} AZN`),
    count: (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatFigure(Number(n), 0, locale)),
    staleNote: (at: string | undefined, stale: boolean | undefined) =>
      stale && at ? t("home.staleSince", { time: dateFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(at)) }) : null,
  };
}
