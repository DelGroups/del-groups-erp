/**
 * Auth email templates for a new tenant (invite, password reset), in the tenant's language,
 * for PATCH /v1/projects/{ref}/config/auth. Texts live in lib/i18n/messages.ts
 * (provisioning.email). {{ .ConfirmationURL }} is filled in by Supabase Auth.
 */
import { MESSAGES, translate } from "../i18n/messages.ts";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function template(heading: string, body: string, button: string): string {
  return [
    `<h2>${escapeHtml(heading)}</h2>`,
    `<p>${escapeHtml(body)}</p>`,
    `<p><a href="{{ .ConfirmationURL }}">${escapeHtml(button)}</a></p>`,
  ].join("\n");
}

export function authEmailConfig(language: "az" | "en" | "ru", company: string): Record<string, string> {
  const messages = MESSAGES[language] ?? MESSAGES.az;
  const text = (key: string) => translate(messages, `provisioning.email.${key}`, { company });
  return {
    mailer_subjects_invite: text("inviteSubject"),
    mailer_templates_invite_content: template(text("inviteHeading"), text("inviteBody"), text("inviteButton")),
    mailer_subjects_recovery: text("recoverySubject"),
    mailer_templates_recovery_content: template(text("recoveryHeading"), text("recoveryBody"), text("recoveryButton")),
  };
}
