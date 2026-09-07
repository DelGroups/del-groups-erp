"use client";

import React, { useRef, useState } from "react";
import { Download, Paperclip, Upload } from "lucide-react";
import {
  getContractAttachmentUrl,
  uploadContractAttachment,
  type Contract,
} from "@/lib/contracts/api";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  contract: Contract;
  disabled?: boolean;
  onUploaded: (contract: Contract) => void;
  onError: (message: string) => void;
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

export default function ContractAttachmentButton({
  contract,
  disabled,
  onUploaded,
  onError,
}: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file: File) => {
    setUploading(true);
    const result = await uploadContractAttachment(contract.id, file);
    setUploading(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onUploaded({ ...contract, attachment_path: result.path });
  };

  const handleDownload = async () => {
    if (!contract.attachment_path) return;
    const url = await getContractAttachmentUrl(contract.attachment_path);
    if (!url) {
      onError(t("official.attachmentDownloadFailed"));
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleUpload(file);
        }}
      />
      {contract.attachment_path ? (
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => void handleDownload()}
          className="rounded p-1.5 text-app-accent hover:bg-app-card-hover"
          title={t("official.downloadAttachment")}
        >
          <Download className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="rounded p-1.5 hover:bg-app-card-hover"
          title={t("official.attachScan")}
        >
          {uploading ? (
            <Upload className="h-4 w-4 animate-pulse" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
        </button>
      )}
    </>
  );
}
