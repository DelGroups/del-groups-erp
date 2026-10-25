"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { checkDeal, lostReasonLabel, stagesForTeam, teamLabel, type CrmLostReason, type CrmStage, type CrmTeam, type DealType } from "../../lib/pipeline";
import type { PipelineDealInput } from "../../actions/pipeline";
import { CrmDialog, Field } from "./CrmDialog";

type Customer = { id: string; full_name: string; company_name: string | null };

/**
 * Quick create (prompt 21): the few fields needed to start a lead or an opportunity; the rest is
 * filled in its form. An opportunity starts in the chosen stage (default: the team's first).
 */
interface QuickCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: DealType;
  teams: readonly CrmTeam[];
  stages: readonly CrmStage[];
  customers: readonly Customer[];
  initialStageId?: string | null;
  busy?: boolean;
  onSubmit: (input: PipelineDealInput) => void | Promise<void>;
}

// The forms mount while their dialog is open, so every opening starts empty.
export function QuickCreateDialog(props: QuickCreateProps) {
  return props.open ? <QuickCreateForm {...props} /> : null;
}

function QuickCreateForm({ onOpenChange, type, teams, stages, customers, initialStageId, busy, onSubmit }: QuickCreateProps) {
  const { t } = useI18n();
  const initial = stages.find((s) => s.id === initialStageId);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [value, setValue] = useState("");
  const [teamId, setTeamId] = useState(initial?.team_id ?? teams[0]?.id ?? "");
  const [stageId, setStageId] = useState(initial?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const teamStages = stagesForTeam(stages, teamId || null).filter((s) => !s.is_won && !s.is_lost);

  const submit = () => {
    const invalid = checkDeal({ title, email, expectedValue: value });
    if (invalid) {
      setError(t(`crm.pipeline.errors.${invalid}`));
      return;
    }
    void onSubmit({
      title,
      type,
      clientId: clientId || null,
      contactName: contactName || null,
      email: email || null,
      phone: phone || null,
      expectedValue: value === "" ? 0 : Number(value),
      teamId: teamId || null,
      stageId: type === "opportunity" ? stageId || null : null,
    });
  };

  return (
    <CrmDialog
      open
      onOpenChange={onOpenChange}
      title={type === "lead" ? t("crm.pipeline.quick.newLead") : t("crm.pipeline.quick.newOpportunity")}
      description={t("crm.pipeline.quick.hint")}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={busy ? t("common.saving") : t("crm.pipeline.quick.create")}
      busy={busy}
      canSubmit={!!title.trim()}
      onSubmit={submit}
    >
      <Field label={t("crm.pipeline.fields.title")}>
        <input className="ds-input" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus maxLength={240} placeholder={t("crm.pipeline.quick.titleHint")} />
      </Field>
      <Field label={t("crm.pipeline.fields.customer")}>
        <select className="ds-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">{t("crm.pipeline.quick.noCustomer")}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company_name ? `${c.full_name} (${c.company_name})` : c.full_name}
            </option>
          ))}
        </select>
      </Field>
      {!clientId ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("crm.pipeline.fields.contactName")}>
            <input className="ds-input" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={200} />
          </Field>
          <Field label={t("crm.pipeline.fields.phone")}>
            <input className="ds-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={60} />
          </Field>
          <Field label={t("crm.pipeline.fields.email")}>
            <input className="ds-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
          </Field>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("crm.pipeline.fields.expectedValue")}>
          <input className="ds-input ds-mono" type="number" min="0" step="0.01" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
        </Field>
        {teams.length > 1 ? (
          <Field label={t("crm.pipeline.fields.team")}>
            <select className="ds-input" value={teamId} onChange={(e) => { setTeamId(e.target.value); setStageId(""); }}>
              {teams.filter((x) => x.active).map((tm) => (
                <option key={tm.id} value={tm.id}>{teamLabel(tm, t)}</option>
              ))}
            </select>
          </Field>
        ) : null}
        {type === "opportunity" ? (
          <Field label={t("crm.pipeline.fields.stage")}>
            <select className="ds-input" value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">{t("crm.pipeline.quick.firstStage")}</option>
              {teamStages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-[length:var(--ds-text-sm)]" style={{ color: "var(--ds-danger-strong)" }}>{error}</p> : null}
    </CrmDialog>
  );
}

/** Mark as lost: the reason (optional, from the tenant's list) and a note. */
interface LostProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  reasons: readonly CrmLostReason[];
  busy?: boolean;
  onSubmit: (reasonId: string | null, note: string) => void | Promise<void>;
}

