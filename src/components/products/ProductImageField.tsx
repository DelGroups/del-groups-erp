"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, Trash2 } from "lucide-react";
import ProductImageLightbox from "@/components/products/ProductImageLightbox";
import { uploadProductImage } from "@/lib/products/uploadProductImage";
import { useI18n } from "@/i18n/I18nProvider";

type ProductImageFieldSize = "xs" | "md";

interface ProductImageFieldProps {
  value: string | null;
  onChange?: (url: string | null) => void;
  alt?: string;
  size?: ProductImageFieldSize;
  editable?: boolean;
  onUploadError?: (message: string) => void;
}

const SIZE_CLASS: Record<ProductImageFieldSize, string> = {
  xs: "h-10 w-10 rounded-md",
  md: "h-20 w-20 rounded-md",
};

export default function ProductImageField({
  value,
  onChange,
  alt = "",
  size = "md",
  editable = false,
  onUploadError,
}: ProductImageFieldProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const imageUrl = value?.trim() || "";
  const hasImage = imageUrl.length > 0;
  const sizeClass = SIZE_CLASS[size];

  const openFilePicker = () => {
    if (!editable || uploading) return;
    inputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !editable || !onChange) return;

    setUploading(true);
    const result = await uploadProductImage(file);
    setUploading(false);

    if (!result.ok) {
      onUploadError?.(result.error);
      return;
    }

    onChange(result.url);
  };

  const handleDelete = () => {
    if (!editable || !onChange) return;
    onChange(null);
  };

  const handleView = () => {
    if (!hasImage) return;
    setLightboxOpen(true);
  };

  if (!editable) {
    return (
      <>
        <button
          type="button"
          onClick={handleView}
          disabled={!hasImage}
          className={`${sizeClass} shrink-0 overflow-hidden border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-table-header)] ${
            hasImage ? "cursor-zoom-in" : "cursor-default opacity-60"
          }`}
          aria-label={hasImage ? t("forms.productImageView") : t("forms.productImage")}
        >
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={alt} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[color:var(--erp-text-muted)]">
              <Camera className="h-4 w-4" />
            </span>
          )}
        </button>
        {hasImage ? (
          <ProductImageLightbox
            open={lightboxOpen}
            imageUrl={imageUrl}
            alt={alt}
            onClose={() => setLightboxOpen(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className={`group relative ${sizeClass} shrink-0`}>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => void handleFileChange(event)}
        />

        {hasImage ? (
          <button
            type="button"
            onClick={handleView}
            className={`${sizeClass} block overflow-hidden border border-[color:var(--erp-border-default)] bg-white`}
            aria-label={t("forms.productImageView")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={alt} className="h-full w-full object-cover" />
          </button>
        ) : (
          <button
            type="button"
            onClick={openFilePicker}
            disabled={uploading}
            className={`${sizeClass} flex items-center justify-center border border-dashed border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-table-header)] text-[color:var(--erp-text-muted)] transition hover:border-[color:var(--erp-border-strong)] hover:text-[color:var(--erp-text-main)] disabled:opacity-60`}
            aria-label={t("forms.productImageAdd")}
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Camera className="h-5 w-5" />
            )}
          </button>
        )}

        {hasImage && !uploading ? (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 rounded-md bg-black/55 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openFilePicker();
              }}
              className="rounded-md bg-white/90 p-1.5 text-slate-800 shadow-sm hover:bg-white"
              title={t("forms.productImageReplace")}
              aria-label={t("forms.productImageReplace")}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleDelete();
              }}
              className="rounded-md bg-white/90 p-1.5 text-rose-700 shadow-sm hover:bg-white"
              title={t("forms.productImageDelete")}
              aria-label={t("forms.productImageDelete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {uploading && hasImage ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/40">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        ) : null}
      </div>

      {hasImage ? (
        <ProductImageLightbox
          open={lightboxOpen}
          imageUrl={imageUrl}
          alt={alt}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
    </>
  );
}
