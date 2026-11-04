"use client";

import React from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { MoreVertical } from "lucide-react";
import { useDesignScope } from "./DesignScope";

/** One item of a row's "…" menu (a link or a command). */
export interface RowMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  /** A link: Enter / click navigates (middle-click opens a tab). */
  href?: string;
  /** A command, or (with href) what to do before the link navigates. */
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export interface RowActionsMenuProps {
  items: readonly RowMenuItem[];
  /** Accessible name of the trigger ("Actions"). */
  label: string;
  /** Link component for href items (next/link from the app). */
  linkAs?: React.ElementType;
}

/**
 * The "…" menu at the end of every list row (UI-5): Radix dropdown (arrow keys, typeahead, Esc,
 * focus returns to the trigger), portalled to the scope's top-level layer so a grid or a sticky row
 * never clips it, collision-aware (flips, never taller than the room). Destructive items come last,
 * after a separator. No items: no menu.
 */
export function RowActionsMenu({ items, label, linkAs: LinkTag = "a" }: RowActionsMenuProps) {
  const { portalContainer } = useDesignScope();
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  const normal = shown.filter((i) => !i.destructive);
  const danger = shown.filter((i) => i.destructive);
  const item = (i: RowMenuItem) => {
    const body = (
      <>
        {i.icon ? (
          <span className="ds-row-menu-icon" aria-hidden>
            {i.icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{i.label}</span>
      </>
    );
    const className = ["ds-menu-item", i.destructive ? "ds-menu-item-danger" : ""].filter(Boolean).join(" ");
    if (i.href && !i.disabled) {
      return (
        <Dropdown.Item key={i.key} asChild className={className} onSelect={() => i.onSelect?.()}>
          <LinkTag href={i.href}>{body}</LinkTag>
        </Dropdown.Item>
      );
    }
    return (
      <Dropdown.Item key={i.key} className={className} disabled={i.disabled} onSelect={() => i.onSelect?.()}>
        {body}
      </Dropdown.Item>
    );
  };
  return (
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger className="ds-icon-button ds-row-menu-trigger" data-size="sm" aria-label={label} title={label} data-grid-stop="">
        <MoreVertical className="h-4 w-4" aria-hidden />
      </Dropdown.Trigger>
      <Dropdown.Portal container={portalContainer ?? undefined}>
        <Dropdown.Content align="end" sideOffset={4} collisionPadding={8} className="ds-menu min-w-44" onClick={(e) => e.stopPropagation()}>
          {normal.map(item)}
          {normal.length && danger.length ? <Dropdown.Separator className="ds-menu-sep" /> : null}
          {danger.map(item)}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
