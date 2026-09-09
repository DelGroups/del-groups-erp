"use client";

import React, { useState } from "react";
import { FileCode2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useTaxPayrollConfig } from "@/hooks/useTaxPayrollConfig";
import { eQaimeFormatToFile } from "@/lib/tax/payrollConfig";

interface EQaimeExportButtonProps {
  onExport: (format: "xml" | "json") => void | Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}

export default function EQaimeExportButton({
  onExport,
  disabled,
  compact,
}: EQaimeExportButtonProps) {
  const { t } = useI18n();
  const { config } = useTaxPayrollConfig();
  const defaultFormat = eQaimeFormatToFile(config.e_qaime_export_format);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (format: "xml" | "json") => {
    if (disabled || busy) return;
    setBusy(true);
    try {
      await onExport(format);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setOpen((prev) => !prev)}
        className={
          compact
            ? "rounded-lg p-1.5 text-amber-700 hover:bg-amber-50 disabled:opacity-40"
            : "inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        }
        title={t("tax.eQaimeExport")}
      >
        <FileCode2 className="h-4 w-4" />
        {compact ? null : busy ? t("tax.exporting") : t("tax.eQaimeExport")}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-app bg-app-card shadow-lg">
          <button
            type="button"
            className={`block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-app-card-hover ${
              defaultFormat === "xml" ? "text-app-accent" : ""
            }`}
            onClick={() => void run("xml")}
          >
            {t("taxPayrollSettings.formats.XML_ETAXES")}
          </button>
          <button
            type="button"
            className={`block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-app-card-hover ${
              defaultFormat === "json" ? "text-app-accent" : ""
            }`}
            onClick={() => void run("json")}
          >
            {t("taxPayrollSettings.formats.JSON_STANDARD")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
