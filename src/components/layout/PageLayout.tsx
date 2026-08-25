"use client";

import React from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import PermissionGuard from "@/components/auth/PermissionGuard";
import { getRequiredPermission } from "@/lib/auth/routePermissions";
import type { PermissionKey } from "@/types/database.types";

interface PageLayoutProps {
  children: React.ReactNode;
  /** Override auto-detected route permission. Pass `null` to skip guarding. */
  permission?: PermissionKey | null;
}

export default function PageLayout({ children, permission }: PageLayoutProps) {
  const pathname = usePathname();
  const requiredPermission =
    permission === undefined ? getRequiredPermission(pathname) : permission;

  return (
    <div className="flex h-screen overflow-hidden bg-app">
      <Sidebar />
      <div className="min-w-0 flex-1 overflow-y-auto bg-app">{requiredPermission ? (
          <PermissionGuard permission={requiredPermission}>{children}</PermissionGuard>
        ) : (
          children
        )}</div>
    </div>
  );
}
