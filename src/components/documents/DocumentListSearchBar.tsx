"use client";

import React from "react";
import { RefreshCw, Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import Button from "@/components/ui/button";
import Card from "@/components/ui/card";

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
    <Card className="flex items-center gap-3" padding>
      <Search className="h-4 w-4 shrink-0 text-app-muted" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t("documents.searchDefault")}
        className="h-9 w-full border-none bg-transparent text-sm text-app placeholder:text-app-muted focus:outline-none"
      />
      {onRefresh ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          loading={loading}
          title={t("common.refresh")}
        >
          {loading ? null : <RefreshCw className="h-4 w-4" />}
        </Button>
      ) : null}
    </Card>
  );
}
