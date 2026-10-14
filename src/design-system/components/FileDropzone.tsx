"use client";

import React, { useCallback, useId, useRef, useState } from "react";
import { CheckCircle2, UploadCloud, X } from "lucide-react";
import { checkFile, fileExtension, formatFileSize, type FileRules } from "../logic";

export interface DropzoneLabels {
  drag: string;
  browse: string;
  /** e.g. "PDF, PNG or JPG up to 10 MB" */
  constraints: string;
  tooLarge: string;
  wrongType: string;
  empty: string;
  failed: string;
  retry: string;
  remove: string;
  done: string;
}

/**
 * Sends one file and reports progress (0…1). The dropzone never transfers anything itself:
 * pass the real upload (Supabase Storage, fetch) here.
 */
export type UploadFn = (file: File, onProgress: (fraction: number) => void) => Promise<void>;

interface Row {
  id: number;
  file: File;
  progress: number;
  state: "uploading" | "done" | "error";
  error?: string;
}

/**
 * File upload (reference bonus/bonus-file-upload-dropzone): drop files or browse (keyboard:
 * the zone is a button), checks size and type first, then shows each file with a type badge,
 * size and progress; failed ones can be retried.
 */
export function FileDropzone({ rules, upload, labels, multiple = true }: { rules: FileRules; upload: UploadFn; labels: DropzoneLabels; multiple?: boolean }) {
  const inputId = useId();
  const seq = useRef(0);
  const [over, setOver] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const patch = (id: number, change: Partial<Row>) => setRows((all) => all.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const start = useCallback(
    (row: Row) => {
      patch(row.id, { state: "uploading", progress: 0, error: undefined });
      upload(row.file, (f) => patch(row.id, { progress: Math.min(1, Math.max(0, f)) }))
        .then(() => patch(row.id, { state: "done", progress: 1 }))
        .catch(() => patch(row.id, { state: "error", error: labels.failed }));
    },
    [upload, labels.failed]
  );

  const add = (files: FileList | null) => {
    if (!files) return;
    const list = multiple ? Array.from(files) : Array.from(files).slice(0, 1);
    const fresh: Row[] = list.map((file) => {
      const check = checkFile(file, rules);
      return check.ok
        ? { id: ++seq.current, file, progress: 0, state: "uploading" }
        : { id: ++seq.current, file, progress: 0, state: "error", error: labels[check.reason] };
    });
    setRows((all) => [...all, ...fresh]);
    for (const r of fresh) if (r.state === "uploading") start(r);
  };

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        className="flex cursor-pointer flex-col items-center gap-2 px-6 py-10 text-center transition-colors focus-within:shadow-[var(--ds-focus-ring)]"
        style={{
          border: `1.5px dashed ${over ? "var(--ds-brand)" : "var(--ds-border-strong)"}`,
          borderRadius: "var(--ds-radius-xl)",
          background: over ? "var(--ds-brand-soft)" : "var(--ds-surface)",
          transitionDuration: "var(--ds-duration-fast)",
        }}
      >
        <span className="grid h-11 w-11 place-items-center rounded-[var(--ds-radius-md)]" style={{ background: "var(--ds-surface-sunken)", border: "1px solid var(--ds-border)" }} aria-hidden>
          <UploadCloud className="h-5 w-5" />
        </span>
        <span className="font-semibold">
          {labels.drag} <span className="underline" style={{ color: "var(--ds-brand)" }}>{labels.browse}</span>
        </span>
        <span className="text-[length:var(--ds-text-xs)] ds-muted">{labels.constraints}</span>
        <input
          id={inputId}
          type="file"
          className="sr-only"
          multiple={multiple}
          accept={rules.accept.join(",") || undefined}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {rows.length ? (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {rows.map((r) => (
            <li key={r.id} className="ds-card flex items-center gap-3 px-3 py-2.5" style={{ borderRadius: "var(--ds-radius-md)" }}>
              <span className="ds-chip ds-chip-flat ds-mono uppercase">{fileExtension(r.file.name) || "file"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{r.file.name}</span>
                  <span className="shrink-0 text-[length:var(--ds-text-xs)] ds-muted ds-mono">{formatFileSize(r.file.size)}</span>
                </div>
                {r.state === "error" ? (
                  <p className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }} role="alert">
                    {r.error}{" "}
                    {r.error === labels.failed ? (
                      <button type="button" className="underline" onClick={() => start(r)}>
                        {labels.retry}
                      </button>
                    ) : null}
                  </p>
                ) : r.state === "done" ? (
                  <p className="flex items-center gap-1 text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-success)" }}>
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {labels.done}
                  </p>
                ) : (
                  <div
                    className="ds-track mt-1.5 h-1.5"
                    role="progressbar"
                    aria-label={r.file.name}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(r.progress * 100)}
                  >
                    <div className="h-full" style={{ width: `${Math.round(r.progress * 100)}%`, background: "var(--ds-brand)", transition: "width var(--ds-duration-fast) linear" }} />
                  </div>
                )}
              </div>
              <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" aria-label={`${labels.remove}: ${r.file.name}`} onClick={() => setRows((all) => all.filter((x) => x.id !== r.id))}>
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
