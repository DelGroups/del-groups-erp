"use client";

import React, { useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import { useAuth } from "@/components/auth/AuthProvider";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { DesignScope, ToastProvider } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import type { Formatter } from "../logic";
import type { FilterContext } from "../types";

/**
 * Page frame of a view-engine screen: the usual page layout (route permission guard) with the
 * design-system scope in the user's theme and the tenant brand colour, and toasts.
 */
export function ViewScope({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const { brand } = useNewUi();
  const { t } = useI18n();
  return (
    <PageLayout>
      <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className="mx-auto w-full max-w-[100rem] rounded-[var(--ds-radius-xl)] p-3 md:p-5">
        <ToastProvider closeLabel={t("common.close")}>{children}</ToastProvider>
      </DesignScope>
    </PageLayout>
  );
}

/** Texts and number/date formats of the current language. */
export function useFormatter(): Formatter {
  const { t, locale } = useI18n();
  return useMemo(() => ({ t, locale }), [t, locale]);
}

/** Values filters refer to: the signed-in user and the time the screen opened. */
export function useFilterContext(): FilterContext {
  const { user } = useAuth();
  const [now] = useState(() => new Date());
  const userId = user?.id ?? null;
  return useMemo(() => ({ userId, now }), [userId, now]);
}
