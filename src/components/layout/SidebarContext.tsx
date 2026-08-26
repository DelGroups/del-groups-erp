"use client";

import { createContext, useContext } from "react";

interface SidebarMenuContextValue {
  openMobileMenu: () => void;
  closeMobileMenu: () => void;
}

const SidebarMenuContext = createContext<SidebarMenuContextValue | null>(null);

export function SidebarMenuProvider({
  value,
  children,
}: {
  value: SidebarMenuContextValue;
  children: React.ReactNode;
}) {
  return (
    <SidebarMenuContext.Provider value={value}>{children}</SidebarMenuContext.Provider>
  );
}

export function useSidebarMenu(): SidebarMenuContextValue | null {
  return useContext(SidebarMenuContext);
}
