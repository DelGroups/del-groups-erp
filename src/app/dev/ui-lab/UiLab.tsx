"use client";

import { useState } from "react";
import { Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import StatusBadge from "@/components/ui/status-badge";
import { ClassicInvoiceTable, GridLab } from "./GridLab";
import { comboboxLabels, dateFieldLabels } from "@/i18n/uiStandardLabels";
import {
  Chip,
  Combobox,
  DateCell,
  DateField,
  DateTimeField,
  DesignScope,
  Field,
  FormGrid,
  IconButton,
  InlineGroup,
  MoneyCell,
  NumberCell,
  PageHeader,
  Section,
  Toolbar,
  Truncate,
  type ComboOption,
} from "@/design-system/components";
import type { DsDensity } from "@/design-system/theme";

/*
 * Test texts of the lab, on purpose fixed in Azerbaijani and Russian whatever the UI language:
 * they are the longest real labels and statuses of the app, the cases that used to wrap. They
 * are fixtures (like demo data), not UI texts; the lab's own texts come from src/i18n.
 */
const LONG = {
  sent: "Anbara göndərilib",
  pending: "Təsdiq gözləyir",
  compare: "Gəlir və xərclərin müqayisəsi",
  freight: "Beynəlxalq daşınma və sığorta xərcləri",
  ruPending: "Ожидает подтверждения руководителем",
  ruSent: "Отправлено на склад",
  ruFreight: "Международная перевозка и страхование груза",
  supplier: "Guangzhou Huaxin Aluminium Composite Panel Manufacturing Co., Ltd.",
  product: "Alüminium kompozit panel 4 mm, gümüşü metallik, 1220×2440",
};

const PARTNERS: ComboOption[] = [
  { value: "1", label: LONG.supplier, hint: "VÖEN 1402345678" },
  { value: "2", label: "Bakı Logistika və Gömrük Xidmətləri MMC", hint: "VÖEN 1700112233" },
  { value: "3", label: "ООО «Транссервис Каспий»", hint: "ИНН 7701234567" },
  { value: "4", label: "Azərsığorta ASC" },
];

export const LAB_WIDTHS = [280, 360, 768, 1280] as const;
const DENSITIES: DsDensity[] = ["comfortable", "compact"];
const THEMES = ["light", "dark"] as const;

export default function UiLab({ fontClassName, standard }: { fontClassName: string; standard: boolean }) {
  const { t } = useI18n();
  return (
    <DesignScope theme="light" className={`${fontClassName} min-h-screen p-4`}>
      <PageHeader title={t("uiStandard.lab.title")} description={t("uiStandard.lab.description")} />
      <p role="status" className="mb-4 ds-chip ds-chip-flat" data-ui-lab-flag={standard ? "on" : "off"}>
        {standard ? t("uiStandard.lab.flagOn") : t("uiStandard.lab.flagOff")}
      </p>
      <div className="flex flex-col gap-6">
        {THEMES.map((theme) =>
          DENSITIES.map((density) => (
            <section key={`${theme}-${density}`} aria-label={`${t(`uiStandard.lab.${theme}`)} · ${t(`uiStandard.lab.${density}`)}`} className="flex flex-col gap-3">
              <h2 className="text-[length:var(--ds-text-lg)] font-semibold">
                {t(`uiStandard.lab.${theme}`)} · {t(`uiStandard.lab.${density}`)}
              </h2>
              <div className="flex flex-wrap items-start gap-4">
                {LAB_WIDTHS.map((width) => (
                  <div key={width} className="flex flex-col gap-1" style={{ width }}>
                    <p className="ds-muted text-[length:var(--ds-text-xs)]">{t("uiStandard.lab.width", { width })}</p>
                    <DesignScope theme={theme} density={density} className={fontClassName}>
                      <div data-ui-frame={`${theme}-${density}-${width}`} style={{ width }} className="flex flex-col gap-3 p-2" >
                        <LabContent />
                      </div>
                    </DesignScope>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </DesignScope>
  );
}

function LabContent() {
  const { t, locale } = useI18n();
  const [date, setDate] = useState<string | null>("2026-10-17");
  const [stamp, setStamp] = useState<string | null>("2026-10-17T13:00");
  const [partner, setPartner] = useState<string | null>("1");
  const [cost, setCost] = useState<string | null>("2");
  const l = (key: string) => t(`uiStandard.lab.${key}`);
  const dateLabels = dateFieldLabels(t);
  const comboLabels = comboboxLabels(t);
  const actions = (
    <>
      <IconButton label={l("edit")} icon={<Pencil className="h-4 w-4" />} />
      <IconButton label={l("remove")} icon={<Trash2 className="h-4 w-4" />} variant="danger" />
    </>
  );
  return (
    <>
      <PageHeader title={LONG.compare} description={LONG.ruFreight} actions={actions} />

      <Toolbar
        label={l("toolbar")}
        start={
          <>
            <Combobox value={partner} onChange={(v) => setPartner(v)} options={PARTNERS} labels={comboLabels} locale={locale} aria-label={l("partner")} width="md" />
            <Chip tone="info">{LONG.sent}</Chip>
          </>
        }
        end={
          <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" data-ui-check="single-line">
            <Plus className="h-4 w-4" aria-hidden />
            {l("add")}
          </button>
        }
        settings={<IconButton label={l("settings")} icon={<Settings2 className="h-4 w-4" />} />}
      />

      <Section title={LONG.freight} description={LONG.ruPending} actions={actions}>
        <FormGrid columns={3}>
          <Field label={LONG.freight} required hint={LONG.ruFreight}>
            {({ id, describedBy }) => <Combobox id={id} aria-describedby={describedBy} value={cost} onChange={(v) => setCost(v)} options={PARTNERS} labels={comboLabels} locale={locale} />}
          </Field>
          <Field label={l("date")} required>
            {({ id }) => <DateField id={id} value={date} onChange={setDate} locale={locale} labels={dateLabels} />}
          </Field>
          <Field label={LONG.ruPending}>
            {({ id }) => <DateTimeField id={id} value={stamp} onChange={setStamp} locale={locale} labels={dateLabels} />}
          </Field>
          <Field label={l("amount")} error={LONG.ruPending}>
            {({ id, describedBy, invalid }) => <input id={id} className="ds-input ds-mono" aria-describedby={describedBy} aria-invalid={invalid} defaultValue="12 500,00" />}
          </Field>
          <Field label={LONG.compare} span={2}>
            {({ id }) => <input id={id} className="ds-input" defaultValue={LONG.product} />}
          </Field>
        </FormGrid>
      </Section>

      <Section title={l("inline")} variant="card">
        <InlineGroup label={l("inline")}>
          <Chip>{LONG.freight}</Chip>
          <input className="ds-input ds-grow" aria-label={l("search")} placeholder={l("search")} />
          <Combobox value={partner} onChange={(v) => setPartner(v)} options={PARTNERS} labels={comboLabels} locale={locale} aria-label={l("partner")} width="md" />
          <DateField value={date} onChange={setDate} locale={locale} labels={dateLabels} aria-label={l("date")} />
          <input className="ds-input ds-mono ds-w-xs" aria-label={l("quantity")} defaultValue="250" />
          <IconButton label={l("remove")} icon={<Trash2 className="h-4 w-4" />} size="sm" />
        </InlineGroup>
      </Section>

      {/* Markup that exists on screens today: what UI_STANDARD fixes without touching the screen. */}
      <Section title={l("legacy")} variant="card">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <span className="ds-chip ds-chip-flat" title={LONG.freight} data-ui-check="single-line">{LONG.freight}</span>
            <input className="ds-input min-w-[10rem] flex-1" aria-label={l("search")} defaultValue={LONG.product} />
            <input className="ds-input" aria-label={l("partner")} defaultValue={LONG.supplier} />
            <input className="ds-input ds-mono w-24" aria-label={l("quantity")} defaultValue="250" />
          </div>
          <table className="text-[length:var(--ds-text-sm)]">
            <tbody>
              <tr>
                <td className="w-[7rem] max-w-[7rem] px-2 py-1">
                  <span data-ui-check="single-line" className="inline-block max-w-full">
                    <StatusBadge tone="posted">{LONG.sent}</StatusBadge>
                  </span>
                </td>
                <td className="w-[7rem] max-w-[7rem] px-2 py-1">
                  <span className="ds-chip" title={LONG.ruSent} data-ui-check="single-line">
                    <span className="ds-chip-text">{LONG.ruSent}</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={l("chips")} variant="card">
        <div className="flex flex-wrap gap-2">
          <Chip tone="success">{LONG.sent}</Chip>
          <Chip tone="warning">{LONG.pending}</Chip>
          <Chip tone="brand">{LONG.compare}</Chip>
          <Chip tone="danger">{LONG.ruPending}</Chip>
          <Chip>{LONG.ruSent}</Chip>
          <Chip tone="info">{LONG.supplier}</Chip>
        </div>
      </Section>

      {/* UI-2: the list standard. 20 columns, long az texts; ui:guard checks one-line rows. */}
      <Section title={l("grid")} variant="card">
        <GridLab />
      </Section>
      <Section title={l("classic")} variant="card">
        <ClassicInvoiceTable />
      </Section>

      <Section title={l("cells")} variant="card">
        <div className="overflow-x-auto">
          <table className="w-full text-[length:var(--ds-text-sm)]">
            <thead>
              <tr>
                <th className="px-2 py-1 text-start">{l("partner")}</th>
                <th className="px-2 py-1 text-start">{l("date")}</th>
                <th className="px-2 py-1 text-end">{l("quantity")}</th>
                <th className="px-2 py-1 text-end">{l("amount")}</th>
                <th className="px-2 py-1 text-start">{l("chips")}</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1].map((i) => (
                <tr key={i}>
                  <td className="max-w-[12rem] px-2 py-1">
                    <Truncate>{i ? LONG.supplier : LONG.ruFreight}</Truncate>
                  </td>
                  <td className="px-2 py-1">
                    <DateCell value={i ? "2026-10-17T13:00:00Z" : "2026-10-17"} time={!!i} locale={locale} timeZone="Asia/Baku" />
                  </td>
                  <td className="px-2 py-1">
                    <NumberCell value={i ? 1250.5 : 12} locale={locale} unit="m²" />
                  </td>
                  <td className="px-2 py-1">
                    <MoneyCell value={i ? 1234567.891 : -45.5} locale={locale} />
                  </td>
                  <td className="px-2 py-1">
                    <Chip tone={i ? "warning" : "success"}>{i ? LONG.pending : LONG.sent}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
