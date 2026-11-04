"use client";

import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { IconButton, Truncate, useDesignScope } from "@/design-system/components";
import { LookupScope } from "@/components/lookups/LookupScope";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * A small side drawer of the import form (IMP-4): a line's warehouse split, a cost's manual split.
 * Same look as the line grid's details drawer (ds-line-drawer), focus trapped, Esc closes,
 * actions at the bottom.
 */
export function SideDrawer({
  title,
  description,
  onClose,
  footer,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <LookupScope>
      <DrawerInner title={title} description={description} onClose={onClose} footer={footer}>
        {children}
      </DrawerInner>
    </LookupScope>
  );
}

function DrawerInner({ title, description, onClose, footer, children }: { title: string; description?: string; onClose: () => void; footer?: React.ReactNode; children: React.ReactNode }) {
  const { t } = useI18n();
  const { portalContainer } = useDesignScope();
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal container={portalContainer ?? undefined}>
        <Dialog.Overlay className="ds-overlay ds-line-drawer-overlay" />
        <Dialog.Content className="ds-panel ds-line-drawer" aria-describedby={description ? "imports-drawer-desc" : undefined}>
          <div className="ds-line-drawer-head">
            <Dialog.Title className="min-w-0 font-semibold">
              <Truncate>{title}</Truncate>
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton size="sm" label={t("common.close")} icon={<X className="h-4 w-4" />} />
            </Dialog.Close>
          </div>
          <div className="ds-line-drawer-body">
            {description ? (
              <p id="imports-drawer-desc" className="text-[length:var(--ds-text-xs)] ds-muted">
                {description}
              </p>
            ) : null}
            {children}
          </div>
          {footer ? <div className="ds-drawer-footer">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
