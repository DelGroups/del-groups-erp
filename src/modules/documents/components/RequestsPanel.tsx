"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/design-system/components";
import type { Formatter } from "@/views";
import { useChatterUsers } from "@/views/chatter/data";
import { checkRequest, folderLabel, type DocumentFolder, type DocumentRow, type RequestInput } from "../lib/documents";
import { searchPartners, useRequestActions, useRequests } from "../lib/data";

/**
 * File requests (phase 23): ask a colleague, or a customer / supplier (someone uploads for them),
 * for a file in the current folder by a date. Requests to me can be fulfilled with a document of
 * the current folder; the asker can cancel.
 */
export function RequestsPanel({ folder, folders, docs, fmt }: { folder: DocumentFolder | null; folders: readonly DocumentFolder[]; docs: readonly DocumentRow[]; fmt: Formatter }) {
  const { t } = fmt;
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { toast } = useToast();
  const requests = useRequests(true);
  const actions = useRequestActions(userId);
  const users = useChatterUsers(true);
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");
  const list = requests.data ?? [];
  const toMe = list.filter((r) => r.requested_user_id === userId && r.status === "pending");
  const mine = list.filter((r) => r.created_by === userId);
  const name = (id: string | null) => (id ? users.data?.find((u) => u.id === id)?.full_name || t("views.chatter.unnamedUser") : "—");
  const folderName = (id: string) => {
    const f = folders.find((x) => x.id === id);
    return f ? folderLabel(f, t) : "—";
  };

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="req-to-me" className="flex flex-col gap-2">
        <h3 id="req-to-me" className="ds-label">
          {t("library.requests.toMe")}
        </h3>
        {toMe.length ? (
          <ul className="flex flex-col gap-2">
            {toMe.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 rounded-[var(--ds-radius-md)] border p-2" style={{ borderColor: "var(--ds-border)" }}>
                <span className="font-medium">{r.title}</span>
                <span className="ds-muted text-[length:var(--ds-text-xs)]">{t("library.requests.askedBy", { name: name(r.created_by), folder: folderName(r.folder_id), date: r.due_date ?? "—" })}</span>
                {r.note ? <span className="whitespace-pre-wrap text-[length:var(--ds-text-xs)]">{r.note}</span> : null}
                {folder?.id === r.folder_id && docs.length ? (
                  <label className="flex items-center gap-2">
                    <span className="sr-only">{t("library.requests.pick")}</span>
                    <select className="ds-input h-8 flex-1" defaultValue="" onChange={(e) => e.target.value && actions.fulfil.mutate({ id: r.id, document_id: e.target.value }, { onSuccess: () => toast(t("library.requests.fulfilled"), r.title, "success"), onError: fail })}>
                      <option value="">{t("library.requests.pick")}</option>
                      {docs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="ds-subtle text-[length:var(--ds-text-xs)]">{t("library.requests.openFolder")}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ds-muted text-[length:var(--ds-text-xs)]">{t("library.requests.noneToMe")}</p>
        )}
      </section>

      <section aria-labelledby="req-mine" className="flex flex-col gap-2">
        <h3 id="req-mine" className="ds-label">
          {t("library.requests.mine")}
        </h3>
        {mine.length ? (
          <ul className="flex flex-col gap-1">
            {mine.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                {r.status === "done" ? <Check className="h-4 w-4 shrink-0" style={{ color: "var(--ds-success)" }} aria-hidden /> : <span className="h-4 w-4 shrink-0" aria-hidden />}
                <span className="min-w-0 flex-1 truncate" style={r.status === "cancelled" ? { textDecoration: "line-through", color: "var(--ds-text-subtle)" } : undefined}>
                  {`${r.title} (${r.partner_name || name(r.requested_user_id)}, ${t(`library.requests.status_${r.status}`)})`}
                </span>
                {r.status === "pending" ? (
                  <button type="button" className="ds-icon-btn h-7 w-7" aria-label={t("library.requests.cancel", { title: r.title })} onClick={() => actions.cancel.mutate(r.id, { onError: fail })}>
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ds-muted text-[length:var(--ds-text-xs)]">{t("library.requests.noneMine")}</p>
        )}
      </section>

      {folder && !folder.system_code ? <NewRequest folder={folder} fmt={fmt} /> : <p className="ds-subtle text-[length:var(--ds-text-xs)]">{t("library.requests.pickFolder")}</p>}
    </div>
  );
}

function NewRequest({ folder, fmt }: { folder: DocumentFolder; fmt: Formatter }) {
  const { t } = fmt;
  const { user } = useAuth();
  const { toast } = useToast();
  const users = useChatterUsers(true);
  const actions = useRequestActions(user?.id ?? null);
  const [input, setInput] = useState<RequestInput>({ title: "", note: "", due_date: "", requested_user_id: "", partner: null });
  const [partnerText, setPartnerText] = useState("");
  const [partners, setPartners] = useState<NonNullable<RequestInput["partner"]>[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!partnerText.trim()) return;
    let live = true;
    const timer = window.setTimeout(() => {
      searchPartners(partnerText).then(
        (rows) => live && setPartners(rows),
        () => live && setPartners([])
      );
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [partnerText]);

  return (
    <form
      className="flex flex-col gap-3 border-t pt-3"
      style={{ borderColor: "var(--ds-border)" }}
      onSubmit={(e) => {
        e.preventDefault();
        const checked = checkRequest(input);
        if (!checked.ok) {
          setError(t(checked.error));
          return;
        }
        setError(null);
        actions.create.mutate(
          { ...checked.value, folder_id: folder.id },
          {
            onSuccess: () => {
              setInput({ title: "", note: "", due_date: "", requested_user_id: "", partner: null });
              setPartnerText("");
              toast(t("library.requests.sent"), undefined, "success");
            },
            onError: (err) => setError(err instanceof Error ? err.message : t("common.error")),
          }
        );
      }}
    >
      <h3 className="ds-label">{t("library.requests.new", { folder: folderLabel(folder, t) })}</h3>
      <label className="flex flex-col gap-1" htmlFor="req-title">
        <span className="ds-label">{t("library.requests.title")}</span>
        <input id="req-title" className="ds-input" maxLength={200} value={input.title} placeholder={t("library.requests.titleHint")} onChange={(e) => setInput({ ...input, title: e.target.value })} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1" htmlFor="req-user">
          <span className="ds-label">{t("library.requests.fromColleague")}</span>
          <select id="req-user" className="ds-input" value={input.requested_user_id} onChange={(e) => setInput({ ...input, requested_user_id: e.target.value })}>
            <option value="">—</option>
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || t("views.chatter.unnamedUser")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1" htmlFor="req-due">
          <span className="ds-label">{t("library.requests.due")}</span>
          <input id="req-due" type="date" className="ds-input" value={input.due_date} onChange={(e) => setInput({ ...input, due_date: e.target.value })} />
        </label>
      </div>
      <label className="flex flex-col gap-1" htmlFor="req-partner">
        <span className="ds-label">{t("library.requests.fromPartner")}</span>
        <input id="req-partner" className="ds-input" value={input.partner ? input.partner.partner_name : partnerText} placeholder={t("library.requests.partnerHint")} onChange={(e) => {
          setInput({ ...input, partner: null });
          setPartnerText(e.target.value);
        }} />
      </label>
      {!input.partner && partnerText.trim() && partners.length ? (
        <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
          {partners.map((p) => (
            <li key={`${p.partner_model}:${p.partner_id}`}>
              <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost w-full justify-start" onClick={() => setInput({ ...input, partner: p })}>
                {`${p.partner_name || "—"} (${t(`views.chatter.models.${p.partner_model}`)})`}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="flex flex-col gap-1" htmlFor="req-note">
        <span className="ds-label">{t("library.requests.note")}</span>
        <textarea id="req-note" className="ds-input min-h-16 py-2" maxLength={2000} value={input.note} onChange={(e) => setInput({ ...input, note: e.target.value })} />
      </label>
      {error ? (
        <p role="alert" className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }}>
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={actions.create.isPending}>
          {t("library.requests.send")}
        </button>
      </div>
    </form>
  );
}
