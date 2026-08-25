"use client";

import React from "react";
import { RefreshCw, Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface DocumentListSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onRefresh?: () => void;
  loading?: boolean;
}

export default function DocumentListSearchBar({
  value,
  onChange,
  placeholder,
  onRefresh,
  loading,
}: DocumentListSearchBarProps) {
  const { t } = useI18n();

  return (
    <div className="app-card app-card-elevated flex items-center gap-3 p-4">
      <Search className="h-4 w-4 shrink-0 text-app-muted" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t("documents.searchDefault")}
        className="w-full border-none bg-transparent text-xs text-app placeholder:text-app-muted focus:outline-none"
      />
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="btn-ghost !p-2"
          title={t("common.refresh")}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      )}
    </div>
  );
}
