"use client";

import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { PageFrame, PageHeader, buttonClass } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { SHELL_HOME } from "@/lib/shell/shell";
import { useUiUnified } from "./NewUiProvider";

/** The plain page Next.js shows for an unknown address (kept while UI_UNIFIED is off). */
function PlainNotFound() {
  return (
    <div style={{ display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <h1 style={{ margin: "0 20px 0 0", paddingRight: 23, fontSize: 24, fontWeight: 500, lineHeight: "49px", borderRight: "1px solid currentColor" }}>404</h1>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 400, lineHeight: "49px" }}>This page could not be found.</h2>
      </div>
    </div>
  );
}

/** NAV-6: the translated not-found page inside the shell, with one way back (the app launcher). */
export function NotFoundView() {
  const unified = useUiUnified();
  const { t } = useI18n();
  if (!unified) return <PlainNotFound />;
  return (
    <PageLayout permission={null}>
      <PageFrame
        width="form"
        header={
          <PageHeader
            title={t("uiUnified.notFound.title")}
            description={t("uiUnified.notFound.body")}
            eyebrow={<span className="ds-not-found-code">{t("uiUnified.notFound.code")}</span>}
            primary={
              <Link href={SHELL_HOME} className={buttonClass("primary")}>
                <LayoutGrid className="h-4 w-4" aria-hidden />
                {t("uiUnified.notFound.home")}
              </Link>
            }
          />
        }
      />
    </PageLayout>
  );
}
