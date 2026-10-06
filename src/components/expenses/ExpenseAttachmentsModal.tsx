"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/lib/supabase";
import {
  confirmExpenseAttachmentAction,
  createExpenseAttachmentUploadAction,
  deleteExpenseAttachmentAction,
  listExpenseAttachmentsAction,
} from "@/lib/actions/expenses";
import {
  normalizeAttachmentMime,
  validateExpenseAttachment,
  type ExpenseAttachment,
  type ExpenseDocument,
} from "@/lib/expenses/expenseDocuments";

const BUCKET = "expense-attachments";

interface Props {
  expense: ExpenseDocument;
  canUpload: boolean;
  /** Finance may remove receipts of booked documents too. */
  canDeleteBooked: boolean;
  onClose: () => void;
  /** Called with the new count after an upload or delete. */
  onChanged: (count: number) => void;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function ExpenseAttachmentsModal({
  expense,
  canUpload,
  canDeleteBooked,
  onClose,
  onChanged,
}: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<ExpenseAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = expense.status === "draft" || expense.status === "submitted";
  const canAdd = canUpload && expense.status !== "cancelled";
  const canDelete = canUpload && (open || canDeleteBooked);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listExpenseAttachmentsAction(expense.id);
    if (res.success) {
      setItems(res.data || []);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, [expense.id]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const uploadOne = async (file: File): Promise<string | null> => {
    const type = normalizeAttachmentMime(file.type);
    const invalid = validateExpenseAttachment({ type, size: file.size });
    if (invalid) return `${file.name}: ${invalid}`;

    const ticket = await createExpenseAttachmentUploadAction(expense.id, {
      name: file.name,
      type,
      size: file.size,
    });
    if (!ticket.success || !ticket.data) {
      return `${file.name}: ${ticket.success ? t("common.error") : ticket.error}`;
    }
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: type });
    if (uploadError) return `${file.name}: ${uploadError.message}`;

    const saved = await confirmExpenseAttachmentAction(expense.id, ticket.data.path, file.name);
    return saved.success ? null : `${file.name}: ${saved.error}`;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      const failed = await uploadOne(file);
      if (failed) errors.push(failed);
    }
    if (inputRef.current) inputRef.current.value = "";
    setUploading(false);
    if (errors.length) setError(errors.join("\n"));
    const res = await listExpenseAttachmentsAction(expense.id);
    if (res.success) {
      setItems(res.data || []);
      onChanged((res.data || []).length);
    }
  };

  const handleDelete = async (item: ExpenseAttachment) => {
    if (!window.confirm(t("expenses.doc.attachmentDeleteConfirm", { name: item.file_name }))) return;
    setError(null);
    const res = await deleteExpenseAttachmentAction(item.id);
    if (!res.success) {
      setError(res.error);
      return;
    }
    const next = items.filter((i) => i.id !== item.id);
    setItems(next);
    onChanged(next.length);
  };

  return (
    <div className="app-modal-overlay">
      <div className="app-modal w-full max-w-lg">
        <div className="app-modal-header flex items-center justify-between bg-app-card-hover">
          <h3 className="font-bold text-app">{t("expenses.doc.attachmentsTitle", { code: expense.code })}</h3>
          <button type="button" onClick={onClose} className="text-app-muted hover:text-app">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-6">
          {loading ? (
            <div className="py-6 text-center text-sm text-app-muted">{t("common.loading")}</div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center text-sm text-app-muted">{t("expenses.doc.attachmentsEmpty")}</div>
          ) : (
            <ul className="divide-y rounded-lg border border-app">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  {item.mime_type === "application/pdf" ? (
                    <FileText className="h-4 w-4 shrink-0 text-rose-600" />
                  ) : (
                    <ImageIcon className="h-4 w-4 shrink-0 text-sky-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-semibold text-app hover:underline"
                      >
                        {item.file_name}
                      </a>
                    ) : (
                      <span className="block truncate font-semibold text-app">{item.file_name}</span>
                    )}
                    <span className="text-[11px] text-app-muted">
                      {formatSize(item.size_bytes)} · {item.created_at.slice(0, 10)}
                    </span>
                  </div>
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => void handleDelete(item)}
                      className="rounded p-1 text-app-muted hover:bg-rose-50 hover:text-rose-600"
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {error ? (
            <div className="whitespace-pre-line rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </div>
          ) : null}

          {canAdd ? (
            <div>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-rose-300 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                {uploading ? t("expenses.doc.attachmentUploading") : t("expenses.doc.attachmentAdd")}
              </button>
              <p className="mt-1 text-center text-[11px] text-app-muted">{t("expenses.doc.attachmentHint")}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
