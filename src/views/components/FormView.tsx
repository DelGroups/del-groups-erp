"use client";

import React, { useId, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, Loader2 } from "lucide-react";
import { recordLayoutId, transitions } from "@/design-system/motion";
import { changedValues, displayValue, fieldLabel, fieldMap, missingRequired, optionLabel, parseInput, type Formatter } from "../logic";
import type { FieldDef, ViewDefinition, ViewRecord } from "../types";
import { Cell } from "./ListView";

export interface FormAction {
  key: string;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface FormTab {
  key: string;
  label: string;
  content: React.ReactNode;
}

export interface FormViewProps<R extends ViewRecord> {
  definition: ViewDefinition<R>;
  record: R;
  canWrite: boolean;
  fmt: Formatter;
  /** Saves the changed fields; resolves with an error message key on failure. */
  onSave?: (changes: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  /** Status bar click (the definition's statusField). */
  onStatusChange?: (value: string) => void;
  actions?: readonly FormAction[];
  /** Screen-specific tabs after the definition's tabs (related lists). */
  extraTabs?: readonly FormTab[];
  /** Right-hand column: Chatter (prompt 19) or any record side panel. */
  chatter?: React.ReactNode;
}

/**
 * Form view: action buttons and the status bar on top, the record title, the main fields in
 * two columns, then tabs; a slot for Chatter on the right (below on narrow screens). Edits stay
 * in a draft until Save (or Ctrl/⌘+S); Discard restores the record. Required fields are checked.
 */
export function FormView<R extends ViewRecord>({ definition: def, record, canWrite, fmt, onSave, onStatusChange, actions = [], extraTabs = [], chatter }: FormViewProps<R>) {
  const { t } = fmt;
  const fields = useMemo(() => fieldMap(def), [def]);
  const editable = canWrite && !!onSave;
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // Bumped on save and discard: the inputs start again from the record.
  const [version, setVersion] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const current = useMemo(() => ({ ...record, ...draft }) as R, [record, draft]);
  const allFields = useMemo(() => [def.form.title, ...def.form.fields, ...(def.form.tabs ?? []).flatMap((tab) => tab.fields)].map((n) => fields.get(n)).filter((f): f is FieldDef => !!f), [def, fields]);
  const changes = useMemo(() => changedValues(allFields, record, draft), [allFields, record, draft]);
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    if (!onSave || !dirty || saving) return;
    const missing = missingRequired(allFields, current);
    setErrors(missing);
    if (missing.length) {
      setMessage({ text: t("views.form.required", { fields: missing.map((n) => fieldLabel(fields.get(n)!, fmt)).join(", ") }), error: true });
      return;
    }
    setSaving(true);
    const result = await onSave(changes);
    setSaving(false);
    if (result.ok) {
      setDraft({});
      setVersion((v) => v + 1);
      setMessage({ text: t("views.form.saved"), error: false });
    } else setMessage({ text: result.error ? t(result.error) : t("views.form.saveFailed"), error: true });
  };

  const set = (field: FieldDef, value: unknown) => {
    setDraft((d) => ({ ...d, [field.name]: value }));
    setMessage(null);
  };

