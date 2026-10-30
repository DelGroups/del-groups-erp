"use client";

import React, { useCallback, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useDesignScope } from "./DesignScope";
import { isTextTruncated } from "../logic";

export interface TruncateProps extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  children: string;
  /** Element to render; a span (inline) by default. */
  as?: "span" | "div" | "p" | "h1" | "h2" | "h3" | "dt" | "dd" | "label";
  htmlFor?: string;
}

/**
 * One line of text with an ellipsis (docs/ui-standard.md). The full text shows in a tooltip, but
 * only when the text really is cut: it is measured when the pointer or focus reaches it.
 * Marked data-ui-truncate, so scripts/ui-guard.mjs accepts its overflow.
 */
export function Truncate({ children, as = "span", className, ...rest }: TruncateProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const { portalContainer } = useDesignScope();
  const onOpenChange = useCallback((next: boolean) => setOpen(next && !!ref.current && isTextTruncated(ref.current)), []);
  const Tag = as as React.ElementType;
  return (
    <Tooltip.Provider delayDuration={400}>
      <Tooltip.Root open={open} onOpenChange={onOpenChange}>
        <Tooltip.Trigger asChild>
          <Tag ref={ref} className={["ds-truncate", className].filter(Boolean).join(" ")} data-ui-truncate="" data-ui-check="single-line" {...rest}>
            {children}
          </Tag>
        </Tooltip.Trigger>
        <Tooltip.Portal container={portalContainer ?? undefined}>
          <Tooltip.Content side="top" align="start" sideOffset={4} collisionPadding={8} className="ds-tooltip max-w-[24rem] break-words">
            {children}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
