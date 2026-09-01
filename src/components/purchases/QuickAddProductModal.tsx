"use client";

import React, { useEffect, useState } from "react";
import { Save, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { buildProductInsert, createProduct } from "@/lib/products/api";
import type { Category, Product } from "@/types/database.types";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";

const UNITS = ["Ədəd", "Kq", "Litr", "Metr", "Qutu"];

interface QuickAddProductModalProps {
  onClose: () => void;
  onCreated: (product: Product) => void;
}

export default function QuickAddProductModal({
  onClose,
  onCreated,
}: QuickAddProductModalProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Ümumi");
  const [subcategory, setSubcategory] = useState("");
  const [unit, setUnit] = useState("Ədəd");
  const [buyPrice, setBuyPrice] = useState("0");
  const [sellPrice, setSellPrice] = useState("0");
  const [barcode, setBarcode] = useState("");
  const [color, setColor] = useState("");
  const [weight, setWeight] = useState("0");
  const [extraInfo, setExtraInfo] = useState("");
  const [saving, setSaving] = useState(false);
  const { message: toastMessage, variant: toastVariant, showError } = useToast();

  useEffect(() => {
    void supabase
      .from("categories")
      .select("*")
      .order("name")
      .then(({ data }) => {
        const rows = (data as Category[]) || [];
        setCategories(rows);
        if (rows[0]?.name) setCategory(rows[0].name);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showError("Məhsul adını daxil edin");
      return;
    }

    const payload = buildProductInsert({
      code,
      name,
      category: category || "Ümumi",
      subcategory: subcategory || null,
      unit,
      buy_price: parseFloat(buyPrice) || 0,
      sell_price: parseFloat(sellPrice) || 0,
      stock: 0,
      min_stock: 0,
      barcode: barcode || null,
      color: color || null,
      weight: parseFloat(weight) || 0,
      extra_info: extraInfo || null,
    });

    setSaving(true);
    const result = await createProduct(payload);
    setSaving(false);

    if (!result.ok || !result.product) {
      showError("Xəta: " + (result.error || "Məhsul yaradılmadı"));
      return;
    }

    onCreated(result.product);
    onClose();
  };

  return (
    <>
    <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
      <div className="app-modal max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <h3 className="text-sm font-bold text-app">Yeni məhsul yarat</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 p-5 text-xs md:grid-cols-2">
          <label className="block font-semibold text-app">
            Kod
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Avtomatik"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="block font-semibold text-app">
            Məhsul adı *
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="block font-semibold text-app">
            Kateqoriya
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="app-input mt-1 text-sm"
            >
              {categories.length === 0 ? (
                <option value="Ümumi">Ümumi</option>
              ) : (
                categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="block font-semibold text-app">
            Alt kateqoriya
            <input
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="block font-semibold text-app">
            Ölçü vahidi
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="app-input mt-1 text-sm"
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="block font-semibold text-app">
            Barkod
            <input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              placeholder="Skan edin və ya daxil edin"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="block font-semibold text-app">
            Alış qiyməti
            <input
              type="number"
              step="0.01"
              min="0"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block font-semibold text-app">
            Satış qiyməti
            <input
              type="number"
              step="0.01"
              min="0"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block font-semibold text-app">
            Rəng
            <input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="block font-semibold text-app">
            Çəki
            <input
              type="number"
              step="0.01"
              min="0"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block font-semibold text-app md:col-span-2">
            Əlavə məlumat
            <input
              value={extraInfo}
              onChange={(e) => setExtraInfo(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2 md:col-span-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-app px-4 py-2 font-semibold text-app"
            >
              Ləğv et
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saxlanılır..." : "Yadda saxla"}
            </button>
          </div>
        </form>
      </div>
    </div>
    <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
