"use client";

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, CheckCircle2, Paperclip, PencilLine, Plus, Send, Wallet, XCircle } from "lucide-react";
import { useToast, useUiStandard } from "@/design-system/components";
import { PaymentDialog } from "@/components/payments/PaymentDialog";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { EngineScreen, FormView, invalidateModel, useFormatter, type FormAction, type RowActionSpec } from "@/views";
import {
  approveExpenseAction,
  cancelExpenseAction,
  fetchExpenseFormOptionsAction,
  fetchExpensesAction,
  postExpenseAction,
  reimburseExpenseAction,
  rejectExpenseAction,
  saveExpenseAction,
  submitExpenseAction,
  type ExpenseFormOptions,
} from "../actions/expenses";
import { isOwedToEmployee, todayIsoDate, type ExpenseDocument, type ExpenseSaveInput } from "../lib/expenseDocuments";
import { expenseKpis, expensesDefinition, EXPENSES_VIEW_KEY, type ExpenseRecord } from "../views/expenses";
import ExpenseAttachmentsModal from "./ExpenseAttachmentsModal";
import ExpenseFormModal from "./ExpenseFormModal";

const ROWS_KEY = ["views", EXPENSES_VIEW_KEY, "rows"] as const;
const fetchAll = async () => {
  // All dates (the classic page asks for one period at a time); the search panel narrows them.
  const res = await fetchExpensesAction({});
  if (!res.success) throw new Error(res.error);
  return (res.data?.rows ?? []) as unknown as Record<string, unknown>[];
};
const DEFINITION = expensesDefinition({ fetchAll });

/** Expense documents on the view engine (new UI), with the classic approval flow. */
export default function ExpensesScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const options = useQuery({
    queryKey: ["expenses", "form-options"],
    queryFn: async () => {
      const res = await fetchExpenseFormOptionsAction();
      if (!res.success) throw new Error(res.error);
      return res.data as ExpenseFormOptions;
    },
  });
  // The classic expense form dialog, opened from the page (new) or from a draft's panel (edit).
  const [form, setForm] = useState<{ initial: ExpenseDocument | null } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (input: ExpenseSaveInput) => {
    setSaving(true);
    const res = await saveExpenseAction(input);
    setSaving(false);
    if (!res.success || !res.data) {
      toast(t("common.error"), formatRpcError(res.success ? undefined : res.error, t), "error");
      return;
    }
    toast(res.data.status === "posted" ? t("expenses.doc.postedToast", { code: res.data.code }) : t("expenses.doc.draftToast", { code: res.data.code }), undefined, "success");
    setForm(null);
    await invalidateModel(client, EXPENSES_VIEW_KEY);
  };

  return (
    <>
      <EngineScreen
        definition={DEFINITION}
        title={t("expenses.pageTitle")}
        kpis={(records, fmt, ctx) => expenseKpis(records, fmt, ctx.now)}
        actions={
          can("can_manage_expenses") ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" disabled={!options.data} onClick={() => setForm({ initial: null })}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("expenses.createButton")}
            </button>
          ) : null
        }
        recordTitle={(r) => r.code}
        rowActions={(r) => expenseRowActions(r, t, can)}
        renderRecord={(r, { close }) => (
          <ExpenseRecordView
            record={r}
            options={options.data ?? null}
            onEdit={(doc) => {
              close();
              setForm({ initial: doc });
            }}
          />
        )}
      />
      {form && options.data ? <ExpenseFormModal options={options.data} initial={form.initial} saving={saving} onClose={() => setForm(null)} onSubmit={(input) => void save(input)} /> : null}
    </>
  );
}

/**
 * The row "…" menu of the expense list (UI-5): the classic row menu, with the same conditions as
 * ExpenseRecordView's form, which runs the picked action (?do=). Reimbursing needs the full
 * document, so the form decides that one (it is offered while the expense is approved or posted).
 */
