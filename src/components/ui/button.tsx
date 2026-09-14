"use client";

import React from "react";
import Link from "next/link";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-blue-600 text-white hover:bg-blue-700",
        secondary:
          "bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
        outline:
          "border border-slate-300 bg-transparent text-slate-900 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800/80",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        ghost:
          "bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
      },
      size: {
        default: "h-10 px-4 py-2 text-sm",
        sm: "h-9 px-3 text-sm",
        lg: "h-11 px-8 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

/** @deprecated Use `default` */
export type ButtonVariant =
  | "default"
  | "secondary"
  | "outline"
  | "destructive"
  | "ghost"
  | "primary"
  | "danger";

export type ButtonSize = "default" | "sm" | "lg" | "md";

type CommonProps = VariantProps<typeof buttonVariants> & {
  asChild?: boolean;
  loading?: boolean;
  className?: string;
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export type ButtonProps = CommonProps &
  (
    | ({ href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className">)
    | ({ href?: never } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className">)
  );

function resolveVariant(variant?: ButtonVariant) {
  if (variant === "primary") return "default";
  if (variant === "danger") return "destructive";
  return variant ?? "default";
}

function resolveSize(size?: ButtonSize) {
  if (size === "md") return "default";
  return size ?? "default";
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  children,
  ...rest
}: ButtonProps) {
  const classes = cn(
    buttonVariants({ variant: resolveVariant(variant), size: resolveSize(size) }),
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
