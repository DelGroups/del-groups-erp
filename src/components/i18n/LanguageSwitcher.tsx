"use client";

import React from "react";
import { Globe } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { LOCALE_LABELS, LOCALES, type Locale } from "@/i18n/types";

interface LanguageSwitcherProps {
  compact?: boolean;
}

export default function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useI18n();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    void setLocale(e.target.value as Locale);
  };

  if (compact) {
    return (
      <select
        value={locale}
        onChange={handleChange}
        title={t("nav.language")}
        aria-label={t("nav.language")}
        className="sidebar-select w-full"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-1">
      <label className="sidebar-label flex items-center gap-1.5">
        <Globe className="h-3 w-3" />
        {t("nav.language")}
      </label>
      <select value={locale} onChange={handleChange} className="sidebar-select w-full">
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