function expenseRowActions(r: ExpenseRecord, t: (key: string, params?: Record<string, string | number>) => string, can: ReturnType<typeof useAuth>["can"]): RowActionSpec[] {
  const canManage = can("can_manage_expenses");
  const canFinance = can("can_manage_finance");
  const byEmployee = r.payment_mode === "employee";
  const open = r.status === "draft" || r.status === "submitted";
  const icon = (C: typeof Ban) => <C className="h-4 w-4" />;
  return [
    { key: "edit", label: t("common.edit"), icon: icon(PencilLine), hidden: !(open && canManage) },
    { key: "submit", label: t("expenses.doc.sendForApproval"), icon: icon(Send), hidden: !(r.status === "draft" && canManage) },
    { key: "post", label: t("expenses.doc.post"), icon: icon(Check), hidden: !(r.status === "draft" && !byEmployee && canManage) },
    { key: "approve", label: byEmployee ? t("expenses.doc.approve") : t("expenses.doc.approveAndPay"), icon: icon(CheckCircle2), hidden: !(r.status === "submitted" && canFinance) },
    { key: "reject", label: t("expenses.doc.reject"), icon: icon(XCircle), hidden: !(r.status === "submitted" && canFinance) },
    { key: "reimburse", label: t("expenses.doc.reimburse"), icon: icon(Wallet), hidden: !(byEmployee && canFinance && (r.status === "approved" || r.status === "posted")) },
    { key: "attachments", label: t("expenses.doc.attachmentsAction", { count: r.attachment_count }), icon: icon(Paperclip) },
    {
      key: "cancel",
      label: t("expenses.doc.cancelExpense"),
      icon: icon(Ban),
      destructive: true,
      hidden: !(r.status !== "cancelled" && !r.is_production && canManage && !((r.status === "approved" || (r.status === "posted" && byEmployee)) && !canFinance)),
    },
  ];
}

type Step = "reject" | "cancel" | "reimburse" | null;

