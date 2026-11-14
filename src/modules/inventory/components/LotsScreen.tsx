"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Printer, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ErrorState, LoadingState } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { EngineScreen, type RowActionSpec } from "@/views";
import { listLotsAction, lotWarehousesAction } from "../actions/lotScreens";
import { lotCardHref } from "../lib/lotScreens";
import { LOTS_VIEW_KEY, lotKpiCards, lotsDefinition } from "../views/lots";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * LOT-4: the lot list (LOT_TRACKING): search by lot no, supplier batch, product name / code /
 * barcode; filters by status, expiry window, stock, warehouse; value filters by product,
 * supplier and import shipment; columns, saved views and Excel export from the view engine.
 * `productId` (products row menu "Lots") limits the list to one product.
 */
export default function LotsScreen({ productId }: { productId?: string | null }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const warehouses = useQuery({
    queryKey: ["lots", "warehouses"],
    queryFn: async () => {
      const r = await lotWarehousesAction();
      if (!r.success) throw new Error(t(r.error));
      return r.data;
    },
    staleTime: 60_000,
  });

  const definition = useMemo(() => {
    if (!warehouses.data) return null;
    const names = new Map(warehouses.data.map((w) => [w.id, w.name]));
    return lotsDefinition(
      {
        fetchAll: async () => {
          const r = await listLotsAction(productId ?? null);
          if (!r.success) throw new Error(t(r.error));
          return r.data.rows;
        },
      },
      // A product's lots have their own cache (and saved views) next to the full list.
      { key: productId ? `${LOTS_VIEW_KEY}@${productId}` : LOTS_VIEW_KEY, today, warehouses: warehouses.data, warehouseNames: names },
    );
  }, [warehouses.data, productId, t]);

  if (warehouses.isError) return <ErrorState title={t("lots.screens.errors.loadFailed")} description={warehouses.error instanceof Error ? warehouses.error.message : undefined} retryLabel={t("views.retry")} onRetry={() => void warehouses.refetch()} />;
  if (!definition) return <LoadingState label={t("common.loading")} />;

  const manage = can("can_manage_lots");
  return (
    <EngineScreen
      definition={definition}
      title={t("lots.screens.title")}
      kpis={(records, fmt) => lotKpiCards(records, fmt)}
      openHref={(r) => lotCardHref(r.id)}
      header={
        productId ? (
          <div className="flex flex-wrap items-center gap-2" data-lots-product-filter="">
            <span className="ds-chip ds-chip-flat">{t("lots.screens.productFilter")}</span>
            <Link href="/inventory/lots" className="ds-btn ds-btn-sm ds-btn-ghost">
              <X className="h-4 w-4" aria-hidden />
              {t("lots.screens.allLots")}
            </Link>
          </div>
        ) : null
      }
      // UI-5: the row menu runs the card's actions (?do=), so the rules and dialogs stay there.
      rowActions={(r): RowActionSpec[] => [
        { key: "print", label: t("lots.screens.actions.printLabel"), icon: <Printer className="h-4 w-4" /> },
        { key: "export", label: t("lots.screens.actions.exportPdf"), icon: <FileDown className="h-4 w-4" /> },
        { key: "quarantine", label: t("lots.screens.actions.quarantine"), icon: <ShieldAlert className="h-4 w-4" />, hidden: !manage || r.status !== "active" },
        { key: "release", label: t("lots.screens.actions.release"), icon: <ShieldCheck className="h-4 w-4" />, hidden: !manage || r.status !== "quarantine" },
      ]}
    />
  );
}
