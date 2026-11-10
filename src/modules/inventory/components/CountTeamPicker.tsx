"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Plus, UserRound, X } from "lucide-react";
import { Combobox } from "@/design-system/components";
import { LookupScope, QuickCreateDialog, canQuickCreate, type LookupRecord } from "@/components/lookups";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import type { PermissionKey } from "@/types/database.types";
import { fetchInventoryCountEmployeeOptionsAction } from "../actions/inventoryCount";
import {
  employeeOptionHint,
  MAX_COUNT_TEAM,
  teamNames,
  withChosenOptions,
  type CountEmployeeOption,
  type CountResponsible,
} from "../lib/countTeam";

/**
 * Loads the employee choices the first time `enabled` is true, then keeps them for the page
 * (names only, see inventory_count_employee_options). A failed load is not repeated: the picker
 * says so and asks for a page refresh.
 */
export function useCountEmployeeOptions(enabled: boolean) {
  const [options, setOptions] = useState<CountEmployeeOption[]>([]);
  const [state, setState] = useState<{ loading: boolean; error: string | null; loaded: boolean }>({ loading: false, error: null, loaded: false });
  const needLoad = enabled && !state.loaded && !state.loading && !state.error;
  useEffect(() => {
    if (!needLoad) return;
    let alive = true;
    // Starting a load is the external sync here (the list comes from the server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ loading: true, error: null, loaded: false });
    void fetchInventoryCountEmployeeOptionsAction().then((result) => {
      if (!alive) return;
      if (result.success) {
        setOptions((prev) => mergeById(result.data ?? [], prev));
        setState({ loading: false, error: null, loaded: true });
      } else setState({ loading: false, error: result.error, loaded: false });
    });
    return () => {
      alive = false;
    };
  }, [needLoad]);
  const loading = enabled && (state.loading || needLoad);
  const error = state.error;
  const add = (option: CountEmployeeOption) => setOptions((prev) => mergeById(prev, [option]));
  return { options, loading, error, add };
}

/** The loaded list plus people created meanwhile (quick-create), each once. */
function mergeById(base: readonly CountEmployeeOption[], extra: readonly CountEmployeeOption[]): CountEmployeeOption[] {
  const ids = new Set(base.map((o) => o.id));
  return [...base, ...extra.filter((o) => !ids.has(o.id))];
}

export interface CountTeamPickerProps {
  id?: string;
  /** Chosen employee ids, in the order chosen. */
  value: string[];
  onChange: (ids: string[]) => void;
  options: CountEmployeeOption[];
  /** People already on the count (kept in the list even if they left HR). */
  chosen?: readonly CountResponsible[];
  /** Older count: its free text, shown read-only until people are chosen. */
  legacyText?: string | null;
  onEmployeeCreated?: (option: CountEmployeeOption) => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  "aria-describedby"?: string;
}

/**
 * INV-4 (COUNT_TEAM): the count's responsible people. A searchable multi-select of active
 * employees (design-system Combobox), chosen people as removable chips, and "+ New employee"
 * in the list for users who may manage HR (QuickCreateDialog; the form stays open).
 */
