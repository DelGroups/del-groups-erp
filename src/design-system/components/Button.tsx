"use client";

import React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2, type LucideIcon } from "lucide-react";

/*
 * The one button of the UI rulebook (UI-7, docs/ui-standard.md ACT-1): five variants, two sizes.
 *   primary    the one main action of a screen (ACT-2)
 *   secondary  every other action, Cancel (neutral outline)
 *   ghost      low-emphasis actions in toolbars and cards
 *   danger     the confirm button of a destructive dialog
 * Icon-only buttons are IconButton. Sizes: md 40 px (default), sm 32 px (toolbars, tables).
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "ds-btn-primary",
  secondary: "",
  ghost: "ds-btn-ghost",
  danger: "ds-btn-danger",
};

/** Class names of a button, for links and triggers that cannot be a <Button>. */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string): string {
  return ["ds-btn", VARIANT[variant], size === "sm" ? "ds-btn-sm" : "", className].filter(Boolean).join(" ");
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (16 px, decorative). */
  icon?: LucideIcon;
  /** Busy: a spinner replaces the icon, the button is disabled and aria-busy. */
  loading?: boolean;
  /** Render the child element (a Link) with the button's look instead of a <button>. */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: Icon, loading = false, asChild = false, className, children, disabled, type, ...rest },
  ref
) {
  const cls = buttonClass(variant, size, className);
  if (asChild) {
    return (
      <Slot ref={ref} className={cls} {...rest}>
        {children}
      </Slot>
    );
  }
  return (
    <button ref={ref} type={type ?? "button"} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} data-variant={variant} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
});
