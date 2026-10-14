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

/** A toggle in a menu that stays open, so several filters can be picked in a row. */
export function MenuCheck({ checked, onCheckedChange, children }: { checked: boolean; onCheckedChange: () => void; children: React.ReactNode }) {
  return (
    <Dropdown.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => e.preventDefault()}
      className="ds-menu-item"
    >
      <span className="grid h-4 w-4 place-items-center" aria-hidden>
        {checked ? <Check className="h-4 w-4" /> : null}
      </span>
      {children}
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
