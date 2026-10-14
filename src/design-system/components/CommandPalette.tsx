"use client";

import React, { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { motion, useReducedMotion } from "motion/react";
import { Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { filterPalette, type PaletteCommand, type PaletteGroup } from "../logic";
import { motionPreset, overlayVariants, panelVariants } from "../motion";
import { useDesignScope } from "./DesignScope";

export interface PaletteAction extends PaletteCommand {
  icon?: LucideIcon;
  onSelect: () => void;
}

export interface CommandPaletteLabels {
  title: string;
  placeholder: string;
  empty: string;
  navigate: string;
  select: string;
  close: string;
}

export interface CommandPaletteProps {
  groups: readonly PaletteGroup<PaletteAction>[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: CommandPaletteLabels;
  /** Open with ⌘K / Ctrl-K while mounted (default true). */
  hotkey?: boolean;
}

/**
 * Command palette (reference bonus/bonus-command-palette): grouped results with icons and
 * shortcuts, filtered as you type (groups with no match disappear), ↑/↓ wrap around, Enter
 * runs the highlighted command, Esc or a click outside closes, ⌘K / Ctrl-K reopens with an
 * empty query. Radix Dialog traps focus; cmdk keeps hover and keyboard selection in step.
 */
export function CommandPalette({ groups, open, onOpenChange, labels, hotkey = true }: CommandPaletteProps) {
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterPalette(groups, query), [groups, query]);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuery("");
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey, open, onOpenChange]);

  const run = (action: PaletteAction) => {
    if (action.disabled) return;
    onOpenChange(false);
    setQuery("");
    action.onSelect();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <Dialog.Portal container={portalContainer ?? undefined}>
        <Dialog.Overlay asChild>
          <motion.div className="ds-overlay" variants={motionPreset(overlayVariants, reduced)} initial="initial" animate="enter" />
        </Dialog.Overlay>
        <Dialog.Content asChild aria-describedby={undefined}>
          <motion.div
            className="ds-panel fixed left-1/2 top-[12vh] z-[61] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden"
            variants={motionPreset(panelVariants, reduced)}
            initial="initial"
            animate="enter"
          >
            <Dialog.Title className="sr-only">{labels.title}</Dialog.Title>
            <Command shouldFilter={false} loop label={labels.title}>
              <div className="flex items-center gap-3 border-b px-4" style={{ borderColor: "var(--ds-border)" }}>
                <Search className="h-4 w-4 shrink-0 ds-muted" aria-hidden />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder={labels.placeholder}
                  className="h-14 w-full bg-transparent text-[length:var(--ds-text-base)] outline-none placeholder:text-[color:var(--ds-text-subtle)]"
                />
                <kbd className="ds-kbd">Esc</kbd>
              </div>
              <Command.List className="max-h-[min(60vh,24rem)] overflow-y-auto p-2">
                {visible.length === 0 ? <div className="px-3 py-8 text-center ds-muted">{labels.empty}</div> : null}
                {visible.map((group) => (
                  <Command.Group key={group.id} heading={group.heading}>
                    {group.commands.map((c) => {
                      const Icon = c.icon;
                      return (
                        <Command.Item key={c.id} value={c.id} disabled={c.disabled} onSelect={() => run(c)}>
                          <span
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--ds-radius-sm)]"
                            style={{ background: "var(--ds-surface-sunken)", border: "1px solid var(--ds-border)" }}
                            aria-hidden
                          >
                            {Icon ? <Icon className="h-4 w-4" /> : null}
                          </span>
                          <span className="flex-1 truncate">{c.label}</span>
                          {c.shortcut?.length ? (
                            <span className="flex gap-1" aria-hidden>
                              {c.shortcut.map((k) => (
                                <kbd key={k} className="ds-kbd">
                                  {k}
                                </kbd>
                              ))}
                            </span>
                          ) : null}
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                ))}
              </Command.List>
              <div
                className="flex items-center gap-4 border-t px-4 py-2.5 text-[length:var(--ds-text-xs)] ds-muted"
                style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface-sunken)" }}
              >
                <span className="flex items-center gap-1.5">
                  <kbd className="ds-kbd">↑</kbd>
                  <kbd className="ds-kbd">↓</kbd> {labels.navigate}
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="ds-kbd">↵</kbd> {labels.select}
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="ds-kbd">Esc</kbd> {labels.close}
                </span>
              </div>
            </Command>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