function ExpenseRecordView({ record, options, onEdit }: { record: ExpenseRecord; options: ExpenseFormOptions | null; onEdit: (doc: ExpenseDocument) => void }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const client = useQueryClient();
  const { can } = useAuth();
  const { toast } = useToast();
  const rows = useQuery({ queryKey: ROWS_KEY, queryFn: fetchAll });
  const doc = (rows.data as unknown as ExpenseDocument[] | undefined)?.find((d) => d.id === record.id) ?? null;
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>(null);
  const [reason, setReason] = useState("");
  const [accountId, setAccountId] = useState("");
  const [payDate, setPayDate] = useState(() => todayIsoDate());
  const [attachments, setAttachments] = useState(false);
  const uiStandard = useUiStandard();
  const canManage = can("can_manage_expenses");
  const canFinance = can("can_manage_finance");
  const byEmployee = record.payment_mode === "employee";
  const isOpen = record.status === "draft" || record.status === "submitted";

  const run = async (action: () => Promise<{ success: boolean; error?: string }>, successKey: string) => {
    setBusy(true);
    const res = await action();
    setBusy(false);
    if (!res.success) {
      toast(t("common.error"), formatRpcError(res.error, t), "error");
      return false;
    }
    toast(t(successKey, { code: record.code }), undefined, "success");
    setStep(null);
    setReason("");
    await invalidateModel(client, EXPENSES_VIEW_KEY);
    return true;
  };

  // The classic row menu, with the same conditions.
  const actions: FormAction[] = [
    ...(isOpen && canManage && doc ? [{ key: "edit", label: t("common.edit"), icon: <PencilLine className="h-4 w-4" aria-hidden />, onClick: () => onEdit(doc) }] : []),
    ...(record.status === "draft" && canManage ? [{ key: "submit", label: t("expenses.doc.sendForApproval"), primary: true, disabled: busy, icon: <Send className="h-4 w-4" aria-hidden />, onClick: () => void run(() => submitExpenseAction(record.id), "expenses.doc.submittedToast") }] : []),
    ...(record.status === "draft" && !byEmployee && canManage ? [{ key: "post", label: t("expenses.doc.post"), disabled: busy, icon: <Check className="h-4 w-4" aria-hidden />, onClick: () => void run(() => postExpenseAction(record.id), "expenses.doc.postedToast") }] : []),
    ...(record.status === "submitted" && canFinance
      ? [
          { key: "approve", label: byEmployee ? t("expenses.doc.approve") : t("expenses.doc.approveAndPay"), primary: true, disabled: busy, icon: <CheckCircle2 className="h-4 w-4" aria-hidden />, onClick: () => void run(() => approveExpenseAction(record.id), "expenses.doc.approvedToast") },
          { key: "reject", label: t("expenses.doc.reject"), disabled: busy, icon: <XCircle className="h-4 w-4" aria-hidden />, onClick: () => setStep("reject") },
        ]
      : []),
    ...(doc && isOwedToEmployee(doc) && canFinance ? [{ key: "reimburse", label: t("expenses.doc.reimburse"), primary: true, disabled: busy, icon: <Wallet className="h-4 w-4" aria-hidden />, onClick: () => setStep("reimburse") }] : []),
    ...(doc ? [{ key: "attachments", label: t("expenses.doc.attachmentsAction", { count: record.attachment_count }), icon: <Paperclip className="h-4 w-4" aria-hidden />, onClick: () => setAttachments(true) }] : []),
    ...(record.status !== "cancelled" && !record.is_production && canManage && !((record.status === "approved" || (record.status === "posted" && byEmployee)) && !canFinance)
      ? [{ key: "cancel", label: t("expenses.doc.cancelExpense"), disabled: busy, icon: <Ban className="h-4 w-4" aria-hidden />, onClick: () => setStep("cancel") }]
      : []),
  ];

  const stepForm =
    step === "reject" || step === "cancel" ? (
      <form
        className="ds-card ds-card-pad mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (step === "reject"
            ? run(() => rejectExpenseAction(record.id, reason), "expenses.doc.rejectedToast")
            : run(() => cancelExpenseAction(record.id, reason), "expenses.doc.cancelledToast"));
        }}
      >
        <h3 className="font-semibold">{step === "reject" ? t("expenses.doc.rejectTitle", { code: record.code }) : t("expenses.doc.cancelTitle", { code: record.code })}</h3>
        <p className="ds-muted">
          {step === "reject"
            ? t("expenses.doc.rejectHint")
            : record.status === "posted"
              ? t("expenses.doc.cancelPostedHint")
              : doc && isOwedToEmployee(doc)
                ? t("expenses.doc.cancelOwedHint")
                : t("expenses.doc.cancelDraftHint")}
        </p>
        <label className="flex flex-col gap-1">
          <span className="ds-label">{step === "reject" ? t("expenses.doc.rejectReason") : t("expenses.doc.cancelReason")}</span>
          <textarea className="ds-input min-h-20 py-2" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setStep(null)}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="ds-btn ds-btn-sm ds-btn-danger" disabled={busy}>
            {step === "reject" ? t("expenses.doc.reject") : t("expenses.doc.cancelConfirm")}
          </button>
        </div>
      </form>
    ) : step === "reimburse" && uiStandard ? (
      // IMP-5: the one payment dialog; reimburse_expense_atomic pays from one account.
      <PaymentDialog
        open
        onClose={() => setStep(null)}
        direction="out"
        title={t("expenses.doc.reimburseTitle", { code: record.code })}
        counterpartyLabel={t("paymentDialog.employee")}
        counterpartyName={record.employee_name ?? "—"}
        counterpartyCode={null}
        documentLabel={t("expenses.doc.code")}
        documentNumber={record.code}
        openBalance={record.amount}
        fixedAmount={record.amount}
        maxLines={1}
        minDate={record.expense_date ?? null}
        accounts={(options?.accounts ?? []).map((a) => ({ id: a.id, name: a.name, balance: a.balance }))}
        submitLabel={t("expenses.doc.reimburse")}
        onSubmit={async (p) => {
          const account = p.lines[0]?.account_id;
          if (!account) return { success: false, error: t("expenses.selectAccountAlert") };
          const ok = await run(() => reimburseExpenseAction(record.id, account, p.paymentDate), "expenses.doc.reimbursedToast");
          return ok ? { success: true } : { success: false };
        }}
      />
    ) : step === "reimburse" ? (
      <form
        className="ds-card ds-card-pad mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!accountId) {
            toast(t("expenses.selectAccountAlert"), undefined, "error");
            return;
          }
          void run(() => reimburseExpenseAction(record.id, accountId, payDate), "expenses.doc.reimbursedToast");
        }}
      >
        <h3 className="font-semibold">{t("expenses.doc.reimburseTitle", { code: record.code })}</h3>
        <p className="ds-muted">{t("expenses.doc.reimburseHint", { name: record.employee_name ?? "—", amount: record.amount.toFixed(2) })}</p>
        <label className="flex flex-col gap-1">
          <span className="ds-label">{t("expenses.paymentAccountRequired")}</span>
          <select className="ds-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{t("expenses.selectAccount")}</option>
            {(options?.accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {t("expenses.accountBalance", { name: a.name, balance: a.balance.toFixed(2) })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="ds-label">{t("expenses.doc.payDate")}</span>
          <input type="date" className="ds-input" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setStep(null)}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={busy}>
            {t("expenses.doc.reimburse")}
          </button>
        </div>
      </form>
    ) : null;

  return (
    <>
      <FormView definition={DEFINITION} record={record} canWrite={false} fmt={fmt} actions={actions} />
      {stepForm}
      {attachments && doc ? (
        <ExpenseAttachmentsModal
          expense={doc}
          canUpload={canManage}
          canDeleteBooked={canFinance}
          onClose={() => setAttachments(false)}
          onChanged={() => void invalidateModel(client, EXPENSES_VIEW_KEY)}
        />
      ) : null}
    </>
  );
}
