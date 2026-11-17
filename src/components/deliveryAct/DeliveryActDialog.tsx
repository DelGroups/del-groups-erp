"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, Printer } from "lucide-react";
import { Button, DateField, DesignScope, Dialog, Field } from "@/design-system/components";
import { useTheme } from "@/theme/ThemeProvider";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { dateFieldLabels } from "@/i18n/uiStandardLabels";
import { dialogLabels } from "@/i18n/uiUnifiedLabels";
import { loadDeliveryActAction } from "@/lib/actions/deliveryAct";
import { actFileName, buildDeliveryAct } from "@/lib/deliveryAct/act";
import { actToHtml } from "@/components/print/deliveryActHtml";
import { buildDocx } from "@/lib/deliveryAct/docx";

/**
 * The delivery act (Təhvil-təslim aktı) of one sales invoice: the act date (the invoice date unless
 * changed), what is missing (contract, directors), a preview of the page, and the outputs: print (and
 * "Save as PDF" in the print window) and a Word file. Nothing is saved; the act is built from the invoice
 * every time.
 */
export function DeliveryActDialog({ saleId, open, onOpenChange }: { saleId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, locale } = useI18n();
  const frame = useRef<HTMLIFrameElement>(null);
  const [actDate, setActDate] = useState<string | null>(null);
  const [wordBusy, setWordBusy] = useState(false);
  const [wordError, setWordError] = useState(false);

  const q = useQuery({
    queryKey: ["delivery-act", saleId],
    enabled: open && !!saleId,
    staleTime: 0,
    queryFn: async () => {
      const r = await loadDeliveryActAction(saleId as string);
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
  });

  // Each time the dialog opens on an invoice, the act date starts as the invoice date.
  const invoiceDate = q.data?.sale.doc_date ?? null;
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setActDate(invoiceDate), 0);
    return () => window.clearTimeout(timer);
  }, [open, saleId, invoiceDate]);

  const act = useMemo(() => (q.data ? buildDeliveryAct({ ...q.data, actDate: actDate ?? q.data.sale.doc_date ?? "" }) : null), [q.data, actDate]);
  const html = useMemo(() => (act ? actToHtml(act) : ""), [act]);

  const print = () => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  };

  const word = async () => {
    if (!act) return;
    setWordBusy(true);
    setWordError(false);
    try {
      const blob = await buildDocx(act);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${actFileName(act)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setWordError(true);
    } finally {
      setWordBusy(false);
    }
  };

  const errorKey = q.error instanceof Error && q.error.message.startsWith("deliveryAct.") ? q.error.message : "deliveryAct.errors.loadFailed";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("deliveryAct.title")}
      description={act ? t(act.template === "official" ? "deliveryAct.templateOfficial" : "deliveryAct.templateInformal", { number: act.number }) : undefined}
      labels={dialogLabels(t)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("deliveryAct.close")}
          </Button>
          <Button variant="secondary" icon={FileText} onClick={() => void word()} loading={wordBusy} disabled={!act || wordBusy}>
            {t("deliveryAct.word")}
          </Button>
          <Button variant="primary" icon={Printer} onClick={print} disabled={!act}>
            {t("deliveryAct.print")}
          </Button>
        </>
      }
    >
      {q.isPending ? (
        <p className="ds-muted" role="status">
          {t("common.loading")}
        </p>
      ) : q.isError || !act ? (
        <p role="alert" className="flex items-start gap-2" style={{ color: "var(--ds-danger-strong)" }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t(errorKey)}
        </p>
      ) : (
        <div className="ds-delivery-act">
          <Field label={t("deliveryAct.actDate")} hint={t("deliveryAct.actDateHint")}>
            {({ id, describedBy }) => <DateField id={id} aria-describedby={describedBy} value={actDate} onChange={setActDate} locale={locale} labels={dateFieldLabels(t)} />}
          </Field>
          {act.warnings.length ? (
            <ul className="ds-delivery-act-warnings" aria-label={t("deliveryAct.warningsLabel")}>
              {act.warnings.map((w) => (
                <li key={w}>
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{t(`deliveryAct.warnings.${w}`)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {wordError ? (
            <p role="alert" className="m-0" style={{ color: "var(--ds-danger-strong)" }}>
              {t("deliveryAct.errors.wordFailed")}
            </p>
          ) : null}
          <iframe ref={frame} title={t("deliveryAct.preview")} className="ds-delivery-act-preview" srcDoc={html} />
        </div>
      )}
    </Dialog>
  );
}

/** The dialog in its own design scope, for the classic screens (the new UI is already inside one). */
export function ScopedDeliveryActDialog(props: { saleId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { theme } = useTheme();
  const { brand } = useNewUi();
  return (
    <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className="ds-scope-transparent">
      <DeliveryActDialog {...props} />
    </DesignScope>
  );
}
