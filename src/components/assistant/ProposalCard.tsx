"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FilePlus2, Receipt, ShoppingCart, UserPlus } from "lucide-react";
import { Button } from "@/design-system/components";
import { formatGridDate, formatMoney, formatQuantity } from "@/lib/dates/localeDate";
import type { CustomerPayload, ExpenseDraftPayload, ProposalCard as Card, PurchaseDraftPayload, SaleDraftPayload } from "@/lib/assistant/proposals";
import { executeProposal, rejectProposal, type ExecuteError } from "./proposalExecute";

type T = (key: string, params?: Record<string, string | number>) => string;

type State =
  | { s: "open" }
  | { s: "second" }
  | { s: "working" }
  | { s: "done"; docNo: string; href: string }
  | { s: "rejected" }
  | { s: "error"; error: ExecuteError; detail?: string };

const ICON = { sale_draft: ShoppingCart, purchase_draft: FilePlus2, customer: UserPlus, expense_draft: Receipt } as const;

/**
 * A draft the assistant prepared (AST-4): every field as the form shows it, then Create draft (the one main
 * action of the card), Edit in form (sales and purchases: the draft is created and opened in its form),
 * Cancel. Above the amount limit the user confirms twice. The draft is saved by the user's own browser with
 * the form's functions; posting stays the user's button on the document.
 */
