"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface ProductImageLightboxProps {
  open: boolean;
  imageUrl: string;
  alt?: string;
  onClose: () => void;
}

export default function ProductImageLightbox({
  open,
  imageUrl,
  alt = "",
  onClose,
}: ProductImageLightboxProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt || t("forms.productImage")}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
        aria-label={t("common.close")}
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={alt}
        className="max-h-[90vh] max-w-[min(92vw,960px)] rounded-lg object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
