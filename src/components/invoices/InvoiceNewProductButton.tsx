"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import Button from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useAuth } from "@/components/auth/AuthProvider";
import { QuickCreateDialog, canQuickCreate, type LookupRecord } from "@/components/lookups";
import { useI18n } from "@/i18n/I18nProvider";
import { showInvoiceNewProduct } from "@/lib/invoices/newProduct";
import type { PermissionKey } from "@/types/database.types";
import { useInvoiceTools } from "./InvoiceToolsFlag";

/**
 * INV-1: may this user see "New product" in an invoice form? INVOICE_TOOLS on, the same product
 * permission as every quick-create (canQuickCreate), and not the polywood-only sales mode.
 */
export function useInvoiceNewProductAllowed(options: { polywoodOnly?: boolean } = {}): boolean {
  const flag = useInvoiceTools();
  const { isAdmin, can } = useAuth();
  const canCreate = canQuickCreate("product", { isAdmin, can: (p) => can(p as PermissionKey) });
  return showInvoiceNewProduct({ flag, canCreate, polywoodOnly: options.polywoodOnly });
}

/**
 * INV-1: the "New product" button of the invoice items header. It opens the product
 * quick-create (QuickCreateDialog: short form, full form drawer, same-name warning) as a modal
 * over the form, which keeps all its state. The created product is handed to the form, which puts
 * it on a line with its own product-pick handler. The dialog refreshes the product lookups.
 */
export function InvoiceNewProductButton({
  onCreated,
  disabled,
  className,
}: {
  /** The created product row (from POST /api/products), as every lookup hands it over. */
  onCreated: (record: LookupRecord) => void;
  disabled?: boolean;
  /** Extra classes, e.g. the height of the neighbouring header buttons. */
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        appearance="solid"
        color="secondary"
        size="sm"
        className={cn("min-w-0 max-w-full", className)}
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{t("invoiceTools.newProduct")}</span>
      </Button>
      <QuickCreateDialog
        entity="product"
        open={open}
        onOpenChange={setOpen}
        query=""
        onCreated={onCreated}
      />
    </>
  );
}
