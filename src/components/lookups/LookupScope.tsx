"use client";

import React from "react";
import { DesignScope } from "@/design-system/components";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Design-system scope for a lookup inside a classic form (no [data-ds] around it): the
 * Combobox, IconButton and dialog styles need one. Follows the classic theme, like ListGrid.
 */
export function LookupScope({ className, children }: { className?: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  const { brand } = useNewUi();
  return (
    <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className={["ds-scope-transparent", className].filter(Boolean).join(" ")}>
      {children}
    </DesignScope>
  );
}
