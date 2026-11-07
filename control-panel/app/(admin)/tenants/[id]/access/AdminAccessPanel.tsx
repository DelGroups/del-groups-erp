"use client";

import { useEffect, useRef, useState } from "react";
import type { Messages } from "@/lib/i18n/messages";
import { createTenantAdminLink, reapplyTenantEmailSettings, type AccessActionError, type LinkResult } from "./actions";

type Labels = Messages["adminAccess"];
type Link = Extract<LinkResult, { ok: true }>;

function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

export default function AdminAccessPanel({
  tenantId,
  locale,
  adminEmail,
  smtpHost,
  canLink,
  configured,
  labels,
}: {
  tenantId: string;
  locale: string;
  adminEmail: string | null;
  /** Host of TENANT_SMTP_*; null = Supabase's default email. */
  smtpHost: string | null;
  /** Trial or active tenant with a database. */
  canLink: boolean;
  /** Provisioning settings (Management API token etc.) are present. */
  configured: boolean;
  labels: Labels;
}) {
  const [busy, setBusy] = useState<"reapply" | "link" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (link && !dialog.current?.open) dialog.current?.showModal();
  }, [link]);

  const errorText = (error: AccessActionError, detail?: string) =>
    fill(labels.errors[error] ?? labels.errors.failed, { detail: detail ?? "" });

  const reapply = async () => {
    setBusy("reapply");
    setNotice(null);
    try {
      const result = await reapplyTenantEmailSettings(tenantId);
      setNotice(
        result.ok
          ? { tone: "success", text: result.customSmtp ? labels.reappliedSmtp : labels.reappliedDefault }
          : { tone: "error", text: errorText(result.error, result.detail) }
      );
    } catch {
      setNotice({ tone: "error", text: errorText("failed") });
    } finally {
      setBusy(null);
    }
  };

  const createLink = async () => {
    setBusy("link");
    setNotice(null);
    try {
      const result = await createTenantAdminLink(tenantId);
      if (result.ok) {
        setCopied(false);
        setLink(result);
      } else {
        setNotice({ tone: "error", text: errorText(result.error, result.detail) });
      }
    } catch {
      setNotice({ tone: "error", text: errorText("failed") });
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.link);
      setCopied(true);
    } catch {
      // No clipboard permission (e.g. plain http): select the text so Ctrl+C works.
      field.current?.select();
    }
  };

  // Closing forgets the link: it is not shown again.
  const forget = () => {
    setLink(null);
    setCopied(false);
  };

  return (
    <div>
      <p className="cp-muted">{labels.intro}</p>
      <dl className="cp-dl">
        <dt>{labels.admin}</dt>
        <dd>{adminEmail ?? labels.noAdmin}</dd>
        <dt>{labels.email}</dt>
        <dd>{smtpHost ? fill(labels.emailSmtp, { host: smtpHost }) : labels.emailDefault}</dd>
      </dl>

      {notice ? (
        <p className={`cp-alert ${notice.tone === "success" ? "cp-alert-success" : "cp-alert-error"}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}

      {!configured ? (
        <p className="cp-muted">{labels.errors.notConfigured}</p>
      ) : (
        <p style={{ display: "flex", gap: "var(--erp-space-2)", flexWrap: "wrap", alignItems: "center" }}>
          <button className="cp-button" type="button" onClick={() => void createLink()} disabled={busy !== null || !canLink || !adminEmail}>
            {busy === "link" ? labels.creating : labels.copyLink}
          </button>
          <button
            className="cp-button cp-button-secondary"
            type="button"
            onClick={() => void reapply()}
            disabled={busy !== null}
            title={labels.reapplyHint}
          >
            {busy === "reapply" ? labels.reapplying : labels.reapply}
          </button>
          {!canLink ? <span className="cp-hint">{labels.notLinkableHint}</span> : null}
        </p>
      )}

      <dialog ref={dialog} className="cp-dialog" onClose={forget} aria-labelledby="admin-link-title">
        {link ? (
          <div>
            <h3 id="admin-link-title" className="cp-panel-title">
              {labels.dialogTitle[link.kind]}
            </h3>
            <p>{fill(labels.dialogIntro[link.kind], { email: link.email })}</p>
            <div style={{ display: "flex", gap: "var(--erp-space-2)", marginBottom: "var(--erp-space-3)" }}>
              <input
                ref={field}
                className="cp-input"
                readOnly
                value={link.link}
                aria-label={labels.dialogTitle[link.kind]}
                onFocus={(e) => e.currentTarget.select()}
                style={{ flex: 1, fontFamily: "var(--erp-font-mono)", fontSize: "var(--erp-text-xs)" }}
              />
              <button className="cp-button" type="button" onClick={() => void copy()}>
                {copied ? labels.copied : labels.copy}
              </button>
            </div>
            <p className="cp-muted">
              {fill(labels.validFor, {
                minutes: Math.round(link.validForSeconds / 60),
                time: new Date(link.expiresAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }),
              })}
            </p>
            <p className="cp-hint">{labels.closeHint}</p>
            <form method="dialog" style={{ marginTop: "var(--erp-space-3)", textAlign: "right" }}>
              <button className="cp-button cp-button-secondary" type="submit">
                {labels.close}
              </button>
            </form>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
