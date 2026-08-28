"use client";

import React, { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { LOCALE_LABELS, LOCALES, type Locale } from "@/i18n/types";

interface LanguageSwitcherProps {
  compact?: boolean;
}

export default function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useI18n();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    void setLocale(e.target.value as Locale);
  };

  if (!mounted) {
    return compact ? (
      <div className="sidebar-select h-9 w-full" aria-hidden />
    ) : (
      <div className="space-y-1" aria-hidden>
        <div className="sidebar-label h-3 w-16 rounded bg-app-card-hover" />
        <div className="sidebar-select h-9 w-full" />
      </div>
    );
  }

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
      <p className="sidebar-label flex items-center gap-1.5">
        <Globe className="h-3 w-3" />
        {t("nav.language")}
      </p>
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
