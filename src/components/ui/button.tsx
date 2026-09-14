"use client";

import React from "react";
import Link from "next/link";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

const buttonBase =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--erp-radius-md)] border text-[length:var(--erp-text-sm)] font-[var(--erp-font-weight-normal)] shadow-none transition-[background-color,border-color,color] duration-[var(--erp-duration-normal)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--erp-border-focus)] disabled:pointer-events-none disabled:opacity-50";

const solidColors = {
  primary:
    "border-transparent bg-[color:var(--erp-color-primary)] text-[color:var(--erp-color-primary-foreground)] hover:bg-[color:var(--erp-color-primary-hover)] active:bg-[color:var(--erp-color-primary-active)]",
  secondary:
    "border-transparent bg-[color:var(--erp-color-secondary)] text-[color:var(--erp-color-secondary-foreground)] hover:bg-[color:var(--erp-color-secondary-hover)] active:bg-[color:var(--erp-color-secondary-active)]",
  success:
    "border-transparent bg-[color:var(--erp-color-success)] text-[color:var(--erp-color-success-foreground)] hover:bg-[color:var(--erp-color-success-hover)]",
  danger:
    "border-transparent bg-[color:var(--erp-color-danger)] text-[color:var(--erp-color-danger-foreground)] hover:bg-[color:var(--erp-color-danger-hover)]",
  info:
    "border-transparent bg-[color:var(--erp-color-info)] text-[color:var(--erp-color-info-foreground)] hover:bg-[color:var(--erp-color-info-hover)]",
  warning:
    "border-transparent bg-[color:var(--erp-color-warning)] text-[color:var(--erp-color-warning-foreground)] hover:bg-[color:var(--erp-color-warning-hover)]",
} as const;

const outlineColors = {
  primary:
    "border-[color:var(--erp-color-primary)] bg-transparent text-[color:var(--erp-color-primary)] hover:bg-[color:var(--erp-color-primary)]/10",
  secondary:
    "border-[color:var(--erp-color-secondary)] bg-transparent text-[color:var(--erp-color-secondary)] hover:bg-[color:var(--erp-color-secondary)]/10",
  success:
    "border-[color:var(--erp-color-success)] bg-transparent text-[color:var(--erp-color-success)] hover:bg-[color:var(--erp-color-success)]/10",
  danger:
    "border-[color:var(--erp-color-danger)] bg-transparent text-[color:var(--erp-color-danger)] hover:bg-[color:var(--erp-color-danger)]/10",
  info:
    "border-[color:var(--erp-color-info)] bg-transparent text-[color:var(--erp-color-info)] hover:bg-[color:var(--erp-color-info)]/10",
} as const;

const textColors = {
  primary:
    "border-transparent bg-transparent text-[color:var(--erp-color-primary)] hover:bg-[color:var(--erp-color-primary)]/10",
  secondary:
    "border-transparent bg-transparent text-[color:var(--erp-color-secondary)] hover:bg-[color:var(--erp-color-secondary)]/10",
  success:
    "border-transparent bg-transparent text-[color:var(--erp-color-success)] hover:bg-[color:var(--erp-color-success)]/10",
  danger:
    "border-transparent bg-transparent text-[color:var(--erp-color-danger)] hover:bg-[color:var(--erp-color-danger)]/10",
  info:
    "border-transparent bg-transparent text-[color:var(--erp-color-info)] hover:bg-[color:var(--erp-color-info)]/10",
} as const;

