"use client";

import React, { useEffect, useRef, useState } from "react";
import { Columns3, Check } from "lucide-react";
import type { ProductColumnKey } from "@/types/database.types";
import { PRODUCT_COLUMNS } from "@/lib/products/columns";

interface ColumnVisibilityPanelProps {
  visibility: Record<ProductColumnKey, boolean>;
  onChange: (visibility: Record<ProductColumnKey, boolean>) => void;
}

export default function ColumnVisibilityPanel({
  visibility,
  onChange,
}: ColumnVisibilityPanelProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggle = (key: ProductColumnKey) => {
    onChange({ ...visibility, [key]: !visibility[key] });
  };

  const visibleCount = PRODUCT_COLUMNS.filter((c) => visibility[c.key]).length;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost text-xs"
      >
        <Columns3 className="h-4 w-4 text-app-accent" />
        Sütunlar ({visibleCount}/{PRODUCT_COLUMNS.length})
      </button>

      {open && (
        <div className="app-dropdown-panel absolute right-0 z-30 mt-2 w-64 p-3">
          <p className="mb-2 text-[11px] font-bold uppercase text-app-muted">
            Görünən sütunlar
          </p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {PRODUCT_COLUMNS.map((col) => {
              const checked = visibility[col.key];
              return (
                <label
                  key={col.key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-app-card-hover"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(col.key)}
                    className="rounded border-app text-app-accent focus:ring-[color:var(--app-accent-ring)]"
                  />
                  <span className="flex-1 text-app">{col.label}</span>
                  {checked && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
