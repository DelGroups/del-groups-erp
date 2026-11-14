"use client";

import { useEffect, useMemo, useState } from "react";
import { Tags } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { PaletteAction } from "@/design-system/components";
import type { PaletteGroup } from "@/design-system/logic";
import { useI18n } from "@/i18n/I18nProvider";
import { findLotsAction, type FoundLot } from "../actions/lotScreens";
import { lotCardHref, lotSearchTerm } from "../lib/lotScreens";
import { useLotTracking } from "./LotTrackingFlag";

/**
 * LOT-4: lots in the command palette. While LOT_TRACKING is on for the user and they may view
 * lots, a typed lot number or supplier batch number (3+ characters) lists the matching lots;
 * choosing one opens the lot card. Null when there is nothing to show.
 */
export function useLotPaletteGroup(query: string, navigate: (href: string) => void): PaletteGroup<PaletteAction> | null {
  const { t } = useI18n();
  const { can } = useAuth();
  const on = useLotTracking() && can("can_view_lots");
  const term = on ? lotSearchTerm(query) : null;
  const [found, setFound] = useState<{ term: string; lots: FoundLot[] } | null>(null);

  useEffect(() => {
    if (!term) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void findLotsAction(term).then((lots) => {
        if (alive) setFound({ term, lots });
      });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  return useMemo(() => {
    if (!term || !found || found.term !== term || !found.lots.length) return null;
    return {
      id: "lots",
      heading: t("lots.screens.title"),
      commands: found.lots.map((l) => ({
        id: `lot:${l.id}`,
        label: t("lots.screens.paletteItem", { lot: l.lot_no, product: l.product_name }),
        // The typed code matches the lot number or the supplier batch number.
        keywords: [l.lot_no, l.supplier_batch_no ?? "", l.product_name, term],
        icon: Tags,
        onSelect: () => navigate(lotCardHref(l.id)),
      })),
    };
  }, [term, found, t, navigate]);
}
