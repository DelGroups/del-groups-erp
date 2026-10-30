"use client";

import React, { forwardRef } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useDesignScope } from "./DesignScope";

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  /** What the button does; the accessible name and the tooltip (from src/i18n). */
  label: string;
  icon: React.ReactNode;
  /** md: 32 px hit area, sm: 28 px; the same in both densities. */
  size?: "md" | "sm";
  variant?: "ghost" | "outline" | "danger";
  /** The tooltip side. */
  side?: "top" | "bottom" | "left" | "right";
}

/** A button that is only an icon: always an aria-label and a tooltip, a fixed hit area. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", variant = "ghost", side = "top", className, type = "button", ...rest },
  ref
) {
  const { portalContainer } = useDesignScope();
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            ref={ref}
            type={type}
            aria-label={label}
            data-size={size}
            data-variant={variant}
            className={["ds-icon-button", className].filter(Boolean).join(" ")}
            {...rest}
          >
            <span aria-hidden className="contents">
              {icon}
            </span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal container={portalContainer ?? undefined}>
          <Tooltip.Content side={side} sideOffset={6} collisionPadding={8} className="ds-tooltip">
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
});
