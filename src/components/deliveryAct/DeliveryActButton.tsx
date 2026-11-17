"use client";

import React, { useState } from "react";
import { FileSignature } from "lucide-react";
import { Button, DesignScope } from "@/design-system/components";
import { useTheme } from "@/theme/ThemeProvider";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useDeliveryActEnabled } from "./DeliveryActFlag";
import { DeliveryActDialog } from "./DeliveryActDialog";

/**
 * "Təhvil-təslim aktı" for one saved sales invoice (the classic invoice view and the invoice form's
 * bottom bar). Secondary, so the screen keeps its one primary action. Renders nothing while DELIVERY_ACT
 * is off or the invoice is not saved yet.
 */
export function DeliveryActButton({ saleId, size = "md" }: { saleId: string | null | undefined; size?: "sm" | "md" }) {
  const on = useDeliveryActEnabled();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { theme } = useTheme();
  const { brand } = useNewUi();
  if (!on || !saleId) return null;
  // Its own design scope, so it looks right on the classic screens too (as FindSuspiciousButton).
  return (
    <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className="ds-scope-transparent">
      <Button type="button" variant="secondary" size={size} icon={FileSignature} onClick={() => setOpen(true)}>
        {t("deliveryAct.action")}
      </Button>
      <DeliveryActDialog saleId={saleId} open={open} onOpenChange={setOpen} />
    </DesignScope>
  );
}