  const titleField = fields.get(def.form.title)!;
  const statusField = def.form.statusField ? fields.get(def.form.statusField) : undefined;
  const tabs: FormTab[] = [
    ...(def.form.tabs ?? []).map((tab) => ({
      key: tab.key,
      label: t(tab.labelKey),
      content: <FieldGrid key={version} names={tab.fields} fields={fields} record={current} editable={editable} errors={errors} onChange={set} fmt={fmt} />,
    })),
    ...extraTabs,
  ];

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void save();
        }
      }}
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {editable && dirty ? (
              <>
                <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                  {t("common.save")}
                </button>
                <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => {
                    setDraft({});
                    setErrors([]);
                    setMessage(null);
                    setVersion((v) => v + 1);
                  }}>
                  {t("views.form.discard")}
                </button>
              </>
            ) : null}
            {actions.map((a) => (
              <button key={a.key} type="button" onClick={a.onClick} disabled={a.disabled || dirty} title={dirty ? t("views.form.saveFirst") : undefined} className={["ds-btn ds-btn-sm", a.primary ? "ds-btn-primary" : ""].join(" ")}>
                {a.icon}
                {a.label}
              </button>
            ))}
          </div>
          {statusField ? <StatusBar field={statusField} value={String(current[statusField.name] ?? "")} onChange={canWrite && onStatusChange && !dirty ? onStatusChange : undefined} fmt={fmt} /> : null}
        </div>

        <p role="status" aria-live="polite" className="min-h-[1.25rem] text-[length:var(--ds-text-xs)]" style={message?.error ? { color: "var(--ds-danger-strong)" } : { color: "var(--ds-text-muted)" }}>
          {message?.text ?? (dirty ? t("views.form.unsaved") : "")}
        </p>

        <motion.section layoutId={recordLayoutId(def.model.key, record.id)} transition={transitions.layout} className="ds-card ds-card-pad flex flex-col gap-5">
          <div>
            <span className="ds-label">{fieldLabel(titleField, fmt)}</span>
            {editable && !titleField.readonly ? (
              <input
                key={version}
                aria-label={fieldLabel(titleField, fmt)}
                className="mt-1 w-full bg-transparent text-[length:var(--ds-text-2xl)] font-semibold outline-none focus-visible:underline"
                value={String(current[titleField.name] ?? "")}
                aria-invalid={errors.includes(titleField.name) || undefined}
                onChange={(e) => set(titleField, parseInput(titleField, e.target.value))}
              />
            ) : (
              <h1 className="mt-1 text-[length:var(--ds-text-2xl)] font-semibold">{displayValue(titleField, current, fmt) || "—"}</h1>
            )}
          </div>
          <FieldGrid key={version} names={def.form.fields} fields={fields} record={current} editable={editable} errors={errors} onChange={set} fmt={fmt} />
          {tabs.length ? <Tabs tabs={tabs} label={t("views.form.tabs")} /> : null}
        </motion.section>
      </div>
      {chatter ? <aside className="min-w-0">{chatter}</aside> : null}
    </form>
  );
}

/**
 * Status bar: the stages as steps, the current one highlighted. With a change handler they are
 * buttons (radio group, arrow keys move); otherwise a read-only list.
 */
export function StatusBar({ field, value, onChange, fmt }: { field: FieldDef; value: string; onChange?: (value: string) => void; fmt: Formatter }) {
  const options = field.options ?? [];
  const label = fieldLabel(field, fmt);
  const step = (o: (typeof options)[number], i: number) => {
    const active = o.value === value;
    const text = optionLabel(field, o.value, fmt) ?? o.value;
    const style: React.CSSProperties = {
      background: active ? (o.color ?? "var(--ds-brand)") : "var(--ds-surface-sunken)",
      color: active ? "#fff" : "var(--ds-text-muted)",
      clipPath: i === 0 ? "polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%)" : "polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%, 8px 50%)",
      textShadow: active ? "0 1px 1px rgb(0 0 0 / 0.25)" : undefined,
    };
    const cls = "inline-flex h-8 items-center whitespace-nowrap pl-4 pr-5 text-[length:var(--ds-text-xs)] font-semibold";
    if (!onChange) {
      return (
        <li key={o.value} aria-current={active ? "step" : undefined} className={cls} style={style}>
          {text}
        </li>
      );
    }
    return (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={active}
        tabIndex={active || (!value && i === 0) ? 0 : -1}
        onClick={() => !active && onChange(o.value)}
        onKeyDown={(e) => {
          const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
          if (!dir) return;
          e.preventDefault();
          const buttons = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button[role=radio]") ?? [])];
          buttons[(i + dir + buttons.length) % buttons.length]?.focus();
        }}
        className={cls}
        style={style}
      >
        {text}
      </button>
    );
  };
  return onChange ? (
    <div role="radiogroup" aria-label={label} className="flex max-w-full overflow-x-auto">
      {options.map(step)}
    </div>
  ) : (
    <ol aria-label={label} className="flex max-w-full overflow-x-auto">
      {options.map(step)}
    </ol>
  );
}

