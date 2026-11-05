"use client";

import { PaymentDialog } from "@/components/payments/PaymentDialog";
import { ViewScope } from "@/views";
import { stageViews } from "../lib/stages";
import { ImportStageBar } from "./ImportStageBar";

/*
 * ?frame=pay (IMP-5): the stage bar of a shipment at customs and the one payment dialog paying the
 * DGK customs costs (150 AZN) from two accounts. Fixtures (like demo data), not UI texts; nothing
 * is saved: the dialog's submit only answers success.
 */
const ACCOUNTS = [
  { id: "00000000-0000-4000-8000-0000000000b1", name: "ABB bank", type: "bank", balance: 24180.55 },
  { id: "00000000-0000-4000-8000-0000000000b2", name: "Kassa (AZN)", type: "cash", balance: 3412 },
];

export function ImportPayLab() {
  const stages = stageViews({
    status: "confirmed",
    createdAt: "2026-10-03T10:42:00Z",
    confirmDate: "2026-10-06",
    departedOn: "2026-10-09",
    arrivedOn: "2026-10-28",
  });
  return (
    <ViewScope>
      <div className="flex flex-col gap-4" data-ui-frame="pay">
        <ImportStageBar
          stages={stages}
          nextLabel="Gömrükdən buraxıldı"
          onNext={() => undefined}
          menu={[{ key: "note", label: "Mərhələ qeydi əlavə et", onSelect: () => undefined }]}
          facts={[
            { key: "carrier", label: "Daşıyıcı · nəqliyyat", value: "Trans Kargo MMC · Avtomobil" },
            { key: "no", label: "İzləmə №", value: <span className="ds-mono">CMR 4471203</span> },
            { key: "eta", label: "ETA", value: "27.10.2026" },
            { key: "transit", label: "Yolda", value: "19 gün" },
          ]}
          onEditTracking={() => undefined}
        />
        <PaymentDialog
          open
          onClose={() => undefined}
          direction="out"
          counterpartyLabel="Kimə"
          counterpartyName="DGK"
          documentLabel="Sənəd"
          documentNumber="IMP-2026-0003"
          openBalance={150}
          accounts={ACCOUNTS}
          presets={[
            {
              key: "two",
              label: "ABB + Kassa",
              build: () => [
                { accountId: ACCOUNTS[0].id, method: "transfer", amount: 100, note: null },
                { accountId: ACCOUNTS[1].id, method: "cash", amount: 50, note: null },
              ],
            },
          ]}
          initialPreset="two"
          onSubmit={async () => ({ success: true })}
        />
      </div>
    </ViewScope>
  );
}
