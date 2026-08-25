"use client";

import React, { useCallback, useState } from "react";
import { Upload } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface FileDropzoneProps {
  accept?: string;
  onFile: (file: File) => void | Promise<void>;
  disabled?: boolean;
  label?: string;
  hint?: string;
}

export default function FileDropzone({
  accept = ".csv,.xlsx,.xls,.json",
  onFile,
  disabled,
  label,
  hint,
}: FileDropzoneProps) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || disabled) return;
      await onFile(files[0]);
    },
    [disabled, onFile]
  );

  return (
    <label
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-colors duration-300 ${
        dragging
          ? "border-[color:var(--app-accent)] bg-[color:var(--app-accent-soft)]"
          : "border-app bg-app-card-hover hover:border-[color:var(--app-border-hover)]"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      <Upload className="mb-3 h-8 w-8 text-app-accent" />
      <span className="text-sm font-semibold text-app">
        {label || t("initialSetup.dropzoneLabel")}
      </span>
      <span className="mt-1 text-xs text-app-muted">
        {hint || t("initialSetup.dropzoneHint")}
      </span>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </label>
  );
}
