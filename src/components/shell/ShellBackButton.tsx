"use client";

import React, { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import * as Tooltip from "@radix-ui/react-tooltip";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { useDesignScope } from "@/design-system/components";
import { transitions } from "@/design-system/motion";
import { useI18n } from "@/i18n/I18nProvider";
import { markShellNavigation, type ShellApp } from "./useShell";

// Devices without hover (phones, tablets): the arrow shows all the time.
const NO_HOVER = "(hover: none)";
function subscribeNoHover(onChange: () => void) {
  const query = window.matchMedia(NO_HOVER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function useNoHover(): boolean {
  return useSyncExternalStore(subscribeNoHover, () => window.matchMedia(NO_HOVER).matches, () => false);
}

/** Icon swap: the module icon turns away and the arrow turns in (opacity only with reduced motion). */
const MORPH = {
  initial: { opacity: 0, rotate: -90, scale: 0.6 },
  animate: { opacity: 1, rotate: 0, scale: 1 },
  exit: { opacity: 0, rotate: 90, scale: 0.6 },
};

/**
 * Top-left of the new shell's top bar, inside a module: the module's icon and name as one link
 * to the home menu (app launcher). On hover or keyboard focus the icon morphs into a back arrow
 * (200 ms, shared motion tokens); without hover the arrow always shows. It is a plain link, so
 * the browser's own back button keeps its history.
 */
export function ShellBackButton({ app, href }: { app: ShellApp; href: string }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  const reduced = useReducedMotion();
  const noHover = useNoHover();
  const [hot, setHot] = useState(false);
  const back = noHover || hot;
  const Icon = back ? ArrowLeft : app.icon;
  const label = t("newShell.homeMenu");

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Link
            href={href}
            onClick={markShellNavigation}
            aria-label={`${label}: ${app.title}`}
            data-back={back ? "" : undefined}
            onPointerEnter={() => setHot(true)}
            onPointerLeave={() => setHot(false)}
            onFocus={() => setHot(true)}
            onBlur={() => setHot(false)}
            className="ds-shell-back flex min-w-0 items-center gap-2 rounded-[var(--ds-radius-md)] py-1 pl-1 pr-2"
          >
            <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[var(--ds-radius-md)]" aria-hidden>
              <AnimatePresence initial={false}>
                <motion.span
                  key={back ? "back" : "app"}
                  className="absolute inset-0 grid place-items-center"
                  initial={reduced ? false : MORPH.initial}
                  animate={MORPH.animate}
                  exit={reduced ? { opacity: 0, transition: transitions.instant } : MORPH.exit}
                  transition={reduced ? transitions.instant : transitions.fast}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="min-w-0 truncate text-[length:var(--ds-text-base)] font-semibold">{app.title}</span>
          </Link>
        </Tooltip.Trigger>
        <Tooltip.Portal container={portalContainer ?? undefined}>
          <Tooltip.Content side="bottom" align="start" sideOffset={6} className="ds-tooltip">
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