export function ProposalCard({ card, t, locale, onNavigate }: { card: Card; t: T; locale: string; onNavigate?: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ s: "open" });
  const Icon = ICON[card.kind];
  const canEditInForm = card.kind === "sale_draft" || card.kind === "purchase_draft";
  const money = (n: number) => formatMoney(n, locale);

  const create = async (openAfter: boolean) => {
    if (card.secondConfirm && state.s !== "second") {
      setState({ s: "second" });
      return;
    }
    setState({ s: "working" });
    const r = await executeProposal(card, card.secondConfirm);
    if (!r.ok) {
      setState({ s: "error", error: r.error, detail: r.detail });
      return;
    }
    setState({ s: "done", docNo: r.docNo, href: r.href });
    if (openAfter) {
      onNavigate?.();
      router.push(r.href);
    }
  };

  const cancel = async () => {
    setState({ s: "working" });
    const ok = await rejectProposal(card.id);
    setState(ok ? { s: "rejected" } : { s: "error", error: "already_decided" });
  };

  return (
    <section className="ds-assistant-proposal" aria-label={t(`assistant.proposal.kind_${card.kind}`)} data-kind={card.kind} data-state={state.s}>
      <header className="ds-assistant-proposal-head">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-semibold">{t(`assistant.proposal.kind_${card.kind}`)}</span>
        <span className="ds-assistant-proposal-badge">{t("assistant.proposal.notSaved")}</span>
      </header>

      <ProposalFields card={card} t={t} locale={locale} money={money} />

      {card.secondConfirm && state.s === "open" ? (
        <p className="ds-assistant-proposal-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {t("assistant.proposal.overLimit", { limit: money(card.limit) })}
        </p>
      ) : null}

      {state.s === "second" ? (
        <p className="ds-assistant-proposal-warn" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {t("assistant.proposal.confirmAgain", { amount: money(card.amount) })}
        </p>
      ) : null}

      {state.s === "done" ? (
        <p className="ds-assistant-proposal-done" role="status">
          <Check className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            {t(card.kind === "customer" ? "assistant.proposal.customerCreated" : "assistant.proposal.draftCreated", { number: state.docNo })}{" "}
            <Link href={state.href} onClick={onNavigate} className="ds-assistant-link">
              {t("assistant.proposal.open")}
            </Link>
          </span>
        </p>
      ) : state.s === "rejected" ? (
        <p className="ds-assistant-note" role="status">
          {t("assistant.proposal.cancelled")}
        </p>
      ) : state.s === "error" ? (
        <p className="ds-assistant-error" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{t(`assistant.proposalErrors.${state.error}`)}</span>
        </p>
      ) : (
        <div className="ds-assistant-proposal-actions">
          <Button size="sm" variant="primary" loading={state.s === "working"} onClick={() => void create(false)}>
            {state.s === "second" ? t("assistant.proposal.confirmAmount") : t(card.kind === "customer" ? "assistant.proposal.createCustomer" : "assistant.proposal.create")}
          </Button>
          {canEditInForm ? (
            <Button size="sm" variant="secondary" disabled={state.s === "working"} onClick={() => void create(true)}>
              {t("assistant.proposal.editInForm")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={state.s === "working"} onClick={() => void cancel()}>
            {t("assistant.proposal.cancel")}
          </Button>
        </div>
      )}
      {state.s === "open" || state.s === "second" ? <p className="ds-assistant-note">{t("assistant.proposal.postingNote")}</p> : null}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="ds-assistant-proposal-row">
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function ProposalFields({ card, t, locale, money }: { card: Card; t: T; locale: string; money: (n: number) => string }) {
  if (card.kind === "customer") {
    const p = card.payload as CustomerPayload;
    return (
      <dl className="ds-assistant-proposal-fields">
        <Row label={t("assistant.proposal.name")} value={p.full_name} />
        <Row label={t("assistant.proposal.company")} value={p.company_name} />
        <Row label={t("assistant.proposal.phone")} value={p.phone} />
        <Row label={t("assistant.proposal.voen")} value={p.voen} />
        <Row label={t("assistant.proposal.address")} value={p.address} />
      </dl>
    );
  }
  if (card.kind === "expense_draft") {
    const p = card.payload as ExpenseDraftPayload;
    return (
      <dl className="ds-assistant-proposal-fields">
        <Row label={t("assistant.proposal.category")} value={p.category_name} />
        <Row label={t("assistant.proposal.date")} value={formatGridDate(p.expense_date)} />
        <Row label={t("assistant.proposal.net")} value={money(p.net_amount)} />
        <Row label={t("assistant.proposal.vat")} value={`${money(p.vat_amount)} (${p.vat_rate}%)`} />
        <Row label={t("assistant.proposal.total")} value={<strong>{money(p.total)}</strong>} />
        <Row label={t("assistant.proposal.payee")} value={p.payee} />
        <Row label={t("assistant.proposal.description")} value={p.description} />
      </dl>
    );
  }
  const p = card.payload as SaleDraftPayload | PurchaseDraftPayload;
  const partner = "customer_name" in p ? p.customer_name : p.supplier_name;
  return (
    <>
      <dl className="ds-assistant-proposal-fields">
        <Row label={t(card.kind === "sale_draft" ? "assistant.proposal.customer" : "assistant.proposal.supplier")} value={partner} />
        <Row label={t("assistant.proposal.date")} value={formatGridDate(p.doc_date)} />
        <Row label={t("assistant.proposal.warehouse")} value={p.warehouse_name ?? t("assistant.proposal.warehouseInForm")} />
        {p.note ? <Row label={t("assistant.proposal.note")} value={p.note} /> : null}
      </dl>
      {/* The lines as a compact list (a card in a 400 px panel; the full grid is the form's). */}
      <ul className="ds-assistant-proposal-lines" aria-label={t("assistant.proposal.product")}>
        {p.lines.map((l, i) => (
          <li key={`${l.product_id}-${i}`}>
            <span className="ds-assistant-proposal-line-name" title={l.product_name}>
              {l.product_name}
            </span>
            <span className="ds-assistant-proposal-line-total">{money(l.total)}</span>
            <span className="ds-assistant-proposal-line-calc">
              {formatQuantity(l.quantity, locale)} {l.unit} × {money(l.unit_price)}
              {l.discount_percent ? ` − ${l.discount_percent}%` : ""} · {t("assistant.proposal.vatRate")} {l.vat_rate}%
            </span>
          </li>
        ))}
      </ul>
      <dl className="ds-assistant-proposal-totals">
        <Row label={t("assistant.proposal.subtotal")} value={money(p.subtotal)} />
        <Row label={t("assistant.proposal.vat")} value={money(p.vat_total)} />
        <Row label={t("assistant.proposal.total")} value={<strong>{money(p.total)}</strong>} />
      </dl>
    </>
  );
}
