"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import { MotionConfig } from "motion/react";
import { scopeAttributes, type DsDensity, type DsTheme } from "../theme";

interface DesignScopeContextValue {
  theme: DsTheme;
  density: DsDensity;
  /** Element inside the scope that overlays portal into, so they keep its theme. */
  portalContainer: HTMLElement | null;
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

/**
 * Root of every new-UI tree (prompt 15): sets data-ds, theme, density and the brand colour
 * variables, makes motion follow the OS "reduce motion" setting, and gives overlays a portal
 * target inside the scope. Nothing outside it changes.
 */
export function DesignScope({ theme = "system", density = "comfortable", brand, className, children }: DesignScopeProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const attrs = scopeAttributes({ theme, density, brand });
  const resolvedTheme = attrs["data-ds-theme"];
  const resolvedDensity = attrs["data-ds-density"];
  const value = useMemo(
    () => ({ theme: resolvedTheme, density: resolvedDensity, portalContainer }),
    [resolvedTheme, resolvedDensity, portalContainer]
  );
  return (
    <div {...attrs} style={attrs.style as React.CSSProperties} className={["ds-root", className].filter(Boolean).join(" ")}>
      <MotionConfig reducedMotion="user">
        <DesignScopeContext.Provider value={value}>
          {children}
          <div ref={setPortalContainer} data-ds-portal="" />
        </DesignScopeContext.Provider>
      </MotionConfig>
    </div>
  );
}
