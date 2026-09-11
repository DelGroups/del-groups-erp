"use client";

import React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export type ButtonProps = CommonProps &
  (
    | ({ href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className">)
    | ({ href?: never } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className">)
  );

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-[image:var(--app-gradient)] text-white shadow-sm hover:brightness-110 disabled:hover:brightness-100",
  secondary:
    "border border-app bg-app-card-hover text-app hover:bg-app-card disabled:hover:bg-app-card-hover",
  danger:
    "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:hover:bg-rose-50",
  ghost: "text-app-muted hover:bg-app-card-hover hover:text-app",
  outline:
    "border border-slate-200 bg-transparent text-app hover:bg-app-card-hover dark:border-white/15",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-3.5 text-sm",
  lg: "h-10 px-4 text-sm",
};

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = cn(BASE, VARIANT[variant], SIZE[size], className);
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

  const buttonRest = rest as React.ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      {...buttonRest}
      type={buttonRest.type ?? "button"}
      className={classes}
      disabled={buttonRest.disabled || loading}
      aria-busy={loading}
    >
      {content}
    </button>
  );
}
