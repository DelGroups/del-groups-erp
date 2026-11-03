"use client";

import React, { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Combobox, IconButton, type ComboOption, type ControlWidth } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { comboboxLabels } from "@/i18n/uiStandardLabels";
import type { PermissionKey } from "@/types/database.types";
import { isBarcodeLike } from "@/components/line-grid/logic";
import { fetchLookupById, fetchLookupByIds, searchLookup } from "./data";
import { orderWithRecent, parseRecent, pushRecent, recentStorageKey, restrictToIds } from "./logic";
import { LookupScope } from "./LookupScope";
import { QuickCreateDialog, type QuickCreateDefaults } from "./QuickCreateDialog";
import { canQuickCreate, lookupDef, lookupQueryKey, type LookupEntity, type LookupRecord, type LookupWhere } from "./registry";

export interface EntityLookupProps {
  entity: LookupEntity;
  /** The selected id; "" and null both mean nothing selected. */
  value: string | null | undefined;
  /** The picked (or just created) record comes with the id, so the form needs no reload. */
  onChange: (id: string | null, record: LookupRecord | null) => void;
  /** Label of the current value when the form already knows it (saves one read). */
  selectedLabel?: string;
  /** Filters every search carries, e.g. { entity_type: "legal" } or { is_service: false }. */
  where?: LookupWhere;
  /** Only these ids can be picked (warehouse / cash account scopes of the user's role). */
  allowedIds?: readonly string[] | null;
  /** false: selection only, no "+" (the user's permission is checked as well). */
  allowCreate?: boolean;
  /** Values the quick-create form starts with (e.g. a legal entity in official mode). */
  createDefaults?: QuickCreateDefaults;
  /** Runs after a quick-create, before onChange (e.g. refresh a list the form keeps). */
  onCreated?: (record: LookupRecord) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  id?: string;
  /** Control width; "full" (default) fills a stacked field, a token in rows and cells. */
  width?: ControlWidth;
  /** "sm": the compact height for table cells. */
  size?: "md" | "sm";
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  /** false: no "+" next to the field ("+ New …" stays under the list), for narrow table cells. */
  inlineAdd?: boolean;
  /** Opens the list and focuses the field on mount (a new line's product cell, UI-3). */
  autoOpen?: boolean;
  /**
   * A barcode scanned (or typed) into the search and confirmed with Enter is looked up exactly
   * and picked when one record has it (products, UI-3). Gets the code when none has it.
   */
  onBarcodeMiss?: (code: string) => void;
  scanBarcodes?: boolean;
}

function readRecent(entity: LookupEntity): string[] {
  try {
    return parseRecent(window.localStorage.getItem(recentStorageKey(entity)));
  } catch {
    return [];
  }
}

function writeRecent(entity: LookupEntity, id: string) {
  try {
    window.localStorage.setItem(recentStorageKey(entity), JSON.stringify(pushRecent(readRecent(entity), id)));
  } catch {
    // Private mode or blocked storage: recent items are a convenience only.
  }
}

/**
 * The one lookup field of the system (UI-2 lookups, docs/ui-standard.md "Lookups"): a Combobox
 * that searches the database as the user types (20 rows, recent picks first, code / phone /
 * stock on the second line), re-reads every time it opens, and lets the user create the record
 * in place: "+ New …" under the list and a "+" next to the field open a quick-create dialog;
 * the new record is saved, selected and announced, and the form around it keeps its state.
 */