export const buttonVariants = cva(buttonBase, {
  variants: {
    appearance: {
      solid: "",
      outline: "",
      text: "",
    },
    color: {
      primary: "",
      secondary: "",
      success: "",
      danger: "",
      info: "",
      warning: "",
    },
    size: {
      sm: "px-2 py-1",
      md: "px-3 py-1.5",
      lg: "px-4 py-2.5",
    },
  },
  compoundVariants: [
    { appearance: "solid", color: "primary", class: solidColors.primary },
    { appearance: "solid", color: "secondary", class: solidColors.secondary },
    { appearance: "solid", color: "success", class: solidColors.success },
    { appearance: "solid", color: "danger", class: solidColors.danger },
    { appearance: "solid", color: "info", class: solidColors.info },
    { appearance: "solid", color: "warning", class: solidColors.warning },
    { appearance: "outline", color: "primary", class: outlineColors.primary },
    { appearance: "outline", color: "secondary", class: outlineColors.secondary },
    { appearance: "outline", color: "success", class: outlineColors.success },
    { appearance: "outline", color: "danger", class: outlineColors.danger },
    { appearance: "outline", color: "info", class: outlineColors.info },
    { appearance: "text", color: "primary", class: textColors.primary },
    { appearance: "text", color: "secondary", class: textColors.secondary },
    { appearance: "text", color: "success", class: textColors.success },
    { appearance: "text", color: "danger", class: textColors.danger },
    { appearance: "text", color: "info", class: textColors.info },
  ],
  defaultVariants: {
    appearance: "solid",
    color: "primary",
    size: "md",
  },
});

export type ButtonAppearance = "solid" | "outline" | "text";
export type ButtonColor = "primary" | "secondary" | "success" | "danger" | "info" | "warning";
export type ButtonSize = "sm" | "md" | "lg" | "default";

/** @deprecated Prefer `appearance` + `color` */
export type ButtonVariant =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "danger"
  | "info"
  | "outline"
  | "destructive"
  | "ghost";

type CommonProps = {
  asChild?: boolean;
  loading?: boolean;
  className?: string;
  children?: React.ReactNode;
  appearance?: ButtonAppearance;
  color?: ButtonColor;
  size?: ButtonSize;
  /** @deprecated Use `appearance` + `color` */
  variant?: ButtonVariant;
};

export type ButtonProps = CommonProps &
  (
    | ({ href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className">)
    | ({ href?: never } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className">)
  );

function resolveLegacyVariant(variant?: ButtonVariant): {
  appearance: ButtonAppearance;
  color: ButtonColor;
} {
  switch (variant) {
    case "outline":
      return { appearance: "outline", color: "primary" };
    case "ghost":
      return { appearance: "text", color: "secondary" };
    case "destructive":
    case "danger":
      return { appearance: "solid", color: "danger" };
    case "secondary":
      return { appearance: "solid", color: "secondary" };
    case "success":
      return { appearance: "solid", color: "success" };
    case "info":
      return { appearance: "solid", color: "info" };
    case "default":
    case "primary":
    default:
      return { appearance: "solid", color: "primary" };
  }
}

function resolveSize(size?: ButtonSize) {
  if (size === "default") return "md";
  return size ?? "md";
}

export function Button({
  className,
  appearance,
  color,
  size,
  variant,
  asChild = false,
  loading = false,
  children,
  ...rest
}: ButtonProps) {
  const legacy = variant ? resolveLegacyVariant(variant) : null;
  const resolvedAppearance = appearance ?? legacy?.appearance ?? "solid";
  const resolvedColor = color ?? legacy?.color ?? "primary";

  const classes = cn(
    buttonVariants({
      appearance: resolvedAppearance,
      color: resolvedColor,
      size: resolveSize(size),
    }),
    className
  );

  const content = (
    <>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </>
  );

  if ("href" in rest && rest.href) {
    const { href, ...anchorRest } = rest;
    return (
      <Link
        href={href}
        className={cn(classes, loading && "pointer-events-none opacity-50")}
        aria-busy={loading}
        {...anchorRest}
      >
        {content}
      </Link>
    );
  }

  const Comp = asChild ? Slot : "button";
  const buttonRest = rest as React.ButtonHTMLAttributes<HTMLButtonElement>;

  return (
    <Comp
      {...buttonRest}
      type={asChild ? undefined : buttonRest.type ?? "button"}
      className={classes}
      disabled={buttonRest.disabled || loading}
      aria-busy={loading}
    >
      {content}
    </Comp>
  );
}

export default Button;