export function CountTeamPicker({
  id,
  value,
  onChange,
  options,
  chosen = [],
  legacyText,
  onEmployeeCreated,
  loading,
  error,
  disabled,
  "aria-describedby": describedBy,
}: CountTeamPickerProps) {
  const { t, locale } = useI18n();
  const { isAdmin, can } = useAuth();
  const mayCreate = canQuickCreate("employee", { isAdmin, can: (p) => can(p as PermissionKey) });
  const [createOpen, setCreateOpen] = useState(false);
  const [createQuery, setCreateQuery] = useState("");
  const ownId = useId();
  const fieldId = id ?? `${ownId}-field`;
  const legacyId = `${ownId}-legacy`;
  const errorId = `${ownId}-error`;
  const chipsRef = useRef<HTMLUListElement>(null);
  const showLegacy = !!legacyText && value.length === 0;
  const describedByAll = [describedBy, showLegacy ? legacyId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  // Removing a chip removes its button: keep the keyboard focus on the next chip, else the field.
  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    requestAnimationFrame(() => {
      const buttons = chipsRef.current?.querySelectorAll<HTMLButtonElement>("button");
      const next = buttons?.[Math.min(index, (buttons?.length ?? 1) - 1)];
      (next ?? document.getElementById(fieldId))?.focus();
    });
  };

  const all = useMemo(() => withChosenOptions(options, chosen, locale), [options, chosen, locale]);
  const comboOptions = useMemo(() => all.map((o) => ({ value: o.id, label: o.full_name, hint: employeeOptionHint(o) })), [all]);
  const names = teamNames(value, all);
  const full = value.length >= MAX_COUNT_TEAM;

  const created = (record: LookupRecord) => {
    const name = typeof record.full_name === "string" ? record.full_name.trim() : "";
    if (!name) return;
    const option: CountEmployeeOption = {
      id: record.id,
      full_name: name,
      employee_code: typeof record.employee_code === "string" ? record.employee_code : null,
      position: typeof record.position === "string" ? record.position : null,
      department: typeof record.department === "string" ? record.department : null,
    };
    onEmployeeCreated?.(option);
    if (!value.includes(option.id) && !full) onChange([...value, option.id]);
  };

  return (
    <LookupScope className="flex min-w-0 flex-col gap-2">
      {showLegacy ? (
        <p id={legacyId} className="min-w-0 break-words rounded-[var(--ds-radius-md)] px-3 py-2 text-[length:var(--ds-text-xs)]" style={{ background: "var(--ds-surface-sunken)" }}>
          <span className="ds-muted">{t("inventoryCount.team.previousText")}: </span>
          <span>{legacyText}</span>
        </p>
      ) : null}
      <Combobox
        id={fieldId}
        width="full"
        disabled={disabled || loading}
        multiple={{
          values: value,
          onChange: (ids) => onChange(ids.slice(0, MAX_COUNT_TEAM)),
          triggerLabel: loading ? t("common.loading") : t("inventoryCount.team.choose"),
        }}
        options={comboOptions}
        labels={{
          placeholder: t("inventoryCount.team.choose"),
          search: t("inventoryCount.team.search"),
          empty: error ? t("inventoryCount.team.loadError") : t("inventoryCount.team.empty"),
          loading: t("common.loading"),
          clear: t("inventoryCount.team.clear"),
          selected: t("inventoryCount.team.selected"),
        }}
        locale={locale}
        aria-label={t("inventoryCount.responsible")}
        aria-describedby={describedByAll}
        footer={
          mayCreate
            ? ({ query, close }) => (
                <button
                  type="button"
                  className="ds-lookup-create"
                  onClick={() => {
                    close();
                    setCreateQuery(query.trim());
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 truncate">{query.trim() ? t("lookup.createNamed", { name: query.trim() }) : t("lookup.create.employee")}</span>
                </button>
              )
            : undefined
        }
      />
      {names.length ? (
        <ul ref={chipsRef} className="flex min-w-0 flex-wrap gap-1.5" aria-label={t("inventoryCount.team.chosen")}>
          {value.map((employeeId, index) => {
            const name = all.find((o) => o.id === employeeId)?.full_name;
            if (!name) return null;
            return (
              <li key={employeeId} className="ds-chip ds-chip-std max-w-full" data-tone="brand">
                <UserRound className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{name}</span>
                {disabled ? null : (
                  <button
                    type="button"
                    className="-me-1 grid h-6 w-6 shrink-0 place-items-center rounded-full hover:opacity-70"
                    aria-label={t("inventoryCount.team.remove", { name })}
                    onClick={() => removeAt(index)}
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }}>
          {t("inventoryCount.team.loadError")}
        </p>
      ) : null}
      <p className="ds-muted text-[length:var(--ds-text-xs)]" aria-live="polite">
        {full ? t("inventoryCount.team.max", { count: MAX_COUNT_TEAM }) : null}
      </p>
      {mayCreate ? <QuickCreateDialog entity="employee" open={createOpen} onOpenChange={setCreateOpen} query={createQuery} onCreated={created} /> : null}
    </LookupScope>
  );
}
