import type { ComboboxLabels, DateFieldLabels } from "@/design-system/components";

type T = (key: string, params?: Record<string, string | number>) => string;

/** Texts of DateField / DateTimeField in the current language (src/i18n, group uiStandard.date). */
export function dateFieldLabels(t: T): DateFieldLabels {
  return {
    placeholder: t("uiStandard.date.placeholder"),
    openCalendar: t("uiStandard.date.openCalendar"),
    previousMonth: t("uiStandard.date.previousMonth"),
    nextMonth: t("uiStandard.date.nextMonth"),
    today: t("uiStandard.date.today"),
    clear: t("uiStandard.date.clear"),
  };
}

/** Texts of Combobox in the current language (group uiStandard.combobox). */
export function comboboxLabels(t: T): ComboboxLabels {
  return {
    placeholder: t("uiStandard.combobox.placeholder"),
    search: t("uiStandard.combobox.search"),
    empty: t("uiStandard.combobox.empty"),
    loading: t("uiStandard.combobox.loading"),
    clear: t("uiStandard.combobox.clear"),
  };
}
