import LoginForm from "./LoginForm";
import { getI18n } from "@/lib/i18n/server";
import type { LoginState } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { messages, t } = await getI18n();
  const { error } = await searchParams;
  const initialError: LoginState["error"] = error === "notAdmin" ? "notAdmin" : null;

  return (
    <main className="cp-login">
      <div className="cp-panel cp-login-card">
        <h1 className="erp-h3">{t("login.title")}</h1>
        <p className="cp-muted" style={{ marginBottom: "var(--erp-space-5)" }}>
          {t("login.subtitle")}
        </p>
        <LoginForm
          initialError={initialError}
          labels={{
            email: messages.login.email,
            password: messages.login.password,
            submit: messages.login.submit,
            submitting: messages.login.submitting,
            errors: messages.login.errors,
          }}
        />
      </div>
    </main>
  );
}
