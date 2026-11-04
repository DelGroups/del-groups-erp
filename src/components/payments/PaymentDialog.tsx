"use client";

import React, { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { RefreshCw, X } from "lucide-react";
import { DateField, Field, FormGrid, IconButton, useDesignScope } from "@/design-system/components";
import { motionPreset, overlayVariants, panelVariants } from "@/design-system/motion";
import { LineGrid, LineNumberCell, LineSelectCell, LineTextCell, type LineColumn } from "@/components/line-grid";
import { EntityLookup } from "@/components/lookups";
import { LookupScope } from "@/components/lookups/LookupScope";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { dateFieldLabels, lineGridLabels } from "@/i18n/uiStandardLabels";
import { formatMoney } from "@/lib/dates/localeDate";
import { defaultPaymentDate, formatDayMonthYear, todayLocalDate, validatePaymentDate } from "@/lib/forms/paymentDate";
import { getSupabaseClient } from "@/lib/supabase";
import {
  addPaymentLine,
  checkPayment,
  entryPreview,
  initialPaymentLines,
  lastAccountStorageKey,
  paymentLinesPayload,
  PAYMENT_METHODS,
  previewText,
  setLineAccount,
  type PaymentAccountOption,
  type PaymentDirection,
  type PaymentLine,
  type PaymentLinePayload,
  type PaymentMethod,
} from "@/lib/payments/paymentLines";

export interface PaymentDialogPayload {
  /** yyyy-mm-dd. */
  paymentDate: string;
  lines: PaymentLinePayload[];
  /** AZN leaving / entering the accounts. */
  totalAzn: number;
  /** Another currency: the amount paid in it and AZN per unit on the payment date. */
  amountFc: number | null;
  rate: number | null;
  note: string | null;
}

export interface PaymentPreset {
  key: string;
  label: string;
  /** The lines for an amount (e.g. the base / VAT split of an official invoice). */
  build: (amount: number, accounts: readonly PaymentAccountOption[]) => Omit<PaymentLine, "key">[];
}

export interface PaymentDialogProps {
  open: boolean;
  onClose: () => void;
  /** Money out (we pay) or in (we receive). */
  direction: PaymentDirection;
  title?: string;
  /** Who: shown, or chosen with `counterpartyField`. */
  counterpartyLabel: string;
  counterpartyName?: string | null;
  /** A field to choose the counterparty (partner payments); replaces the fixed name. */
  counterpartyField?: React.ReactNode;
  /** The ledger account of the counterparty in the preview (2100 payables, 1200 receivables). */
  counterpartyCode?: string | null;
  documentLabel?: string;
  documentNumber?: string | null;
  /** The document's currency (AZN unless an import cost or payable in another one). */
  currency?: string;
  /** What is still open, in the document's currency; null = no document (a free amount, e.g. a partner payment). */
  openBalance: number | null;
  /** Paying more than the open balance is allowed (an advance). */
  allowAdvance?: boolean;
  /** Earliest payment date (the invoice date) and latest (default today). */
  minDate?: string | null;
  maxDate?: string | null;
  /** Another currency: the starting rate and a CBAR fetch for a date. */
  defaultRate?: number | null;
  onFetchRate?: (date: string) => Promise<number | null>;
  /** The booking rate of a foreign-currency payable, for the exchange difference in the preview. */
  bookingRate?: number | null;
  /** The caller's database takes only so many accounts at once (payroll: 1). */
  maxLines?: number;
  /** Accounts to pay from; loaded from the database when not given. */
  accounts?: readonly PaymentAccountOption[];
  /** Line presets (the official base / VAT split); `initialPreset` starts with one. */
  presets?: readonly PaymentPreset[];
  initialPreset?: string | null;
  /** A fixed amount (payroll): the lines must add up to it, the open balance is it. */
  fixedAmount?: number | null;
  /** More fields under the date (a direction switch, a note about the document). */
  extraFields?: React.ReactNode;
  submitLabel?: string;
  /** The caller maps the payload to its own RPC. */
  onSubmit: (payload: PaymentDialogPayload) => Promise<{ success: boolean; error?: string }>;
}

/**
 * The one payment form of the system (IMP-5, Del 2026-11-04): counterparty, document and open
 * balance; payment date; a lines grid "Account | Method | Amount | Note" with "+ Add an account";
 * total, open balance and what remains; and the entry preview. One payment may come from (or go
 * to) several accounts; the database posts it as one event and one journal entry. The account
 * lookup here has no quick-create (accounts are not made from a payment).
 */
export function PaymentDialog(props: PaymentDialogProps) {
  if (!props.open) return null;
  return (
    <LookupScope>
      <PaymentDialogInner {...props} />
    </LookupScope>
  );
}

function PaymentDialogInner({
  onClose,
  direction,
  title,
  counterpartyLabel,
  counterpartyName,
  counterpartyField,
  counterpartyCode,
  documentLabel,
  documentNumber,
  currency = "AZN",
  openBalance,
  allowAdvance = false,
  minDate,
  maxDate,
  defaultRate,
  onFetchRate,
  bookingRate,
  maxLines,
  accounts: givenAccounts,
  presets,
  initialPreset,
  fixedAmount,
  extraFields,
  submitLabel,
  onSubmit,
}: PaymentDialogProps) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const foreign = currency !== "AZN";
  const [accounts, setAccounts] = useState<readonly PaymentAccountOption[]>(givenAccounts ?? []);
  const [paymentDate, setPaymentDate] = useState(() => defaultPaymentDate(minDate ?? null));
  const [rate, setRate] = useState<number | null>(foreign ? defaultRate ?? null : 1);
  const [amountFc, setAmountFc] = useState<number | null>(foreign ? Math.max(0, Math.round(openBalance * 100) / 100) : null);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<PaymentLine[]>([]);
  const [methodTouched, setMethodTouched] = useState<Set<string>>(new Set());
  const [preset, setPreset] = useState<string | null>(initialPreset ?? null);
  const [busy, setBusy] = useState(false);
  const [rateBusy, setRateBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Problems show once the user changed something or tried to pay.
  const [attempted, setAttempted] = useState(false);
  const storageKey = lastAccountStorageKey(user?.id, direction);
  const free = openBalance === null && fixedAmount == null;
  const open = fixedAmount ?? openBalance ?? 0;
  const startAmount = foreign ? Math.round((amountFc ?? 0) * (rate ?? 0) * 100) / 100 : Math.max(0, Math.round(open * 100) / 100);

  // Accounts: given, or this tenant's cash and bank accounts.
  useEffect(() => {
    if (givenAccounts) return;
    let alive = true;
    void (async () => {
      const { data } = await getSupabaseClient().from("accounts").select("id, name, type, balance, is_vat_account").order("name");
      if (!alive) return;
      const rows = ((data ?? []) as unknown as { id: string; name: string; type: string | null; balance: number | null; is_vat_account: boolean | null }[]).map((a) => ({
        id: String(a.id),
        name: String(a.name ?? ""),
        type: a.type,
        balance: a.balance,
        isVatAccount: a.is_vat_account,
      }));
      setAccounts(rows);
    })();
    return () => {
      alive = false;
    };
  }, [givenAccounts]);

  // The first line once the accounts are known: the open balance, the last-used account.
  useEffect(() => {
    if (lines.length || (!accounts.length && !givenAccounts)) return;
    let last: string | null = null;
    try {
      last = window.localStorage.getItem(storageKey);
    } catch {
      last = null;
    }
    const chosen = presets?.find((p) => p.key === preset);
    setLines(initialPaymentLines({ amount: startAmount, accounts, lastAccountId: last, preset: chosen ? chosen.build(startAmount, accounts) : null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  // Another currency: a new payment date asks CBAR for its rate.
  const fetchRate = async (date: string) => {
    if (!foreign || !onFetchRate) return;
    setRateBusy(true);
    const r = await onFetchRate(date);
    setRateBusy(false);
    if (r && r > 0) setRate(r);
  };
  useEffect(() => {
    if (foreign && onFetchRate && !defaultRate) void fetchRate(paymentDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A single line follows the payment amount (another currency: amount × rate).
  useEffect(() => {
    if (!foreign) return;
    setLines((ls) => (ls.length === 1 ? [{ ...ls[0], amount: Math.round((amountFc ?? 0) * (rate ?? 0) * 100) / 100 }] : ls));
  }, [foreign, amountFc, rate]);

  const ctx = { currency, openBalance: open, allowAdvance: allowAdvance || free, amountFc, rate, maxLines };
  const check = checkPayment(lines, ctx);
  const dateIssue = validatePaymentDate(paymentDate, maxDate ?? todayLocalDate(), minDate ?? undefined);
  const fixedMismatch = fixedAmount != null && Math.abs(check.totals.totalAzn - fixedAmount) > 0.005;
  const canSubmit = !busy && !check.issues.length && !dateIssue && !fixedMismatch && lines.length > 0;
  const showProblems = attempted || lines.some((l) => l.amount > 0 || l.accountId);
  const money = (n: number, cur: string | null = "AZN") => formatMoney(n, locale, { currency: cur });
  const methodLabel = (m: PaymentMethod) => t(`paymentDialog.methods.${m}`);

  const settled = foreign && bookingRate ? Math.round((amountFc ?? 0) * bookingRate * 100) / 100 : null;
  const preview = entryPreview({
    direction,
    counterpartyCode: counterpartyCode === undefined ? (direction === "out" ? "2100" : "1200") : counterpartyCode,
    counterpartyLabel: counterpartyName || counterpartyLabel,
    lines,
    accounts,
    settledAzn: settled,
    fxLabels: { loss: t("paymentDialog.fxLoss"), gain: t("paymentDialog.fxGain") },
  });

  const columns = useMemo<LineColumn<PaymentLine>[]>(
    () => [
      {
        key: "account",
        header: t("paymentDialog.account"),
        type: "text",
        width: 220,
        error: (l) => (check.badLines.includes(l.key) && !l.accountId ? t("paymentDialog.issues.account_required") : null),
        cell: (l, c) => (
          <span className="ds-line-lookup">
            <EntityLookup
              entity="account"
              size="sm"
              width="full"
              // Del: a bank account is never created from a payment.
              allowCreate={false}
              inlineAdd={false}
              // Given accounts (a role's cash accounts): only those can be picked.
              allowedIds={givenAccounts ? accounts.map((x) => x.id) : undefined}
              value={l.accountId}
              selectedLabel={accounts.find((a) => a.id === l.accountId)?.name}
              invalid={c.invalid}
              onChange={(id, row) => {
                const acc = accounts.find((a) => a.id === id) ?? (row ? { id: row.id, name: String(row.name ?? ""), type: (row.type as string | null) ?? null } : null);
                if (row && !accounts.some((a) => a.id === row.id)) setAccounts((as) => [...as, { id: row.id, name: String(row.name ?? ""), type: (row.type as string | null) ?? null, balance: (row.balance as number | null) ?? null }]);
                setLines((ls) => ls.map((x) => (x.key === l.key ? setLineAccount(x, acc, methodTouched.has(l.key)) : x)));
              }}
              aria-label={c.label}
            />
          </span>
        ),
      },
      {
        key: "method",
        header: t("paymentDialog.method"),
        type: "code",
        width: 128,
        cell: (l, c) => (
          <LineSelectCell
            ctx={c}
            value={l.method}
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: methodLabel(m) }))}
            onChange={(next) => {
              setMethodTouched((s) => new Set(s).add(l.key));
              setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, method: next as PaymentMethod } : x)));
            }}
          />
        ),
      },
      {
        key: "amount",
        header: `${t("paymentDialog.amount")}, AZN`,
        type: "money",
        width: 120,
        error: (l) => (check.badLines.includes(l.key) && !(l.amount > 0) ? t("paymentDialog.issues.amount_positive") : null),
        cell: (l, c) => <LineNumberCell ctx={c} value={l.amount} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, amount: v ?? 0 } : x)))} />,
        total: <span className="ds-line-text">{money(check.totals.totalAzn)}</span>,
      },
      {
        key: "note",
        header: t("paymentDialog.lineNote"),
        type: "text",
        width: 160,
        cell: (l, c) => <LineTextCell ctx={c} maxLength={200} value={l.note} placeholder={t("paymentDialog.lineNotePlaceholder")} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, note: v } : x)))} />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, check.badLines.join(","), check.totals.totalAzn, methodTouched, t, locale]
  );

  const submit = async () => {
    setAttempted(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const r = await onSubmit({
      paymentDate,
      lines: paymentLinesPayload(lines),
      totalAzn: check.totals.totalAzn,
      amountFc: foreign ? amountFc : null,
      rate: foreign ? rate : null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (!r.success) {
      setError(r.error || t("paymentDialog.failed"));
      return;
    }
    try {
      const first = lines.find((l) => l.accountId)?.accountId;
      if (first) window.localStorage.setItem(storageKey, first);
    } catch {
      // Storage blocked: the next payment starts from the first account.
    }
    onClose();
  };

  const remainingLabel = check.totals.remaining < -0.005 ? t("paymentDialog.advance") : t("paymentDialog.remaining");
  const issueTexts = [
    ...check.issues.map((i) =>
      i === "overpay"
        ? t("paymentDialog.issues.overpay", { open: money(open, currency) })
        : i === "lines_mismatch"
          ? t("paymentDialog.issues.lines_mismatch", { target: money(check.totals.targetAzn ?? 0), left: money(check.totals.unassignedAzn) })
          : i === "too_many_lines"
            ? t("paymentDialog.issues.too_many_lines", { max: maxLines ?? 1 })
            : t(`paymentDialog.issues.${i}`)
    ),
    ...(fixedMismatch ? [t("paymentDialog.issues.fixed_mismatch", { amount: money(fixedAmount ?? 0) })] : []),
  ];

  return (
    <Dialog.Root open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
      <Dialog.Portal container={portalContainer ?? undefined}>
        <Dialog.Overlay asChild>
          <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" />
        </Dialog.Overlay>
        <Dialog.Content asChild aria-describedby="payment-dialog-summary">
          <motion.div
            className="ds-panel ds-payment-dialog fixed left-1/2 top-1/2 z-[var(--ds-z-modal-content)] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain p-6"
            variants={motionPreset(panelVariants, reduced)}
            initial="initial"
            animate="enter"
            data-ui-frame="payment-dialog"
          >
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Dialog.Title className="text-[length:var(--ds-text-lg)] font-semibold">
                    {title ?? (direction === "out" ? t("paymentDialog.titleOut") : t("paymentDialog.titleIn"))}
                  </Dialog.Title>
                  <p id="payment-dialog-summary" className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[length:var(--ds-text-sm)] ds-muted">
                    {counterpartyField ? null : (
                      <span>
                        {counterpartyLabel}: <strong className="text-[color:var(--ds-text)]">{counterpartyName || "—"}</strong>
                      </span>
                    )}
                    {documentLabel ? (
                      <span>
                        {documentLabel}: <strong className="text-[color:var(--ds-text)]">{documentNumber || "—"}</strong>
                      </span>
                    ) : null}
                    {free ? null : (
                      <span>
                        {t("paymentDialog.openBalance")}: <strong className="ds-mono tabular-nums text-[color:var(--ds-text)]">{money(open, currency)}</strong>
                      </span>
                    )}
                  </p>
                </div>
                <Dialog.Close asChild>
                  <IconButton size="sm" label={t("common.close")} icon={<X className="h-4 w-4" />} disabled={busy} />
                </Dialog.Close>
              </div>

              <FormGrid columns={foreign ? 4 : 2}>
                {counterpartyField ? (
                  <Field label={counterpartyLabel} span={foreign ? 4 : 2}>
                    {counterpartyField}
                  </Field>
                ) : null}
                <Field
                  label={t("paymentDialog.date")}
                  required
                  error={
                    dateIssue === "date_in_future"
                      ? t("modals.payment.futureDate")
                      : dateIssue === "before_document_date" && minDate
                        ? t("modals.payment.beforeDocumentDate", { date: formatDayMonthYear(minDate) })
                        : dateIssue
                          ? t("modals.payment.date")
                          : null
                  }
                >
                  {({ id }) => (
                    <DateField
                      id={id}
                      value={paymentDate}
                      onChange={(v) => {
                        setPaymentDate(v ?? "");
                        if (v) void fetchRate(v);
                      }}
                      locale={locale}
                      labels={dateFieldLabels(t)}
                      width="full"
                      aria-label={t("paymentDialog.date")}
                    />
                  )}
                </Field>
                {foreign ? (
                  <>
                    <Field label={`${t("paymentDialog.amount")}, ${currency}`} required>
                      {({ id }) => (
                        <NumberInput id={id} value={amountFc} onChange={setAmountFc} label={`${t("paymentDialog.amount")}, ${currency}`} />
                      )}
                    </Field>
                    <Field label={t("paymentDialog.rate", { currency })} required hint={bookingRate ? t("paymentDialog.bookingRate", { rate: bookingRate }) : undefined}>
                      {({ id }) => (
                        <span className="ds-rate-field">
                          <NumberInput id={id} value={rate} onChange={setRate} label={t("paymentDialog.rate", { currency })} />
                          {onFetchRate ? (
                            <IconButton
                              size="sm"
                              label={t("paymentDialog.fetchRate", { date: formatDayMonthYear(paymentDate) })}
                              icon={<RefreshCw className={`h-4 w-4 ${rateBusy ? "animate-spin motion-reduce:animate-none" : ""}`} />}
                              disabled={rateBusy}
                              onClick={() => void fetchRate(paymentDate)}
                            />
                          ) : null}
                        </span>
                      )}
                    </Field>
                    <Field label={t("paymentDialog.inAzn")}>
                      <span className="ds-mono flex h-[var(--ds-control-h,2.25rem)] items-center justify-end tabular-nums">{money(check.totals.targetAzn ?? 0)}</span>
                    </Field>
                  </>
                ) : null}
                <Field label={t("paymentDialog.note")} span={foreign ? 4 : 1}>
                  {({ id }) => <input id={id} className="ds-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t("paymentDialog.notePlaceholder")} />}
                </Field>
                {extraFields ? <div className="col-span-full">{extraFields}</div> : null}
              </FormGrid>

              {presets?.length ? (
                <div className="flex flex-wrap items-center gap-2 text-[length:var(--ds-text-sm)]" role="group" aria-label={t("paymentDialog.presets")}>
                  <span className="ds-muted">{t("paymentDialog.presets")}:</span>
                  {presets.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      className={`ds-btn ds-btn-sm ${preset === p.key ? "ds-btn-primary" : ""}`}
                      aria-pressed={preset === p.key}
                      onClick={() => {
                        setPreset(p.key);
                        setLines(initialPaymentLines({ amount: check.totals.totalAzn || startAmount, accounts, preset: p.build(check.totals.totalAzn || startAmount, accounts) }));
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                  {preset ? (
                    <button
                      type="button"
                      className="ds-btn ds-btn-sm ds-btn-ghost"
                      onClick={() => {
                        setPreset(null);
                        setLines(initialPaymentLines({ amount: check.totals.totalAzn || startAmount, accounts }));
                      }}
                    >
                      {t("paymentDialog.oneAccount")}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <LineGrid
                id="payment-lines"
                label={t("paymentDialog.lines")}
                lines={lines}
                lineKey={(l) => l.key}
                lineLabel={(l, i) => accounts.find((a) => a.id === l.accountId)?.name || String(i + 1)}
                columns={columns}
                labels={{ ...lineGridLabels(t), addLine: t("paymentDialog.addAccount"), empty: t("paymentDialog.noLines") }}
                editable
                scoped={false}
                onAddLine={maxLines !== undefined && lines.length >= maxLines ? undefined : () => setLines((ls) => addPaymentLine(ls, foreign ? check.totals.unassignedAzn : check.totals.remaining))}
                onRemove={lines.length > 1 ? (index) => setLines((ls) => ls.filter((_, i) => i !== index)) : undefined}
              />

              <dl className="ds-stat-strip" aria-live="polite">
                <div>
                  <dt>{t("paymentDialog.total")}</dt>
                  <dd>{money(check.totals.totalAzn)}</dd>
                </div>
                {free ? null : (
                  <>
                    <div>
                      <dt>{t("paymentDialog.openBalance")}</dt>
                      <dd>{money(open, currency)}</dd>
                    </div>
                    <div data-emphasis="">
                      <dt>{remainingLabel}</dt>
                      <dd>{money(Math.abs(check.totals.remaining), currency)}</dd>
                    </div>
                  </>
                )}
              </dl>

              <div className="ds-entry-preview" aria-label={t("paymentDialog.preview")}>
                <span className="ds-label">{t("paymentDialog.preview")}</span>
                <span className="ds-mono text-[length:var(--ds-text-sm)]">
                  {preview.filter((r) => r.side === "Dt").map((r) => previewText(r, (n) => money(n, null))).join(", ")}
                  {" / "}
                  {preview.filter((r) => r.side === "Kt").map((r) => previewText(r, (n) => money(n, null))).join(", ")}
                </span>
              </div>

              {(issueTexts.length && showProblems) || error ? (
                <ul className="flex flex-col gap-1 text-[length:var(--ds-text-xs)]" role="alert">
                  {error ? <li style={{ color: "var(--ds-danger-strong)" }}>{error}</li> : null}
                  {lines.length && showProblems ? issueTexts.map((m) => <li key={m} style={{ color: "var(--ds-danger-strong)" }}>{m}</li>) : null}
                </ul>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                <Dialog.Close asChild>
                  <button type="button" className="ds-btn" disabled={busy}>
                    {t("common.cancel")}
                  </button>
                </Dialog.Close>
                <button type="submit" className="ds-btn ds-btn-primary" disabled={busy || (attempted && !canSubmit)} aria-busy={busy || undefined}>
                  {busy ? t("paymentDialog.paying") : submitLabel ?? (direction === "out" ? t("paymentDialog.pay") : t("paymentDialog.receive"))}
                </button>
              </div>
            </form>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A decimal input that keeps what is typed ("1," or "0."). */
function NumberInput({ id, value, onChange, label }: { id?: string; value: number | null; onChange: (v: number | null) => void; label: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    if (Number(text.replace(",", ".")) !== value) setText(value === null ? "" : String(value));
  }
  return (
    <input
      id={id}
      className="ds-input ds-mono w-full text-end tabular-nums"
      inputMode="decimal"
      type="text"
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const raw = e.target.value.replace(",", ".").trim();
        const n = raw === "" ? null : Number(raw);
        if (n === null || (Number.isFinite(n) && n >= 0)) {
          setLast(n);
          onChange(n);
        }
      }}
    />
  );
}
