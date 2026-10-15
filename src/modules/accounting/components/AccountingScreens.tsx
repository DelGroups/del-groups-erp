"use client";

import React, { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PencilLine, Plus, Trash2 } from "lucide-react";
import { TypeToConfirmDialog, useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import PaymentFormModal from "@/components/payments/PaymentFormModal";
import { useI18n } from "@/i18n/I18nProvider";
import { createAccountAction, deleteAccountAction, fetchAccountLedgerBalancesAction, fetchUnifiedLedgerAction, updateAccountAction } from "@/lib/actions/finance";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { fetchPartnerPayments } from "@/lib/payments/fetchPayments";
import type { UnifiedLedgerTransaction } from "@/lib/finance/unifiedLedger";
import { EngineScreen, FormView, invalidateModel, RecordPanel, useFormatter, type FormAction } from "@/views";
import {
  accountKpis,
  accountsDefinition,
  ACCOUNTS_VIEW_KEY,
  ledgerDefinition,
  ledgerKpis,
  LEDGER_VIEW_KEY,
  paymentKpis,
  paymentsDefinition,
  PAYMENTS_VIEW_KEY,
  type AccountRecord,
  type LedgerRecord,
} from "../views/accounting";
import UnifiedLedgerRowActions from "./UnifiedLedgerRowActions";

type Row = Record<string, unknown>;
const fetchLedger = async () => {
  const r = await fetchUnifiedLedgerAction();
  if (!r.success || !r.data) throw new Error(r.success ? "" : r.error);
  return r.data.transactions as unknown as Row[];
};
const LEDGER = ledgerDefinition({ fetchAll: fetchLedger });
const ACCOUNTS = accountsDefinition({
  fetchAll: async () => {
    const r = await fetchAccountLedgerBalancesAction();
    if (!r.success || !r.data) throw new Error(r.success ? "" : r.error);
    return r.data.accounts as unknown as Row[];
  },
});
const PAYMENTS = paymentsDefinition({ fetchAll: async () => (await fetchPartnerPayments()) as unknown as Row[] });

// ── Finance ledger ───────────────────────────────────────────────────────────

/** The unified finance ledger on the view engine (new UI). */
export function FinanceLedgerScreen() {
  const { t } = useI18n();
  return (
    <EngineScreen
      definition={LEDGER}
      title={t("finance.title")}
      kpis={(records, fmt, ctx) => ledgerKpis(records, fmt, ctx.now)}
      recordTitle={(r) => `${r.category} · ${r.transaction_date}`}
      renderRecord={(r) => <LedgerRecordView record={r} />}
    />
  );
}

function LedgerRecordView({ record }: { record: LedgerRecord }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const client = useQueryClient();
  const { can } = useAuth();
  const { toast } = useToast();
  // The classic row menu (view, edit, print receipt, delete), with its own rules: lines that
  // belong to sales, purchases, production, expenses or payroll are changed there, not here.
  const canManage = can("can_manage_finance") || can("can_manage_expenses");
  const raw = (client.getQueryData(["views", LEDGER_VIEW_KEY, "rows"]) as UnifiedLedgerTransaction[] | undefined)?.find((x) => x.id === record.id);
  return (
    <div className="flex flex-col gap-3">
      {raw ? (
        <div className="flex items-center justify-end gap-2">
          <span className="ds-muted text-[length:var(--ds-text-xs)]">{t("common.actions")}</span>
          <UnifiedLedgerRowActions
            transaction={raw}
            canManage={canManage}
            onChanged={() => void invalidateModel(client, LEDGER_VIEW_KEY)}
            onError={(message) => toast(t("common.error"), message, "error")}
            onSuccess={(message) => toast(message, undefined, "success")}
          />
        </div>
      ) : null}
      <FormView definition={LEDGER} record={record} canWrite={false} fmt={fmt} />
    </div>
  );
}

// ── Cash and bank accounts ───────────────────────────────────────────────────

type AccountForm = { id: string | null; code: string; name: string; type: string; balance: string };

/** Cash registers and bank accounts on the view engine (new UI). */
export function CashBankScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [form, setForm] = useState<AccountForm | null>(null);
  const canManage = can("can_manage_finance");
  return (
    <>
      <EngineScreen
        definition={ACCOUNTS}
        title={t("cashBank.pageTitle")}
        kpis={(records, fmt) => accountKpis(records, fmt)}
        actions={
          canManage ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setForm({ id: null, code: "", name: "", type: "Kassa", balance: "0.00" })}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("cashBank.createButton")}
            </button>
          ) : null
        }
        recordTitle={(r) => r.name}
        renderRecord={(r, { close }) => (
          <AccountRecordView
            record={r}
            canManage={canManage}
            onEdit={() => {
              close();
              setForm({ id: r.id, code: r.code, name: r.name, type: r.type, balance: r.balance.toFixed(2) });
            }}
            onDeleted={close}
          />
        )}
      />
      <AccountFormPanel form={form} onClose={() => setForm(null)} />
    </>
  );
}