export function LostDialog(props: LostProps) {
  return props.open ? <LostForm {...props} /> : null;
}

function LostForm({ onOpenChange, title, reasons, busy, onSubmit }: LostProps) {
  const { t } = useI18n();
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  return (
    <CrmDialog
      open
      onOpenChange={onOpenChange}
      title={t("crm.pipeline.lost.title")}
      description={t("crm.pipeline.lost.description", { title })}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={busy ? t("common.saving") : t("crm.pipeline.lost.confirm")}
      busy={busy}
      danger
      onSubmit={() => onSubmit(reasonId || null, note)}
    >
      <Field label={t("crm.pipeline.fields.lostReason")}>
        <select className="ds-input" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          <option value="">{t("crm.pipeline.noReason")}</option>
          {reasons.filter((r) => r.active).map((r) => (
            <option key={r.id} value={r.id}>{lostReasonLabel(r, t)}</option>
          ))}
        </select>
      </Field>
      <Field label={t("crm.pipeline.fields.lostNote")}>
        <textarea className="ds-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </Field>
    </CrmDialog>
  );
}

/** Lead → opportunity: keep it without a customer, link an existing one, or create one from the contact. */
interface ConvertProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: { title: string; client_id: string | null; contact_name: string | null; company_name: string | null };
  customers: readonly Customer[];
  canCreateCustomer: boolean;
  busy?: boolean;
  onSubmit: (choice: { createCustomer: boolean; clientId: string | null }) => void | Promise<void>;
}

export function ConvertDialog(props: ConvertProps) {
  return props.open ? <ConvertForm {...props} /> : null;
}

function ConvertForm({ onOpenChange, lead, customers, canCreateCustomer, busy, onSubmit }: ConvertProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"create" | "link" | "none">(
    lead.client_id ? "link" : canCreateCustomer && (lead.contact_name || lead.company_name) ? "create" : "none"
  );
  const [clientId, setClientId] = useState(lead.client_id ?? "");
  const name = lead.contact_name || lead.company_name || lead.title;
  return (
    <CrmDialog
      open
      onOpenChange={onOpenChange}
      title={t("crm.pipeline.convert.title")}
      description={t("crm.pipeline.convert.description")}
      closeLabel={t("common.close")}
      cancelLabel={t("common.cancel")}
      submitLabel={busy ? t("common.saving") : t("crm.pipeline.convert.confirm")}
      busy={busy}
      canSubmit={mode !== "link" || !!clientId}
      onSubmit={() => onSubmit({ createCustomer: mode === "create", clientId: mode === "link" ? clientId || null : null })}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="ds-label mb-1">{t("crm.pipeline.convert.customer")}</legend>
        {canCreateCustomer ? (
          <label className="flex items-center gap-2">
            <input type="radio" name="convert-mode" checked={mode === "create"} onChange={() => setMode("create")} />
            {t("crm.pipeline.convert.create", { name })}
          </label>
        ) : null}
        <label className="flex items-center gap-2">
          <input type="radio" name="convert-mode" checked={mode === "link"} onChange={() => setMode("link")} />
          {t("crm.pipeline.convert.link")}
        </label>
        {mode === "link" ? (
          <select className="ds-input" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label={t("crm.pipeline.fields.customer")}>
            <option value="">{t("common.select")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.company_name ? `${c.full_name} (${c.company_name})` : c.full_name}</option>
            ))}
          </select>
        ) : null}
        <label className="flex items-center gap-2">
          <input type="radio" name="convert-mode" checked={mode === "none"} onChange={() => setMode("none")} />
          {t("crm.pipeline.convert.none")}
        </label>
      </fieldset>
    </CrmDialog>
  );
}
