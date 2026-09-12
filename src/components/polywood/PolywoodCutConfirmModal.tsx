"use client";

import React from "react";
import { Scissors } from "lucide-react";
import Button from "@/components/ui/button";
import Card from "@/components/ui/card";
import { useI18n } from "@/i18n/I18nProvider";

export interface PolywoodCutConfirmState {
  rowId: string;
  productName: string;
  requestedM: number;
  sourceLengthM: number;
  remainderM: number;
}

interface PolywoodCutConfirmModalProps {
  state: PolywoodCutConfirmState;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function PolywoodCutConfirmModal({
  state,
  onConfirm,
  onCancel,
}: PolywoodCutConfirmModalProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-[10004] flex items-center justify-center app-scrim p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <div className="flex items-start gap-3 border-b border-app px-5 py-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Scissors className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-app">{t("polywood.smartCut.title")}</h3>
            <p className="mt-1 text-xs text-app-muted">{state.productName}</p>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm text-app">
          <p>
            {t("polywood.smartCut.message", {
              length: state.requestedM.toFixed(1),
              sheet: state.sourceLengthM.toFixed(1),
            })}
          </p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs">
            <p className="font-semibold text-slate-700">{t("polywood.smartCut.resultTitle")}</p>
            <p className="mt-1 text-slate-600">
              {t("polywood.smartCut.resultUsed", { length: state.requestedM.toFixed(1) })}
            </p>
            <p className="text-slate-600">
              {t("polywood.smartCut.resultRemainder", { length: state.remainderM.toFixed(1) })}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-app px-5 py-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("polywood.smartCut.cancel")}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {t("polywood.smartCut.confirm")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