function AccountRecordView({ record, canManage, onEdit, onDeleted }: { record: AccountRecord; canManage: boolean; onEdit: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const client = useQueryClient();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const actions: FormAction[] = canManage
    ? [
        { key: "edit", label: t("common.edit"), primary: true, icon: <PencilLine className="h-4 w-4" aria-hidden />, onClick: onEdit },
        { key: "delete", label: t("common.delete"), icon: <Trash2 className="h-4 w-4" aria-hidden />, onClick: () => setDeleting(true) },
      ]
    : [];
  return (
    <>
      <FormView definition={ACCOUNTS} record={record} canWrite={false} fmt={fmt} actions={actions} />
      <TypeToConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        confirmText={record.name}
        labels={{
          title: t("common.delete"),
          description: t("accounting.engine.deleteAccount"),
          instruction: t("accounting.engine.typeName"),
          copy: t("sales.engine.void.copy"),
          cancel: t("common.cancel"),
          confirm: t("common.delete"),
          working: t("common.loading"),
          audit: t("accounting.engine.deleteAudit"),
        }}
        onConfirm={async () => {
          const result = await deleteAccountAction(record.id);
          if (!result.success) {
            toast(t("common.error"), t("common.errorOccurred", { message: formatRpcError(result.error, t) }), "error");
            return;
          }
          toast(t("cashBank.deleteSuccess"), undefined, "success");
          await invalidateModel(client, ACCOUNTS_VIEW_KEY);
          onDeleted();
        }}
      />
    </>
  );
}

/**
 * New or edited account (the classic dialog is written inside its page): code, name, type and,
 * for a new account, the opening balance. Saved with the same server actions.
 */
function AccountFormPanel({ form, onClose }: { form: AccountForm | null; onClose: () => void }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const { toast } = useToast();
  const [values, setValues] = useState<AccountForm | null>(form);
  const [saving, setSaving] = useState(false);
  const [shown, setShown] = useState<AccountForm | null>(form);
  if (form !== shown) {
    // A new form was opened: start from its values.
    setShown(form);
    setValues(form);
  }
  const base = useId();
  if (!values) return <RecordPanel open={false} onClose={onClose} title="" closeLabel={t("common.close")}>{null}</RecordPanel>;
  const set = (patch: Partial<AccountForm>) => setValues((v) => (v ? { ...v, ...patch } : v));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const result = values.id
      ? await updateAccountAction({ accountId: values.id, code: values.code, name: values.name, type: values.type })
      : await createAccountAction({ code: values.code, name: values.name, type: values.type, balance: parseFloat(values.balance) || 0 });
    setSaving(false);
    if (!result.success) {
      toast(t("common.error"), t("common.errorOccurred", { message: formatRpcError(result.error, t) }), "error");
      return;
    }
    if (values.id) toast(t("cashBank.updateSuccess"), undefined, "success");
    await invalidateModel(client, ACCOUNTS_VIEW_KEY);
    onClose();
  };
  return (
    <RecordPanel open onClose={onClose} title={values.id ? t("cashBank.editModalTitle") : t("cashBank.addModalTitle")} closeLabel={t("common.close")}>
      <form onSubmit={submit} className="ds-card ds-card-pad flex max-w-xl flex-col gap-4">
        <label className="flex flex-col gap-1" htmlFor={`${base}-code`}>
          <span className="ds-label">{t("cashBank.accountCode")}</span>
          <input id={`${base}-code`} className="ds-input" value={values.code} placeholder={t("cashBank.accountCodePlaceholder")} onChange={(e) => set({ code: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${base}-name`}>
          <span className="ds-label">{t("cashBank.accountNameRequired")}</span>
          <input id={`${base}-name`} className="ds-input" required value={values.name} placeholder={t("cashBank.accountNamePlaceholder")} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${base}-type`}>
          <span className="ds-label">{t("cashBank.typeRequired")}</span>
          <select id={`${base}-type`} className="ds-input" value={values.type} onChange={(e) => set({ type: e.target.value })}>
            <option value="Kassa">{t("cashBank.typeCash")}</option>
            <option value="Bank">{t("cashBank.typeBank")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${base}-balance`}>
          <span className="ds-label">{t("cashBank.initialBalance")}</span>
          <input id={`${base}-balance`} className="ds-input" type="number" step="0.01" value={values.balance} disabled={!!values.id} onChange={(e) => set({ balance: e.target.value })} />
          {values.id ? <span className="ds-muted text-[length:var(--ds-text-xs)]">{t("cashBank.balanceEditHint")}</span> : null}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={saving}>
            {t("common.save")}
          </button>
        </div>
      </form>
    </RecordPanel>
  );
}

// ── Partner payments ─────────────────────────────────────────────────────────

/** Partner payments on the view engine (new UI); new payments use the classic dialog. */
export function PaymentsScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const fmt = useFormatter();
  return (
    <>
      <EngineScreen
        definition={PAYMENTS}
        title={t("payments.pageTitle")}
        kpis={(records, f, ctx) => paymentKpis(records, f, ctx.now)}
        actions={
          can("can_manage_finance") ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("payments.newPayment")}
            </button>
          ) : null
        }
        recordTitle={(r) => r.partner_name}
        renderRecord={(r) => <FormView definition={PAYMENTS} record={r} canWrite={false} fmt={fmt} />}
      />
      <PaymentFormModal open={creating} onClose={() => setCreating(false)} onSaved={() => void invalidateModel(client, PAYMENTS_VIEW_KEY)} />
    </>
  );
}
