"use client";

import React from "react";
import Link from "next/link";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonVariants, type ButtonColor, type ButtonSize } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface SplitButtonMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

export interface SplitButtonProps {
  label: React.ReactNode;
  icon?: React.ReactNode;
  href?: string;
  onPrimaryClick?: () => void;
  menuItems: SplitButtonMenuItem[];
  disabled?: boolean;
  loading?: boolean;
  color?: ButtonColor;
  size?: ButtonSize;
  className?: string;
  /** Accessible label for the chevron trigger. */
  menuAriaLabel?: string;
}

function resolveSize(size?: ButtonSize) {
  if (size === "default") return "md";
  return size ?? "md";
}

export function SplitButton({
  label,
  icon,
  href,
  onPrimaryClick,
  menuItems,
  disabled = false,
  loading = false,
  color = "primary",
  size,
  className,
  menuAriaLabel = "More actions",
}: SplitButtonProps) {
  const resolvedSize = resolveSize(size);
  const sharedClass = buttonVariants({
    appearance: "solid",
    color,
    size: resolvedSize,
  });

  const primaryClass = cn(
    sharedClass,
    "rounded-r-none pr-3 shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.22)]",
    (disabled || loading) && "pointer-events-none opacity-50"
  );

  const triggerClass = cn(
    sharedClass,
    "rounded-l-none px-2",
    disabled && "pointer-events-none opacity-50"
  );

  const primaryContent = (
    <>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {label}
    </>
  );

  const primary =
    href && !disabled ? (
      <Link href={href} className={primaryClass} aria-busy={loading}>
        {primaryContent}
      </Link>
    ) : (
      <button
        type="button"
        className={primaryClass}
        onClick={onPrimaryClick}
        disabled={disabled || loading}
        aria-busy={loading}
      >
        {primaryContent}
      </button>
    );

  return (
    <div className={cn("inline-flex items-stretch", className)}>
      {primary}

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button type="button" className={triggerClass} aria-label={menuAriaLabel}>
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[14rem]">
          {menuItems.map((item) => (
            <DropdownMenuItem
              key={item.key}
              disabled={item.disabled}
              onSelect={(event) => {
                event.preventDefault();
                item.onSelect();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default SplitButton;
