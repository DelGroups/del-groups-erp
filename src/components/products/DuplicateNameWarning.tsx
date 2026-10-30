"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { productHref, type NameCheckProduct } from "@/lib/products/duplicateNames";
import { cn } from "@/lib/cn";

export function formatProductStock(stock: number | null | undefined): string {
  const value = Number(stock ?? 0);
  return String(Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000);
}

/** One existing product: code, stock and a link that opens it in a new tab (the form keeps its input). */
export function SameNameProductLink({ product, className }: { product: NameCheckProduct; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-0.5", className)}>
      <span className="font-mono text-[color:var(--erp-text-main)]">{product.code || "—"}</span>
      <span className="tabular-nums text-app-muted">
        {t("products.duplicateName.stock", { stock: formatProductStock(product.stock) })}
      </span>
      <a
        href={productHref(product.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-sm font-semibold text-app-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--erp-color-primary)]"
      >
        {t("products.duplicateName.open")}
        <ExternalLink className="h-3 w-3" aria-hidden />
        <span className="sr-only">{t("products.duplicateName.newTab")}</span>
      </a>
    </span>
  );
}

/**
 * Fix F4: another stockable product already has this name. A warning, never a block: the same name
 * can be legitimate, so saving stays possible.
 */
export default function DuplicateNameWarning({
  products,
  className,
}: {
  products: readonly NameCheckProduct[];
  className?: string;
}) {
  const { t } = useI18n();
  if (products.length === 0) return null;
  return (
    <div
      role="status"
      className={cn(
        "rounded-[var(--erp-radius-md)] border border-[color:var(--erp-color-warning)]/30 bg-[color:var(--erp-color-warning)]/10 px-3 py-2 text-xs text-[color:var(--erp-text-main)]",
        className
      )}
    >
      <p className="flex items-start gap-1.5 font-semibold">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--erp-color-warning)]" aria-hidden />
        {t("products.duplicateName.title", { count: products.length })}
      </p>
      <ul className="mt-1.5 space-y-1 ps-5">
        {products.map((product) => (
          <li key={product.id}>
            <SameNameProductLink product={product} />
          </li>
        ))}
      </ul>
      <p className="mt-1.5 ps-5 text-app-muted">{t("products.duplicateName.body")}</p>
    </div>
  );
}
