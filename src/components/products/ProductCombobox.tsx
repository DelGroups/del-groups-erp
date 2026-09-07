"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchPolywoodSummariesByWarehouse } from "@/lib/polywood/inventory";
import {
  formatProductDropdownLabel,
  productCode,
  stockHintFromPolywoodSummary,
  type ProductStockHint,
} from "@/lib/products/productOptionLabel";
import type { Product } from "@/types/database.types";

function productMatches(p: Product, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (p.name || "").toLowerCase().includes(q) ||
    (p.code || "").toLowerCase().includes(q) ||
    (p.sku || "").toLowerCase().includes(q) ||
    (p.barcode || "").toLowerCase().includes(q)
  );
}

export interface ProductComboboxProps {
  products: Product[];
  selectedId: string;
  selectedName: string;
  onSelect: (product: Product | null) => void;
  instanceId?: string;
  polywoodWarehouseId?: string | null;
  disabled?: boolean;
}

export default function ProductCombobox({
  products,
  selectedId,
  selectedName,
  onSelect,
  instanceId = "new",
  polywoodWarehouseId = null,
  disabled = false,
}: ProductComboboxProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selectedName);
  const [highlight, setHighlight] = useState(0);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [polywoodHints, setPolywoodHints] = useState<Map<string, ProductStockHint>>(new Map());

  useEffect(() => {
    if (!open) setQuery(selectedName || "");
  }, [selectedName, open]);

  useEffect(() => {
    if (!open || !polywoodWarehouseId) return;
    let active = true;
    void fetchPolywoodSummariesByWarehouse(polywoodWarehouseId)
      .then((summaries) => {
        if (!active) return;
        const hints = new Map<string, ProductStockHint>();
        summaries.forEach((summary, productId) => {
          hints.set(productId, stockHintFromPolywoodSummary(summary));
        });
        setPolywoodHints(hints);
      })
      .catch(() => {
        if (active) setPolywoodHints(new Map());
      });
    return () => {
      active = false;
    };
  }, [open, polywoodWarehouseId]);

  const updateMenuPosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    setMenuStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 320),
      zIndex: 9999,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onReposition = () => updateMenuPosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updateMenuPosition, query]);

  const filtered = useMemo(() => {
    const q = query.trim();
    const list = q ? products.filter((p) => productMatches(p, q)) : products;
    return list.slice(0, 80);
  }, [products, query]);

  const exactScanMatch = useMemo(() => {
    const raw = query.trim();
    if (!raw) return null;
    const barcodeHits = products.filter(
      (p) => (p.barcode || "").trim().toLowerCase() === raw.toLowerCase()
    );
    if (barcodeHits.length === 1) return barcodeHits[0];
    const codeHits = products.filter(
      (p) => productCode(p).toLowerCase() === raw.toLowerCase()
    );
    if (codeHits.length === 1) return codeHits[0];
    return null;
  }, [products, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    const option = listRef.current?.querySelector(`[data-index="${highlight}"]`);
    option?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = useCallback(
    (product: Product | null) => {
      onSelect(product);
      setQuery(product ? product.name : "");
      setOpen(false);
      inputRef.current?.blur();
    },
    [onSelect]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery(selectedName || "");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (exactScanMatch) {
        choose(exactScanMatch);
        return;
      }
      if (!open) {
        setOpen(true);
        return;
      }
      const picked = filtered[highlight];
      if (picked) choose(picked);
    }
  };

  const listId = `product-combobox-list-${instanceId}`;

  const dropdown =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            id={listId}
            ref={listRef}
            role="listbox"
            style={menuStyle}
            className="app-dropdown-panel max-h-56 overflow-y-auto py-1 shadow-lg"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-app-muted">
                {t("invoice.productNotFound")}
              </div>
            ) : (
              filtered.map((p, idx) => {
                const active = idx === highlight;
                const selected = p.id === selectedId;
                const hint = polywoodHints.get(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    data-index={idx}
                    aria-selected={selected}
                    onMouseEnter={() => setHighlight(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(p)}
                    className={`flex w-full px-3 py-1.5 text-left text-xs ${
                      active ? "app-dropdown-item-active" : "bg-app-card"
                    } ${selected ? "font-semibold" : ""}`}
                  >
                    {formatProductDropdownLabel(p, t, hint)}
                  </button>
                );
              })
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} className="relative min-w-[220px]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-1.5 top-1.5 h-3.5 w-3.5 text-app-muted" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={listId}
          disabled={disabled}
          value={query}
          placeholder={t("invoice.productSearchPlaceholder")}
          onFocus={() => {
            updateMenuPosition();
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            updateMenuPosition();
            setOpen(true);
            if (!e.target.value) onSelect(null);
          }}
          onKeyDown={handleKeyDown}
          className="w-full rounded border border-app py-1 pl-6 pr-6 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-[color:var(--app-accent-ring)] disabled:opacity-60"
        />
        <ChevronDown className="pointer-events-none absolute right-1.5 top-1.5 h-3.5 w-3.5 text-app-muted" />
      </div>
      {dropdown}
    </div>
  );
}
