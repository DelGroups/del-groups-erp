"use client";

import React, { createContext, useContext, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { MotionConfig } from "motion/react";
import { layerClassName, scopeAttributes, type DsDensity, type DsTheme } from "../theme";

interface DesignScopeContextValue {
  theme: DsTheme;
  density: DsDensity;
  /** Top-level layer (under <body>) that overlays portal into, with this scope's theme. */
  portalContainer: HTMLElement | null;
  /** The scope's brand variables, so a nested scope knows when it looks the same. */
  styleKey?: string;
}

const DesignScopeContext = createContext<DesignScopeContextValue>({ theme: "system", density: "comfortable", portalContainer: null });

export function useDesignScope(): DesignScopeContextValue {
  return useContext(DesignScopeContext);
}

export interface DesignScopeProps {
  theme?: DsTheme;
  density?: DsDensity;
  /** Tenant brand colour (hex) from the company settings; default brand when missing. */
  brand?: string | null;
  /** Extra classes on the root, e.g. the font variable from fonts.ts. */
  className?: string;
  children: React.ReactNode;
}

const noop = () => () => {};

export { layerClassName };

/**
 * Root of every new-UI tree (prompt 15): sets data-ds, theme, density and the brand colour
 * variables, makes motion follow the OS "reduce motion" setting, and gives overlays a portal
 * target. Nothing outside it changes.
 *
 * The portal target is a layer directly under <body> (UI-5), not inside the scope: a scope can sit
 * inside a table cell or a sticky row (a lookup in a document line), and an overlay portaled there
 * was painted under the sticky totals row and clipped by the table. The layer carries the scope's
 * attributes, so tokens and the theme still apply; z-index comes from the one scale (layers.css).
 */
export function DesignScope({ theme = "system", density = "comfortable", brand, className, children }: DesignScopeProps) {
  const parent = useContext(DesignScopeContext);
  const [ownContainer, setOwnContainer] = useState<HTMLElement | null>(null);
  const attrs = scopeAttributes({ theme, density, brand });
  const resolvedTheme = attrs["data-ds-theme"];
  const resolvedDensity = attrs["data-ds-density"];
  const styleKey = JSON.stringify(attrs.style);
  // A scope inside a scope with the same look (a lookup in a dialog, a cell in a list) shares
  // its layer: one layer per page, and a dialog and the lookups in it live in the same one.
  const reuse = !!parent.portalContainer && parent.theme === resolvedTheme && parent.density === resolvedDensity && parent.styleKey === styleKey;
  const portalContainer = reuse ? parent.portalContainer : ownContainer;
  const value = useMemo(
    () => ({ theme: resolvedTheme, density: resolvedDensity, portalContainer, styleKey }),
    [resolvedTheme, resolvedDensity, portalContainer, styleKey]
  );
  // Only in the browser: the server renders no layer, and hydration never mismatches.
  const isClient = useSyncExternalStore(noop, () => true, () => false);
  return (
    <div {...attrs} style={attrs.style as React.CSSProperties} className={["ds-root", className].filter(Boolean).join(" ")}>
      <MotionConfig reducedMotion="user">
        <DesignScopeContext.Provider value={value}>{children}</DesignScopeContext.Provider>
      </MotionConfig>
      {isClient && !reuse
        ? createPortal(
            // aria-live="off" (the default, announces nothing): Radix dialogs hide every other
            // child of <body> from assistive tech while open, except [aria-live] elements; a
            // lookup list opened from the dialog lives here and must stay readable.
            <div {...attrs} style={attrs.style as React.CSSProperties} className={layerClassName(className)} data-ds-portal="" aria-live="off" ref={setOwnContainer} />,
            document.body
          )
        : null}
    </div>
  );
}
