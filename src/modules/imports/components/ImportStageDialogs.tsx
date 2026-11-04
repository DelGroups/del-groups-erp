"use client";

import { useState } from "react";
import { Combobox, DateField, Field, FormGrid } from "@/design-system/components";
import { EntityLookup } from "@/components/lookups";
import { useI18n } from "@/i18n/I18nProvider";
import { comboboxLabels, dateFieldLabels } from "@/i18n/uiStandardLabels";
import { todayLocalDate } from "@/lib/forms/paymentDate";
import type { ShipmentEventView } from "../actions/posting";
import { TRANSPORT_MODES } from "../lib/stages";
import type { ImportLookups, ShipmentTracking } from "../actions/imports";
import type { CostLineDraft, ShipmentDraft } from "../lib/shipment";
import { ImportDialog } from "./ImportDialog";

/** Transport and tracking of a shipment (IMP-5): at any stage before closing; ETA changes are logged. */
export function TrackingDialog({
  draft,
  tracking,
  lookups,
  busy,
  onClose,
  onSubmit,
}: {
  draft: ShipmentDraft;
  tracking: ShipmentTracking;
  lookups: ImportLookups;
  busy: boolean;
  onClose: () => void;
  onSubmit: (fields: Record<string, unknown>) => Promise<boolean>;
}) {
  const { t, locale } = useI18n();
  const [f, setF] = useState({
    transport_mode: tracking.transportMode,
    carrier_id: tracking.carrierId,
    tracking_no: tracking.trackingNo ?? "",
    vehicle_no: tracking.vehicleNo ?? "",
    etd: tracking.etd,
    eta: tracking.eta,
    departed_on: tracking.departedOn,
    arrived_on: tracking.arrivedOn,
    customs_declaration_no: draft.customsDeclarationNo ?? "",
    customs_declaration_date: draft.customsDeclarationDate,
    note: "",
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const posted = draft.status !== "draft";
  const etaChanged = tracking.eta !== null && f.eta !== tracking.eta;
  const date = (key: "etd" | "eta" | "departed_on" | "arrived_on" | "customs_declaration_date", label: string) => (
    <Field label={label}>
      {({ id }) => <DateField id={id} value={f[key] ?? null} onChange={(v) => set({ [key]: v } as Partial<typeof f>)} locale={locale} labels={dateFieldLabels(t)} width="full" aria-label={label} />}
    </Field>
  );
  return (
    <ImportDialog
      open
      wide
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("imports.tracking.title")}
      description={t("imports.tracking.hint")}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={t("common.save")}
      busy={busy}
      onSubmit={async () => {
        const out: Record<string, unknown> = { ...f };
        if (!posted) {
          delete out.customs_declaration_no;
          delete out.customs_declaration_date;
        }
        if (!etaChanged) delete out.note;
        if (await onSubmit(out)) onClose();
      }}
    >
      <FormGrid columns={4}>
        <Field label={t("imports.tracking.mode")}>
          {({ id }) => (
            <Combobox
              id={id}
              value={f.transport_mode}
              onChange={(v) => set({ transport_mode: v })}
              options={TRANSPORT_MODES.map((m) => ({ value: m, label: t(`imports.tracking.modes.${m}`) }))}
              labels={comboboxLabels(t)}
              locale={locale}
              width="full"
              aria-label={t("imports.tracking.mode")}
            />
          )}
        </Field>
        <Field label={t("imports.tracking.carrier")} span={2}>
          {({ id }) => (
            <EntityLookup
              id={id}
              entity="supplier"
              width="full"
              value={f.carrier_id}
              selectedLabel={lookups.suppliers.find((s) => s.id === f.carrier_id)?.name}
              onChange={(v) => set({ carrier_id: v })}
              aria-label={t("imports.tracking.carrier")}
            />
          )}
        </Field>
        <Field label={t("imports.tracking.trackingNo")}>
          {({ id }) => <input id={id} className="ds-input" value={f.tracking_no} maxLength={100} placeholder={t("imports.tracking.trackingNoHint")} onChange={(e) => set({ tracking_no: e.target.value })} />}
        </Field>
        <Field label={t("imports.tracking.vehicleNo")}>
          {({ id }) => <input id={id} className="ds-input" value={f.vehicle_no} maxLength={100} onChange={(e) => set({ vehicle_no: e.target.value })} />}
        </Field>
        {date("etd", t("imports.tracking.etd"))}
        {date("eta", t("imports.tracking.eta"))}
        {date("departed_on", t("imports.tracking.departedOn"))}
        {date("arrived_on", t("imports.tracking.arrivedOn"))}
        {posted ? (
          <>
            <Field label={t("imports.fields.customsDeclarationNo")}>
              {({ id }) => <input id={id} className="ds-input" value={f.customs_declaration_no} maxLength={100} onChange={(e) => set({ customs_declaration_no: e.target.value })} />}
            </Field>
            {date("customs_declaration_date", t("imports.fields.customsDeclarationDate"))}
          </>
        ) : null}
        {etaChanged ? (
          <Field label={t("imports.tracking.etaReason")} span={4}>
            {({ id }) => <input id={id} className="ds-input" value={f.note} maxLength={500} onChange={(e) => set({ note: e.target.value })} />}
          </Field>
        ) : null}
      </FormGrid>
    </ImportDialog>
  );
}

/**
 * "Gömrükdən buraxıldı" (IMP-5): needs the declaration number and date (filled here if missing)
 * and the customs rate; customs costs still marked as estimates are listed to finalize.
 */
export function ClearDialog({
  draft,
  busy,
  estimates,
  costLabel,
  onClose,
  onSettle,
  onSubmit,
}: {
  draft: ShipmentDraft;
  busy: boolean;
  estimates: readonly CostLineDraft[];
  costLabel: (c: CostLineDraft) => string;
  onClose: () => void;
  onSettle: (c: CostLineDraft) => void;
  onSubmit: (input: { declarationNo: string; declarationDate: string; date: string; changed: boolean }) => Promise<boolean>;
}) {
  const { t, locale } = useI18n();
  const [no, setNo] = useState(draft.customsDeclarationNo ?? "");
  const [declDate, setDeclDate] = useState<string | null>(draft.customsDeclarationDate);
  const [day, setDay] = useState<string | null>(draft.customsDeclarationDate ?? todayLocalDate());
  const ready = no.trim().length > 0 && !!declDate && !!day;
  return (
    <ImportDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("imports.stages.clearTitle")}
      description={t("imports.stages.clearHint")}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={t("imports.stages.next.clear")}
      busy={busy}
      canSubmit={ready}
      onSubmit={async () => {
        if (!ready) return;
        const changed = no.trim() !== (draft.customsDeclarationNo ?? "") || declDate !== draft.customsDeclarationDate;
        if (await onSubmit({ declarationNo: no.trim(), declarationDate: declDate as string, date: day as string, changed })) onClose();
      }}
    >
      <FormGrid columns={2}>
        <Field label={t("imports.fields.customsDeclarationNo")} required>
          {({ id }) => <input id={id} className="ds-input" value={no} maxLength={100} onChange={(e) => setNo(e.target.value)} />}
        </Field>
        <Field label={t("imports.fields.customsDeclarationDate")} required>
          {({ id }) => <DateField id={id} value={declDate} onChange={setDeclDate} locale={locale} labels={dateFieldLabels(t)} width="full" aria-label={t("imports.fields.customsDeclarationDate")} />}
        </Field>
        <Field label={t("imports.stages.clearDate")} required>
          {({ id }) => <DateField id={id} value={day} onChange={setDay} locale={locale} labels={dateFieldLabels(t)} width="full" aria-label={t("imports.stages.clearDate")} />}
        </Field>
        <Field label={t("imports.rates.customs")}>
          <span className="ds-mono flex h-[var(--ds-control-h,2.25rem)] items-center tabular-nums">
            {draft.currencyCode === "AZN" ? "1" : String(draft.customsRate ?? draft.invoiceRate)}
            {draft.customsRate === null && draft.currencyCode !== "AZN" ? <span className="ms-2 ds-muted text-[length:var(--ds-text-xs)]">{t("imports.rates.fromInvoice")}</span> : null}
          </span>
        </Field>
      </FormGrid>
      {estimates.length ? (
        <div className="flex flex-col gap-1 text-[length:var(--ds-text-sm)]" role="status">
          <span className="ds-label">{t("imports.stages.estimatesOpen")}</span>
          {estimates.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center justify-between gap-2">
              <span>{costLabel(c)}</span>
              <button type="button" className="ds-btn ds-btn-sm" onClick={() => onSettle(c)}>
                {t("importPosting.setActual")}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </ImportDialog>
  );
}

/** A manual milestone (departed, arrived at customs) or a note on the timeline (IMP-5). */
export function MilestoneDialog({
  kind: initialKind,
  busy,
  onClose,
  onSubmit,
}: {
  kind: "departed" | "arrived_customs" | "note";
  busy: boolean;
  onClose: () => void;
  onSubmit: (kind: "departed" | "arrived_customs" | "note", date: string, note: string | null) => Promise<boolean>;
}) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState(initialKind);
  const [day, setDay] = useState<string | null>(todayLocalDate());
  const [note, setNote] = useState("");
  const ready = !!day && (kind !== "note" || note.trim().length > 0);
  return (
    <ImportDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={t("imports.stages.milestoneTitle")}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={t("common.save")}
      busy={busy}
      canSubmit={ready}
      onSubmit={async () => {
        if (ready && (await onSubmit(kind, day as string, note.trim() || null))) onClose();
      }}
    >
      <FormGrid columns={2}>
        <Field label={t("imports.stages.milestoneKind")}>
          {({ id }) => (
            <Combobox
              id={id}
              value={kind}
              onChange={(v) => v && setKind(v as typeof kind)}
              options={(["departed", "arrived_customs", "note"] as const).map((k) => ({ value: k, label: t(`imports.timeline.kinds.${k}`) }))}
              labels={comboboxLabels(t)}
              locale={locale}
              clearable={false}
              width="full"
              aria-label={t("imports.stages.milestoneKind")}
            />
          )}
        </Field>
        <Field label={t("common.date")} required>
          {({ id }) => <DateField id={id} value={day} onChange={setDay} locale={locale} labels={dateFieldLabels(t)} width="full" aria-label={t("common.date")} />}
        </Field>
        <Field label={t("imports.stages.milestoneNote")} span={2} required={kind === "note"}>
          {({ id }) => <textarea id={id} className="ds-input min-h-[4rem]" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </FormGrid>
    </ImportDialog>
  );
}

export type { ShipmentEventView };
