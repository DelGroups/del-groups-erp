"use client";

/**
 * Canonical app shell export — wraps every authenticated ERP page.
 * Re-exports PageLayout (auth guard, command palette, AI widget, Gentelella shell).
 */
export { default, default as AppLayout } from "@/components/layout/PageLayout";
