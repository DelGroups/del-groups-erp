"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2, ScanLine } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/hooks/useToast";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import ToastMessage from "@/components/ui/ToastMessage";
import { Modal } from "@/components/ui/modal";
import { buildProductInsert, createProduct } from "@/lib/products/api";
import { fetchProductByBarcode } from "@/lib/products/barcode";
import { resolveCategoryFromHint } from "@/lib/products/categoryHint";
import { parseFieldNumber } from "@/lib/forms/numericField";
import type { Category, Product } from "@/types/database.types";
import { cn } from "@/lib/cn";

interface QuickScanModalProps {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  onCreated?: () => void;
  onExistingProduct?: (product: Product) => void;
}

interface LookupResponse {
  found: boolean;
  data?: {
    name?: string;
    image_url?: string | null;
    category?: string | null;
    category_hint?: string | null;
    brand?: string | null;
    country_of_origin?: string | null;
  };
  error?: string;
}

export default function QuickScanModal({
  open,
  onClose,
  categories,
  onCreated,
  onExistingProduct,
}: QuickScanModalProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const barcodeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  const [barcode, setBarcode] = useState("");
  const [name, setName] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [category, setCategory] = useState("Ümumi");
  const [brand, setBrand] = useState("");
  const [country, setCountry] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [formUnlocked, setFormUnlocked] = useState(false);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);

  const parentCategories = categories.filter((row) => !row.parent_id);

  const resetForm = () => {
    setBarcode("");
    setName("");
    setSellPrice("");
    setCategory(parentCategories.find((row) => row.name === "Ümumi")?.name || parentCategories[0]?.name || "Ümumi");
    setBrand("");
    setCountry("");
    setImageUrl(null);
    setFormUnlocked(false);
    setLooking(false);
    setSaving(false);
  };

  useEffect(() => {
    if (!open) {
      resetForm();
      return;
    }
    const timer = window.setTimeout(() => barcodeRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (parentCategories.length === 0) return;
    setCategory((current) => {
      if (parentCategories.some((row) => row.name === current)) return current;
      return parentCategories.find((row) => row.name === "Ümumi")?.name || parentCategories[0].name;
    });
  }, [parentCategories]);

  const handleLookup = async () => {
    const scanned = barcode.trim();
    if (!scanned || looking) return;

    setLooking(true);
    try {
      const existing = await fetchProductByBarcode(scanned);
      if (existing) {
        showError(t("products.quickScan.existingProduct", { name: existing.name }));
        onExistingProduct?.(existing);
        onClose();
        return;
      }

      const response = await fetch(`/api/lookup-barcode?barcode=${encodeURIComponent(scanned)}`);
      const payload = (await response.json()) as LookupResponse;

      if (!response.ok) {
        showError(payload.error || t("common.error"));
        setFormUnlocked(true);
        return;
      }

      if (payload.found && payload.data) {
        const hint = payload.data.category_hint || payload.data.category;
        if (hint) {
          console.info("[QuickScan] category_hint:", hint);
        }
        setName(payload.data.name?.trim() || "");
        setBrand(payload.data.brand?.trim() || "");
        setCountry(payload.data.country_of_origin?.trim() || "");
        setCategory(resolveCategoryFromHint(hint, categories));
        setImageUrl(payload.data.image_url || null);
        setFormUnlocked(true);
        window.setTimeout(() => priceRef.current?.focus(), 0);
        return;
      }

      showError(t("products.quickScan.notFoundGlobal"));
      setFormUnlocked(true);
      window.setTimeout(() => nameRef.current?.focus(), 0);
    } catch {
      showError(t("common.error"));
      setFormUnlocked(true);
    } finally {
      setLooking(false);
    }
  };

  const handleBarcodeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void handleLookup();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formUnlocked || saving) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      showError(t("forms.enterProductName"));
      return;
    }
    if (!barcode.trim()) {
      showError(t("products.quickScan.barcodeRequired"));
      return;
    }

    setSaving(true);
    const payload = buildProductInsert({
      name: trimmedName,
      category,
      sell_price: parseFieldNumber(sellPrice, 0),
      buy_price: 0,
      stock: 0,
      min_stock: 0,
      barcode: barcode.trim(),
      image_url: imageUrl,
      brand: brand.trim() || null,
      country_of_origin: country.trim() || null,
    });

    const result = await createProduct(payload);
    setSaving(false);

    if (!result.ok || !result.product) {
      showError(result.error || t("common.error"));
      return;
    }

    showSuccess(t("products.quickScan.created"));
    onCreated?.();
    onClose();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("products.quickScanLabel")}
      className="max-w-md"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t("common.close")}
          </Button>
          <Button
            type="submit"
            form="quick-scan-form"
            disabled={!formUnlocked || saving || looking}
            loading={saving}
          >
            {t("products.quickScan.confirmAdd")}
          </Button>
        </div>
      }
    >
      <form id="quick-scan-form" onSubmit={handleSubmit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-app-muted">
            {t("products.quickScan.barcodeLabel")}
          </span>
          <div className="relative">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-app-accent" />
            <input
              ref={barcodeRef}
              type="text"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              onKeyDown={handleBarcodeKeyDown}
              placeholder={t("products.quickScan.scanPlaceholder")}
              autoFocus
              disabled={looking || saving}
              className="app-input w-full py-3 pl-10 text-base font-mono"
            />
          </div>
          {looking ? (
            <p className="flex items-center gap-2 text-xs text-app-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("products.quickScan.searching")}
            </p>
          ) : null}
        </label>

        <div
          className={cn(
            "space-y-3 rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-input)]/60 p-4 transition-opacity",
            !formUnlocked && "pointer-events-none opacity-45"
          )}
        >
          <p className="text-xs font-bold uppercase tracking-wide text-app-muted">
            {t("products.quickScan.miniFormTitle")}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="col-span-2 block space-y-1 sm:col-span-2">
            <span className="text-xs font-semibold text-app">{t("products.name")}</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!formUnlocked || saving}
              placeholder={t("products.namePlaceholder")}
              className="app-input w-full"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-app">{t("products.metadata.brand")}</span>
            <input
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              disabled={!formUnlocked || saving}
              className="app-input w-full"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-app">{t("products.metadata.country")}</span>
            <input
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              disabled={!formUnlocked || saving}
              className="app-input w-full"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-app">{t("products.quickScan.sellPrice")}</span>
            <input
              ref={priceRef}
              type="number"
              min={0}
              step="0.01"
              value={sellPrice}
              onChange={(event) => setSellPrice(event.target.value)}
              disabled={!formUnlocked || saving}
              placeholder="0.00"
              className="app-input w-full font-mono"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-app">{t("products.category")}</span>
            <Select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              disabled={!formUnlocked || saving}
            >
              {parentCategories.length === 0 ? (
                <option value="Ümumi">Ümumi</option>
              ) : (
                parentCategories.map((row) => (
                  <option key={row.id} value={row.name}>
                    {row.name}
                  </option>
                ))
              )}
            </Select>
          </label>
          </div>
        </div>
      </form>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </Modal>
  );
}
