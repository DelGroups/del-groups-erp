import { requireAdmin } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { LOCALES } from "@/lib/i18n/messages";
import { signOut } from "@/app/actions/session";
import NavLink from "@/components/NavLink";
import LanguageSelect from "@/components/LanguageSelect";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const { locale, messages, t } = await getI18n();

  return (
    <div className="cp-shell">
      <aside className="cp-sidebar">
        <div className="cp-brand">{t("common.appName")}</div>
        <NavLink href="/tenants">{t("nav.tenants")}</NavLink>
        <NavLink href="/plans">{t("nav.plans")}</NavLink>
        <div className="cp-sidebar-footer">
          <span>{admin.fullName || admin.email}</span>
          <LanguageSelect
            locale={locale}
            label={t("common.language")}
            options={LOCALES.map((l) => ({ value: l, label: messages.languages[l] }))}
          />
          <form action={signOut}>
            <button className="cp-button cp-button-secondary" type="submit">
              {t("common.signOut")}
            </button>
          </form>
        </div>
      </aside>
      <main className="cp-main">{children}</main>
    </div>
  );
}
