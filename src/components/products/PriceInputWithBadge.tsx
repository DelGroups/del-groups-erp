"use client";

import { formNumberInputClass } from "@/components/ui/form-field-styles";
import { FormField } from "@/components/ui/form-field";

interface PriceInputWithBadgeProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  badge: string;
  hint?: string | null;
  placeholder?: string;
  disabled?: boolean;
}

export default function PriceInputWithBadge({
  label,
  value,
  onChange,
  badge,
  hint,
  placeholder,
  disabled = false,
}: PriceInputWithBadgeProps) {
  const handleChange = (raw: string) => {
    if (raw.trim() === "") {
      onChange("");
      return;
    }
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    onChange(raw);
  };

  return (
    <FormField label={label} hint={hint}>
      <div className="flex min-w-0">
        <input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          className={`${formNumberInputClass} rounded-r-none border-r-0`}
        />
        <span
          className="inline-flex h-10 shrink-0 items-center rounded-r-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-table-header)] px-2.5 text-[length:var(--erp-text-xs)] font-semibold uppercase tracking-wide text-[color:var(--erp-text-muted)]"
          aria-hidden
        >
          {badge}
        </span>
      </div>
    </FormField>
  );
}
