"use client";

import React from "react";
import { Plus } from "lucide-react";
import Button from "@/components/ui/button";
import PageHeader from "@/components/ui/page-header";

interface DocumentPageHeaderProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  createLabel?: string;
  onCreate?: () => void;
  createDisabled?: boolean;
  extraActions?: React.ReactNode;
  backLink?: { href: string; label: string };
}

export default function DocumentPageHeader({
  icon,
  title,
  description,
  createLabel,
  onCreate,
  createDisabled,
  extraActions,
  backLink,
}: DocumentPageHeaderProps) {
  const hasActions = Boolean(extraActions) || Boolean(createLabel && onCreate);

  return (
    <PageHeader
      icon={icon}
      title={title}
      subtitle={description}
      breadcrumbs={backLink ? [{ href: backLink.href, label: backLink.label }] : undefined}
      actions={
        hasActions ? (
          <>
            {extraActions}
            {createLabel && onCreate ? (
              <Button onClick={onCreate} disabled={createDisabled}>
                <Plus className="h-4 w-4" />
                {createLabel}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}