export function EntityLookup({
  entity,
  value,
  onChange,
  selectedLabel,
  where,
  allowedIds,
  allowCreate = true,
  createDefaults,
  onCreated,
  placeholder,
  clearable = true,
  disabled,
  invalid,
  required,
  id,
  width = "full",
  size = "md",
  className,
  inlineAdd = true,
  autoOpen,
  scanBarcodes,
  onBarcodeMiss,
  ...aria
}: EntityLookupProps) {
  const { t } = useI18n();
  const { isAdmin, can } = useAuth();
  const def = lookupDef(entity);
  const current = value || null;
  const records = useRef(new Map<string, LookupRecord>());
  const [createOpen, setCreateOpen] = useState(false);
  const [createQuery, setCreateQuery] = useState("");
  // A label known from the last pick or create, until the form passes its own.
  const [pickedLabel, setPickedLabel] = useState<{ id: string; label: string } | null>(null);
  const mayCreate = !disabled && canQuickCreate(entity, { isAdmin, can: (p) => can(p as PermissionKey) }, allowCreate);

  const known = current && pickedLabel?.id === current ? pickedLabel.label : selectedLabel;
  const label = useQuery({
    queryKey: lookupQueryKey(entity, "label", current),
    queryFn: async () => {
      const row = await fetchLookupById(entity, current as string);
      if (row) records.current.set(row.id, row);
      return row ? def.label(row) : "";
    },
    enabled: Boolean(current) && !known,
    staleTime: 60_000,
  });

  const whereKey = JSON.stringify(where ?? null);
  // "*": no restriction; "": an empty allowed list (nothing can be picked).
  const allowedKey = allowedIds == null ? "*" : allowedIds.join(",");
  const loadOptions = useCallback(
    async (query: string, signal: AbortSignal): Promise<ComboOption[]> => {
      const parsedWhere = JSON.parse(whereKey) as LookupWhere | null;
      const allowed = allowedKey === "*" ? null : allowedKey ? allowedKey.split(",") : [];
      const recent = readRecent(entity);
      const [rows, recentRows] = await Promise.all([
        searchLookup(entity, query, { where: parsedWhere ?? undefined, signal }),
        // With nothing typed, recent picks come first even when they are not among the first 20.
        query.trim() ? Promise.resolve([] as LookupRecord[]) : fetchLookupByIds(entity, recent).catch(() => []),
      ]);
      const merged = new Map<string, LookupRecord>();
      for (const row of [...rows, ...recentRows]) merged.set(row.id, row);
      const ordered = restrictToIds(orderWithRecent([...merged.values()], recent), allowed);
      for (const row of ordered) records.current.set(row.id, row);
      return ordered.map((row) => ({ value: row.id, label: def.label(row) || "—", hint: def.hint(row) }));
    },
    [entity, whereKey, allowedKey, def]
  );

  const pick = (nextId: string | null) => {
    if (!nextId) {
      setPickedLabel(null);
      onChange(null, null);
      return;
    }
    const record = records.current.get(nextId) ?? null;
    if (record) setPickedLabel({ id: nextId, label: def.label(record) });
    writeRecent(entity, nextId);
    onChange(nextId, record);
  };

  const created = (record: LookupRecord) => {
    records.current.set(record.id, record);
    setPickedLabel({ id: record.id, label: def.label(record) });
    writeRecent(entity, record.id);
    onCreated?.(record);
    onChange(record.id, record);
  };

  const openCreate = (query: string) => {
    setCreateQuery(query);
    setCreateOpen(true);
  };

  const createText = t(`lookup.create.${entity}`);

  // A scanner types the code and Enter at once, before the debounced search has answered.
  const onQueryEnter =
    scanBarcodes && entity === "product"
      ? (query: string) => {
          if (!isBarcodeLike(query)) return false;
          const parsedWhere = JSON.parse(whereKey) as LookupWhere | null;
          void searchLookup(entity, query, { where: parsedWhere ?? undefined })
            .then((rows) => {
              const hits = rows.filter((row) => String(row.barcode ?? "") === query);
              if (hits.length === 1) {
                records.current.set(hits[0].id, hits[0]);
                pick(hits[0].id);
              } else onBarcodeMiss?.(query);
            })
            .catch(() => onBarcodeMiss?.(query));
          return true;
        }
      : undefined;

  return (
    <LookupScope className={className}>
      <LookupFieldView
        id={id}
        value={current}
        onChange={(next) => pick(next)}
        loadOptions={loadOptions}
        selectedLabel={known ?? label.data ?? undefined}
        placeholder={placeholder}
        clearable={clearable}
        disabled={disabled}
        invalid={invalid}
        required={required}
        width={width}
        size={size}
        createLabel={createText}
        onCreate={mayCreate ? openCreate : undefined}
        inlineAdd={inlineAdd}
        autoOpen={autoOpen}
        onQueryEnter={onQueryEnter}
        aria-label={aria["aria-label"]}
        aria-describedby={aria["aria-describedby"]}
      />
      {mayCreate ? (
        <QuickCreateDialog
          entity={entity}
          open={createOpen}
          onOpenChange={setCreateOpen}
          query={createQuery}
          defaults={createDefaults}
          onCreated={created}
        />
      ) : null}
    </LookupScope>
  );
}

export interface LookupFieldViewProps {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Async search (EntityLookup) or a fixed list (the UI lab). */
  loadOptions?: (query: string, signal: AbortSignal) => Promise<ComboOption[]>;
  options?: ComboOption[];
  selectedLabel?: string;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  id?: string;
  width?: ControlWidth;
  size?: "md" | "sm";
  /** "New customer", "New product", … */
  createLabel: string;
  /** Opens the quick-create with what was typed; without it there is no "+". */
  onCreate?: (query: string) => void;
  /** false: no "+" next to the field (table cells); "+ New …" stays under the list. */
  inlineAdd?: boolean;
  autoOpen?: boolean;
  onQueryEnter?: (query: string) => boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/**
 * The look of a lookup field with no data source of its own: the Combobox, "+ New …" under the
 * list and the "+" next to the field. EntityLookup feeds it from the database; the UI lab shows
 * it with fixed rows (no sign-in, no database). Must sit inside a design scope ([data-ds]).
 */
export function LookupFieldView({
  value,
  onChange,
  loadOptions,
  options,
  selectedLabel,
  placeholder,
  clearable = true,
  disabled,
  invalid,
  required,
  id,
  width = "full",
  size = "md",
  createLabel,
  onCreate,
  inlineAdd = true,
  autoOpen,
  onQueryEnter,
  ...aria
}: LookupFieldViewProps) {
  const { t, locale } = useI18n();
  const labels = comboboxLabels(t);
  return (
    <div className="ds-lookup" data-size={size}>
      <Combobox
        id={id}
        value={value}
        onChange={(next) => onChange(next)}
        loadOptions={loadOptions}
        options={options}
        selectedLabel={selectedLabel}
        labels={{ ...labels, placeholder: placeholder ?? labels.placeholder }}
        locale={locale}
        clearable={clearable}
        disabled={disabled}
        invalid={invalid}
        required={required}
        width={width}
        aria-label={aria["aria-label"]}
        aria-describedby={aria["aria-describedby"]}
        defaultOpen={autoOpen}
        autoFocus={autoOpen}
        onQueryEnter={onQueryEnter}
        footer={
          onCreate
            ? ({ query, close }) => (
                <button
                  type="button"
                  className="ds-lookup-create"
                  onClick={() => {
                    close();
                    onCreate(query);
                  }}
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 truncate">
                    {query.trim() ? t("lookup.createNamed", { name: query.trim() }) : createLabel}
                  </span>
                </button>
              )
            : undefined
        }
      />
      {onCreate && inlineAdd ? (
        <IconButton
          size={size === "sm" ? "sm" : "md"}
          variant="outline"
          label={createLabel}
          icon={<Plus className="h-4 w-4" />}
          onClick={() => onCreate("")}
          className="ds-lookup-add"
        />
      ) : null}
    </div>
  );
}
