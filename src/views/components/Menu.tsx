"use client";

import React from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { useDesignScope } from "@/design-system/components";

/** Dropdown of the view engine (Radix: arrow keys, typeahead, Esc), portalled into the scope. */
export function ViewMenu({ trigger, label, children, align = "start" }: { trigger: React.ReactNode; label?: string; children: React.ReactNode; align?: "start" | "end" }) {
  const { portalContainer } = useDesignScope();
  return (
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal container={portalContainer ?? undefined}>
        <Dropdown.Content align={align} sideOffset={6} className="ds-menu max-h-[70vh] min-w-56 overflow-y-auto">
          {label ? <Dropdown.Label className="px-2.5 pb-1 pt-1.5 ds-label">{label}</Dropdown.Label> : null}
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/**
 * A toggle in a menu that stays open, so several filters can be picked in a row. FLT-2: a person
 * may carry a muted second line (`hint`) and a row count read as `countLabel` ("9 qeyd").
 */
export function MenuCheck({
  checked,
  onCheckedChange,
  children,
  hint,
  count,
  countLabel,
  onPointerMove,
}: {
  checked: boolean;
  onCheckedChange: () => void;
  children: React.ReactNode;
  hint?: string;
  count?: number;
  countLabel?: string;
  onPointerMove?: (e: React.PointerEvent) => void;
}) {
  const rich = hint !== undefined || count !== undefined;
  return (
    <Dropdown.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => e.preventDefault()}
      onPointerMove={onPointerMove}
      className="ds-menu-item"
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center" aria-hidden>
        {checked ? <Check className="h-4 w-4" /> : null}
      </span>
      {rich ? (
        <>
          <span className="flex min-w-0 flex-1 flex-col py-1">
            <span className="truncate">{children}</span>
            {hint ? <span className="truncate text-[length:var(--ds-text-xs)] ds-muted">{hint}</span> : null}
          </span>
          {count ? (
            <>
              <span className="ms-2 shrink-0 tabular-nums text-[length:var(--ds-text-xs)] ds-muted" aria-hidden>
                {count}
              </span>
              {countLabel ? <span className="sr-only">{countLabel}</span> : null}
            </>
          ) : null}
        </>
      ) : (
        children
      )}
    </Dropdown.CheckboxItem>
  );
}

export function MenuItem({ onSelect, children, danger }: { onSelect: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <Dropdown.Item onSelect={onSelect} className="ds-menu-item" style={danger ? { color: "var(--ds-danger-strong)" } : undefined}>
      {children}
    </Dropdown.Item>
  );
}

export function MenuSeparator() {
  return <Dropdown.Separator className="ds-menu-sep" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <Dropdown.Label className="px-2.5 pb-1 pt-1.5 ds-label">{children}</Dropdown.Label>;
}
