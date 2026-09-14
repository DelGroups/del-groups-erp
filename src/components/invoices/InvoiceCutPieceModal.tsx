"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Scissors } from "lucide-react";
import Button from "@/components/ui/button";
import Card from "@/components/ui/card";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchAvailablePolywoodPieces } from "@/lib/polywood/inventory";
import type { PolywoodPiece } from "@/lib/polywood/types";
import { cn } from "@/lib/cn";

export type CutPieceCalculationMode = "linear" | "area";

export interface InvoiceCutPieceResult {
  lengthM: number;
  widthM: number;
  pieces: number;
  areaM2: number | null;
  quantity: number;
  unit: "m²" | "Metr";
  calculationMode: CutPieceCalculationMode;
  pieceId?: string;
}

interface InvoiceCutPieceModalProps {
  open: boolean;
  productId: string;
  productName: string;
  warehouseId: string;
  defaultWidthM?: number;
  onClose: () => void;
  onApply: (result: InvoiceCutPieceResult) => void;
}

type TabId = "stock" | "custom";

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export default function InvoiceCutPieceModal({
  open,
  productId,
  productName,
  warehouseId,
  defaultWidthM = 0,
  onClose,
  onApply,
}: InvoiceCutPieceModalProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>("stock");
  const [calcMode, setCalcMode] = useState<CutPieceCalculationMode>("linear");
  const [loading, setLoading] = useState(false);
  const [pieces, setPieces] = useState<PolywoodPiece[]>([]);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [lengthM, setLengthM] = useState("");
  const [widthM, setWidthM] = useState(defaultWidthM > 0 ? String(defaultWidthM) : "");
  const [pieceCount, setPieceCount] = useState("1");

  useEffect(() => {
    if (!open) return;
    setTab("stock");
    setCalcMode("linear");
    setSelectedPieceId(null);
    setLengthM("");
    setWidthM(defaultWidthM > 0 ? String(defaultWidthM) : "");
    setPieceCount("1");
  }, [open, defaultWidthM, productId, warehouseId]);

  useEffect(() => {
    if (!open || !productId || !warehouseId) return;
    let cancelled = false;
    setLoading(true);
    void fetchAvailablePolywoodPieces(productId, warehouseId)
      .then((rows) => {
        if (!cancelled) setPieces(rows.filter((piece) => piece.piece_type === "cut"));
      })
      .catch(() => {
        if (!cancelled) setPieces([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, productId, warehouseId]);

  const pieceQty = Math.max(1, Number(pieceCount) || 1);
  const lengthValue = Number(lengthM) || 0;
  const widthValue = Number(widthM) || 0;

  const customLinearTotal = useMemo(() => {
    if (lengthValue <= 0) return 0;
    return round3(lengthValue * pieceQty);
  }, [lengthValue, pieceQty]);

  const customAreaTotal = useMemo(() => {
    if (lengthValue <= 0 || widthValue <= 0) return 0;
    return round3(lengthValue * widthValue * pieceQty);
  }, [lengthValue, widthValue, pieceQty]);

  const selectedPiece = pieces.find((piece) => piece.id === selectedPieceId) || null;

  const stockLinearTotal = selectedPiece ? round3(selectedPiece.length_m * pieceQty) : 0;
  const stockAreaTotal =
    selectedPiece && widthValue > 0
      ? round3(selectedPiece.length_m * widthValue * pieceQty)
      : 0;

  const applyFromStock = () => {
    if (!selectedPiece) return;
    const width = widthValue || defaultWidthM || 0;
    const useArea = width > 0;

    onApply({
      lengthM: selectedPiece.length_m,
      widthM: width,
      pieces: pieceQty,
      areaM2: useArea ? stockAreaTotal : null,
      quantity: useArea ? stockAreaTotal : stockLinearTotal,
      unit: useArea ? "m²" : "Metr",
      calculationMode: useArea ? "area" : "linear",
      pieceId: selectedPiece.id,
    });
  };

  const applyCustom = () => {
    if (calcMode === "linear") {
      if (lengthValue <= 0) return;
      onApply({
        lengthM: lengthValue,
        widthM: widthValue,
        pieces: pieceQty,
        areaM2: widthValue > 0 ? round3(lengthValue * widthValue * pieceQty) : null,
        quantity: customLinearTotal,
        unit: "Metr",
        calculationMode: "linear",
      });
      return;
    }

    if (lengthValue <= 0 || widthValue <= 0) return;
    onApply({
      lengthM: lengthValue,
      widthM: widthValue,
      pieces: pieceQty,
      areaM2: customAreaTotal,
      quantity: customAreaTotal,
      unit: "m²",
      calculationMode: "area",
    });
  };

  const customCanApply =
    calcMode === "linear" ? customLinearTotal > 0 : customAreaTotal > 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10004] flex items-center justify-center app-scrim p-4">
      <Card className="w-full max-w-lg shadow-2xl">
        <div className="flex items-start gap-3 border-b border-app px-5 py-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Scissors className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-app">{t("invoice.cutPiece.title")}</h3>
            <p className="mt-1 truncate text-xs text-app-muted">{productName}</p>
          </div>
        </div>

        <div className="border-b border-app px-5 pt-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab("stock")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold",
                tab === "stock"
                  ? "bg-amber-100 text-amber-900"
                  : "text-app-muted hover:bg-app-surface"
              )}
            >
              {t("invoice.cutPiece.fromStock")}
            </button>
            <button
              type="button"
              onClick={() => setTab("custom")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold",
                tab === "custom"
                  ? "bg-amber-100 text-amber-900"
                  : "text-app-muted hover:bg-app-surface"
              )}
            >
              {t("invoice.cutPiece.customDims")}
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          {tab === "stock" ? (
            <div className="space-y-3">
              {loading ? (
                <p className="text-xs text-app-muted">{t("common.loading")}</p>
              ) : pieces.length === 0 ? (
                <p className="text-xs text-app-muted">{t("invoice.cutPiece.noPieces")}</p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-app p-2">
                  {pieces.map((piece) => (
                    <button
                      key={piece.id}
                      type="button"
                      onClick={() => {
                        setSelectedPieceId(piece.id);
                        setLengthM(String(piece.length_m));
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs",
                        selectedPieceId === piece.id
                          ? "bg-amber-50 ring-1 ring-amber-300"
                          : "hover:bg-app-surface"
                      )}
                    >
                      <span>{t("invoice.cutPiece.stockPiece", { length: piece.length_m })}</span>
                      <span className="font-mono text-app-muted">{piece.length_m} m</span>
                    </button>
                  ))}
                </div>
              )}
              <label className="block text-xs">
                <span>{t("invoice.cutPiece.width")}</span>
                <span className="ml-1 text-app-muted">({t("invoice.cutPiece.widthOptional")})</span>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={widthM}
                  onChange={(e) => setWidthM(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-app px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="block text-xs">
                {t("invoice.cutPiece.pieces")}
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={pieceCount}
                  onChange={(e) => setPieceCount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-app px-3 py-2 font-mono text-sm"
                />
              </label>
              {selectedPiece ? (
                widthValue > 0 ? (
                  <p className="text-xs font-semibold text-emerald-700">
                    {t("invoice.cutPiece.areaPreview", { area: stockAreaTotal.toFixed(3) })}
                  </p>
                ) : (
                  <p className="text-xs font-semibold text-emerald-700">
                    {t("invoice.cutPiece.lengthPreview", {
                      length: stockLinearTotal.toFixed(3),
                    })}
                  </p>
                )
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <fieldset>
                <legend className="mb-2 text-xs font-semibold text-app">
                  {t("invoice.cutPiece.calculationMode")}
                </legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                      calcMode === "linear"
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-app hover:bg-app-surface"
                    )}
                  >
                    <input
                      type="radio"
                      name="cut-calc-mode"
                      value="linear"
                      checked={calcMode === "linear"}
                      onChange={() => setCalcMode("linear")}
                      className="accent-amber-600"
                    />
                    {t("invoice.cutPiece.modeLinear")}
                  </label>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                      calcMode === "area"
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-app hover:bg-app-surface"
                    )}
                  >
                    <input
                      type="radio"
                      name="cut-calc-mode"
                      value="area"
                      checked={calcMode === "area"}
                      onChange={() => setCalcMode("area")}
                      className="accent-amber-600"
                    />
                    {t("invoice.cutPiece.modeArea")}
                  </label>
                </div>
              </fieldset>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs">
                  {t("invoice.cutPiece.length")}
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={lengthM}
                    onChange={(e) => setLengthM(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-app px-3 py-2 font-mono text-sm"
                  />
                </label>
                <label className="text-xs">
                  <span>{t("invoice.cutPiece.width")}</span>
                  {calcMode === "linear" ? (
                    <span className="ml-1 text-app-muted">
                      ({t("invoice.cutPiece.widthOptional")})
                    </span>
                  ) : null}
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={widthM}
                    onChange={(e) => setWidthM(e.target.value)}
                    required={calcMode === "area"}
                    className="mt-1 w-full rounded-lg border border-app px-3 py-2 font-mono text-sm"
                  />
                </label>
                <label className="col-span-2 text-xs">
                  {t("invoice.cutPiece.pieces")}
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={pieceCount}
                    onChange={(e) => setPieceCount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-app px-3 py-2 font-mono text-sm"
                  />
                </label>
              </div>

              {calcMode === "linear" && customLinearTotal > 0 ? (
                <p className="text-xs font-semibold text-emerald-700">
                  {t("invoice.cutPiece.lengthPreview", {
                    length: customLinearTotal.toFixed(3),
                  })}
                </p>
              ) : null}
              {calcMode === "area" && customAreaTotal > 0 ? (
                <p className="text-xs font-semibold text-emerald-700">
                  {t("invoice.cutPiece.areaPreview", { area: customAreaTotal.toFixed(3) })}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-app px-5 py-4">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => (tab === "stock" ? applyFromStock() : applyCustom())}
            disabled={tab === "stock" ? !selectedPiece : !customCanApply}
          >
            {t("invoice.cutPiece.apply")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
