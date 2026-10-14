"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Printer, RotateCcw, Trash2 } from "lucide-react";
import { TypeToConfirmDialog, useToast } from "@/design-system/components";
import { formatFigure } from "@/design-system/logic";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { deleteContractAction } from "@/lib/actions/entityDelete";
import { EngineScreen, FormView, invalidateModel, useFormatter, type FormAction } from "@/views";
import { fetchContracts, fetchLinkedDocuments, updateContract, type Contract } from "../lib/api";
import { contractKpis, contractsDefinition, CONTRACTS_VIEW_KEY, type ContractRecord } from "../views/contracts";
import ContractAttachmentButton from "./ContractAttachmentButton";
import ContractPrintTemplate, { type ContractPrintData } from "./ContractPrintTemplate";

const fetchAll = async () => (await fetchContracts()) as unknown as Record<string, unknown>[];
const DEFINITION = contractsDefinition({ fetchAll });

/** Contracts on the view engine (new UI). Creating and editing contracts stays in the classic page. */
export default function ContractsScreen() {
  const { t } = useI18n();
  return (
    <EngineScreen
      definition={DEFINITION}
      title={t("official.contractsPageTitle")}
      kpis={(records, fmt, ctx) => contractKpis(records, fmt, ctx.now)}
      recordTitle={(r) => `${r.contract_number} · ${r.title}`}
      renderRecord={(r, { close }) => <ContractRecordView record={r} close={close} />}
    />
  );
}

function ContractRecordView({ record, close }: { record: ContractRecord; close: () => void }) {
  const { t, formatDate } = useI18n();
  const fmt = useFormatter();
  const client = useQueryClient();
  const { can } = useAuth();
  const { toast } = useToast();
  const branding = useCompanyBranding();
  const { printData, setPrintData } = useDocumentPrint<ContractPrintData>();
  const [confirm, setConfirm] = useState<"status" | "delete" | null>(null);
  // The raw contract rows the list read (same cache entry), for print, attachment and links.
  const raw = useQuery({ queryKey: ["views", CONTRACTS_VIEW_KEY, "rows"], queryFn: fetchAll });
  const contract = (raw.data as unknown as Contract[] | undefined)?.find((c) => c.id === record.id) ?? null;
  const linked = useQuery({ queryKey: ["contracts", "linked", record.id], queryFn: () => fetchLinkedDocuments(contract!), enabled: !!contract });
  const canManage = can("can_create_invoice") || can("can_view_purchases");
  const reload = () => invalidateModel(client, CONTRACTS_VIEW_KEY);

  const actions: FormAction[] = contract
    ? [
        { key: "print", label: t("official.printContract"), icon: <Printer className="h-4 w-4" aria-hidden />, onClick: () => setPrintData({ contract, branding }) },
        ...(canManage
          ? [
              record.status === "cancelled"
                ? { key: "status", label: t("official.reactivateContract"), icon: <RotateCcw className="h-4 w-4" aria-hidden />, onClick: () => setConfirm("status") }
                : { key: "status", label: t("official.cancelContract"), icon: <Ban className="h-4 w-4" aria-hidden />, onClick: () => setConfirm("status") },
              { key: "delete", label: t("common.delete"), icon: <Trash2 className="h-4 w-4" aria-hidden />, onClick: () => setConfirm("delete") },
            ]
          : []),
      ]
    : [];

  const docs = linked.data ?? [];
  const total = docs.reduce((s, d) => s + d.totalAmount, 0);
  const paid = docs.reduce((s, d) => s + d.paidAmount, 0);
  const linkedTab = (
    <div className="flex flex-col gap-3">
      {docs.length === 0 ? (
        <p className="ds-muted">{linked.isLoading ? t("common.loading") : t("official.noLinkedInvoices")}</p>
      ) : (
        <>
          <div>
            <div className="mb-1 flex justify-between text-[length:var(--ds-text-xs)]">
              <span className="ds-muted">{t("official.paymentProgress")}</span>
              <span className="ds-mono">{total > 0 ? Math.round(Math.min(100, (paid / total) * 100)) : 0}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--ds-track)" }} aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${total > 0 ? Math.min(100, (paid / total) * 100) : 0}%`, background: "var(--ds-success)" }} />
            </div>
          </div>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" className="px-2 py-1.5 ds-label">{t("official.contractNumber")}</th>
                <th scope="col" className="px-2 py-1.5 ds-label">{t("common.date")}</th>
                <th scope="col" className="px-2 py-1.5 text-right ds-label">{t("official.totalInvoiced")}</th>
                <th scope="col" className="px-2 py-1.5 text-right ds-label">{t("official.remainingBalance")}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={`${d.kind}-${d.id}`} style={{ borderTop: "1px solid var(--ds-border)" }}>
                  <td className="px-2 py-1.5">
                    <Link href={d.kind === "sale" ? `/sales/${d.id}` : `/purchases?record=${d.id}`} className="ds-mono hover:underline">
                      {d.docNo}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">{d.docDate ? formatDate(d.docDate) : "—"}</td>
                  <td className="px-2 py-1.5 text-right ds-mono">{formatFigure(d.totalAmount, 2, fmt.locale)}</td>
                  <td className="px-2 py-1.5 text-right ds-mono">{formatFigure(d.remainingBalance, 2, fmt.locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );

  return (
    <>
      <FormView
        definition={DEFINITION}
        record={record}
        canWrite={false}
        fmt={fmt}
        actions={actions}
        extraTabs={[
          { key: "linked", label: t("official.linkedInvoices"), content: linkedTab },
          ...(contract && canManage
            ? [{
                key: "attachment",
                label: t("official.attachScan"),
                content: (
                  <ContractAttachmentButton
                    contract={contract}
                    onUploaded={() => {
                      toast(t("common.success"), undefined, "success");
                      void reload();
                    }}
                    onError={(message) => toast(t("common.error"), message, "error")}
                  />
                ),
              }]
            : []),
        ]}
      />
      <TypeToConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        confirmText={record.contract_number}
        labels={{
          title: confirm === "delete" ? t("common.delete") : record.status === "cancelled" ? t("official.reactivateContract") : t("official.cancelContract"),
          description: confirm === "delete" ? t("contracts.engine.deleteConfirm") : t("official.cancelConfirmMessage"),
          instruction: t("contracts.engine.typeNumber"),
          copy: t("sales.engine.void.copy"),
          cancel: t("common.cancel"),
          confirm: confirm === "delete" ? t("common.delete") : t("common.confirm"),
          working: t("common.loading"),
          audit: t("contracts.engine.audit"),
        }}
        onConfirm={async () => {
          if (confirm === "delete") {
            const result = await deleteContractAction(record.id);
            if (!result.success) {
              toast(t("common.error"), result.error, "error");
              return;
            }
            toast(t("official.deleteSuccess"), undefined, "success");
            await reload();
            close();
            return;
          }
          const result = await updateContract(record.id, { status: record.status === "cancelled" ? "active" : "cancelled" });
          if (!result.ok) {
            toast(t("common.error"), result.error, "error");
            return;
          }
          toast(t("common.success"), undefined, "success");
          await reload();
        }}
      />
      {printData ? createPortal(<div className="print-area"><ContractPrintTemplate data={printData} /></div>, document.body) : null}
    </>
  );
}