function FieldGrid({ names, fields, record, editable, errors, onChange, fmt }: { names: readonly string[]; fields: Map<string, FieldDef>; record: ViewRecord; editable: boolean; errors: readonly string[]; onChange: (f: FieldDef, v: unknown) => void; fmt: Formatter }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 md:grid-cols-2">
      {names.map((name) => {
        const f = fields.get(name);
        if (!f) return null;
        return <FieldRow key={name} field={f} record={record} editable={editable && !f.readonly} invalid={errors.includes(name)} onChange={(v) => onChange(f, v)} fmt={fmt} />;
      })}
    </dl>
  );
}

function FieldRow({ field, record, editable, invalid, onChange, fmt }: { field: FieldDef; record: ViewRecord; editable: boolean; invalid: boolean; onChange: (v: unknown) => void; fmt: Formatter }) {
  const id = useId();
  const label = fieldLabel(field, fmt);
  const value = record[field.name];
  const wide = field.type === "text";
  const helpId = field.help ? `${id}-help` : undefined;
  // What the user typed ("12," while typing 12,5); the parsed value goes to the draft.
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value));
  const type = (raw: string) => {
    setText(raw);
    onChange(parseInput(field, raw));
  };
  const common = { id, "aria-invalid": invalid || undefined, "aria-describedby": helpId, "aria-required": field.required || undefined };
  let input: React.ReactNode;
  if (!editable) input = <Cell field={field} record={record} fmt={fmt} />;
  else if (field.type === "boolean") input = <input {...common} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  else if (field.type === "selection" || field.type === "many2one")
    input = (
      <select {...common} className="ds-input" value={value === null || value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {/* A value missing from the options (archived customer) stays selectable. */}
        {value && !field.options?.some((o) => o.value === value) ? <option value={String(value)}>{displayValue(field, record, fmt) || String(value)}</option> : null}
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label ?? (o.labelKey ? fmt.t(o.labelKey) : o.value)}
          </option>
        ))}
      </select>
    );
  else if (field.type === "text") input = <textarea {...common} className="ds-input min-h-24 py-2" value={text} onChange={(e) => type(e.target.value)} />;
  else
    input = (
      <input
        {...common}
        className="ds-input"
        type={field.type === "date" ? "date" : field.type === "url" ? "url" : "text"}
        inputMode={field.type === "integer" ? "numeric" : field.type === "float" || field.type === "monetary" ? "decimal" : undefined}
        value={text}
        onChange={(e) => type(e.target.value)}
      />
    );
  return (
    <div className={["flex flex-col gap-1", wide ? "md:col-span-2" : ""].join(" ")}>
      <dt>
        <label htmlFor={editable ? id : undefined} className="ds-label">
          {label}
          {editable && field.required ? <span aria-hidden> *</span> : null}
        </label>
      </dt>
      <dd className="min-h-[var(--ds-control-h)] content-center">
        {input}
        {field.help ? (
          <p id={helpId} className="mt-1 ds-muted text-[length:var(--ds-text-xs)]">
            {field.help}
          </p>
        ) : null}
      </dd>
    </div>
  );
}

/** Tabs (WAI-ARIA tabs pattern: arrow keys, Home/End). */
export function Tabs({ tabs, label }: { tabs: readonly FormTab[]; label: string }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const base = useId();
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];
  const go = (i: number) => {
    const tab = tabs[(i + tabs.length) % tabs.length];
    setActive(tab.key);
    refs.current.get(tab.key)?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-4 overflow-x-auto border-b" style={{ borderColor: "var(--ds-border)" }}>
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => {
              if (el) refs.current.set(tab.key, el);
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.key}`}
            aria-controls={`${base}-panel-${tab.key}`}
            aria-selected={tab.key === current?.key}
            aria-current={tab.key === current?.key ? "page" : undefined}
            tabIndex={tab.key === current?.key ? 0 : -1}
            onClick={() => setActive(tab.key)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") go(i + 1);
              else if (e.key === "ArrowLeft") go(i - 1);
              else if (e.key === "Home") go(0);
              else if (e.key === "End") go(tabs.length - 1);
              else return;
              e.preventDefault();
            }}
            className="ds-tab"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {current ? (
        <div role="tabpanel" id={`${base}-panel-${current.key}`} aria-labelledby={`${base}-tab-${current.key}`} tabIndex={0} className="pt-4 outline-none">
          {current.content}
        </div>
      ) : null}
    </div>
  );
}
