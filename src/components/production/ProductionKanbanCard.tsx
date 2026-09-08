"use client";

import React from "react";
import Link from "next/link";
import { Eye, Pencil, Printer, Trash2 } from "lucide-react";
import ProductionProfitabilityCard from "@/components/production/ProductionProfitabilityCard";
import {
  PRODUCTION_STATUS_NEXT,
  calcProductionCosting,
  type ProductionCosting,
  type ProductionOrder,
  type ProductionStatus,
} from "@/lib/production/types";

interface ProductionKanbanCardProps {
  order: ProductionOrder;
  costing?: ProductionCosting;
  typeLabel: string;
  canManage: boolean;
  showFinancials?: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onEdit: (order: ProductionOrder) => void;
  onDelete: (order: ProductionOrder) => void;
  onPrint: (order: ProductionOrder) => void;
  onAdvance: (order: ProductionOrder, nextStatus: ProductionStatus) => void;
}

function phaseActionLabel(status: ProductionStatus, t: (key: string) => string): string | null {
  const next = PRODUCTION_STATUS_NEXT[status];
  if (!next) return null;
  if (status === "Draft") return t("production.workflow.sendToProduction");
  if (status === "In-Progress") return t("production.workflow.sendToLogistics");
  if (status === "Ready") return t("production.workflow.markDelivered");
  return null;
}

export default function ProductionKanbanCard({
  order,
  costing,
  typeLabel,
  canManage,
  showFinancials = false,
  t,
  onEdit,
  onDelete,
  onPrint,
  onAdvance,
}: ProductionKanbanCardProps) {
  const resolvedCosting = costing || calcProductionCosting(order);
  const nextStatus = PRODUCTION_STATUS_NEXT[order.status];
  const advanceLabel = phaseActionLabel(order.status, t);

  return (
    <article className="app-card app-card-interactive p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-app-muted">{order.order_no}</p>
          <p className="font-semibold text-app">{order.project_name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={`/production/${order.id}`}
            className="rounded p-1.5 text-app-muted hover:bg-app-card-hover hover:text-app"
            title={t("production.workflow.viewDetails")}
          >
            <Eye className="h-3.5 w-3.5" />
          </Link>
          {canManage ? (
            <>
              <button
                type="button"
                className="rounded p-1.5 text-app-muted hover:bg-app-card-hover hover:text-app"
                title={t("common.edit")}
                onClick={() => onEdit(order)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-1.5 text-app-muted hover:bg-app-card-hover hover:text-app"
                title={t("common.print")}
                onClick={() => onPrint(order)}
              >
                <Printer className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-1.5 text-rose-400 hover:bg-rose-500/10"
                title={t("common.delete")}
                onClick={() => onDelete(order)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
        </div>
      </div>

      <p className="mt-1 text-xs text-app-muted">{typeLabel}</p>
      <p className="text-xs">{order.customer_name || t("common.anonymousCustomer")}</p>

      {showFinancials ? (
        <ProductionProfitabilityCard order={order} costing={resolvedCosting} compact />
      ) : null}

      {canManage && advanceLabel && nextStatus ? (
        <button
          type="button"
          className="btn-primary mt-3 w-full text-xs"
          onClick={() => onAdvance(order, nextStatus)}
        >
          {advanceLabel}
        </button>
      ) : null}

      {order.status === "Delivered" && canManage ? (
        <button
          type="button"
          className="btn-secondary mt-2 w-full text-xs"
          onClick={() => onEdit(order)}
        >
          {t("production.workflow.customerPayment")}
        </button>
      ) : null}
    </article>
  );
}
