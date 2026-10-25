"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { EmptyState, SkeletonList, useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { useFormatter, ViewScope } from "@/views";
import {
  deleteStageAction,
  deleteTargetAction,
  deleteTeamAction,
  reorderStagesAction,
  saveLostReasonAction,
  saveStageAction,
  saveTargetAction,
  saveTeamAction,
} from "../../actions/pipeline";
import { lostReasonLabel, stageKind, teamLabel, type CrmStage, type CrmTeam } from "../../lib/pipeline";
import { PIPELINE_SETTINGS_KEY } from "../../lib/pipelineData";
import { usePipeline } from "../../hooks/usePipeline";
import { pipelineError } from "./errors";

/** Settings of the new CRM (prompt 21, NEW_CRM): stages, teams, lost reasons and monthly targets. */
export function CrmConfigScreen() {
  return (
    <ViewScope>
      <Config />
    </ViewScope>
  );
}

type Result = { success: boolean; error?: string };

function Config() {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const pipeline = usePipeline();
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<Result>, done?: string) => {
    setBusy(true);
    const result = await work();
    setBusy(false);
    if (!result.success) {
      toast(t("crm.pipeline.actionFailed"), pipelineError(result.error, t), "error");
      return false;
    }
    if (done) toast(done, undefined, "success");
    await client.invalidateQueries({ queryKey: PIPELINE_SETTINGS_KEY });
    await client.invalidateQueries({ queryKey: ["views"] });
    return true;
  };

  if (!pipeline.ready) {
    if (pipeline.error) return <EmptyState icon={AlertTriangle} title={t("crm.pipeline.notReady")} description={t("crm.pipeline.notReadyHint")} />;
    return <SkeletonList loading rows={6} label={t("common.loading")}>{null}</SkeletonList>;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[length:var(--ds-text-xl)] font-semibold">{t("crm.pipeline.config.title")}</h1>
          <p className="ds-muted">{t("crm.pipeline.config.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/settings/crm" className="ds-btn ds-btn-sm ds-btn-ghost">{t("crm.pipeline.config.quoteSettings")}</Link>
          <Link href="/crm" className="ds-btn ds-btn-sm">{t("crm.pipeline.backToPipeline")}</Link>
        </div>
      </header>
      <StagesCard stages={pipeline.settings.stages} teams={pipeline.settings.teams} busy={busy} run={run} />
      <TeamsCard teams={pipeline.settings.teams} people={pipeline.salespeople} busy={busy} run={run} />
      <LostReasonsCard busy={busy} run={run} reasons={pipeline.settings.lostReasons} />
      <TargetsCard busy={busy} run={run} teams={pipeline.settings.teams} people={pipeline.salespeople} targets={pipeline.settings.targets} />
    </div>
  );
}

type Run = (work: () => Promise<Result>, done?: string) => Promise<boolean>;

function StagesCard({ stages, teams, busy, run }: { stages: readonly CrmStage[]; teams: readonly CrmTeam[]; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"open" | "won" | "lost">("open");
  const [teamId, setTeamId] = useState("");
  const [edits, setEdits] = useState<Record<string, Partial<CrmStage>>>({});

  const swap = (i: number, j: number) => {
    const ids = ordered.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run(() => reorderStagesAction(ids));
  };

  return (
    <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="crm-stages">
      <div>
        <h2 id="crm-stages" className="font-semibold">{t("crm.pipeline.config.stages")}</h2>
        <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("crm.pipeline.config.stagesHint")}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {ordered.map((s, i) => {
          const e = { ...s, ...edits[s.id] };
          const k = stageKind(e);
          const changed = !!edits[s.id];
          const team = s.team_id ? teams.find((x) => x.id === s.team_id) : null;
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-2 p-2" style={{ border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)" }}>
              <input type="color" value={e.color} onChange={(ev) => setEdits((p) => ({ ...p, [s.id]: { ...p[s.id], color: ev.target.value } }))} aria-label={t("crm.pipeline.config.color", { name: s.name })} className="h-8 w-8 cursor-pointer rounded" disabled={busy} />
              <input className="ds-input min-w-[10rem] flex-1" value={e.name} maxLength={60} onChange={(ev) => setEdits((p) => ({ ...p, [s.id]: { ...p[s.id], name: ev.target.value } }))} aria-label={t("crm.pipeline.config.stageName")} disabled={busy} />
              <span className="ds-chip ds-chip-flat">{t(`crm.pipeline.config.kind.${k}`)}</span>
              {k === "open" ? (
                <label className="flex items-center gap-1 text-[length:var(--ds-text-xs)]">
                  <input className="ds-input ds-mono w-20" type="number" min={0} max={100} step={1} value={e.probability} onChange={(ev) => setEdits((p) => ({ ...p, [s.id]: { ...p[s.id], probability: Number(ev.target.value) } }))} aria-label={t("crm.pipeline.fields.probability")} disabled={busy} />%
                </label>
              ) : null}
              <span className="text-[length:var(--ds-text-xs)] ds-subtle">{team ? teamLabel(team, t) : t("crm.pipeline.config.allTeams")}</span>
              <div className="ml-auto flex gap-1">
                <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" disabled={busy || i === 0} onClick={() => swap(i, i - 1)} aria-label={t("crm.pipeline.config.up", { name: s.name })}><ArrowUp className="h-4 w-4" aria-hidden /></button>
                <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" disabled={busy || i === ordered.length - 1} onClick={() => swap(i, i + 1)} aria-label={t("crm.pipeline.config.down", { name: s.name })}><ArrowDown className="h-4 w-4" aria-hidden /></button>
                {changed ? (
                  <button
                    type="button"
                    className="ds-btn ds-btn-sm ds-btn-primary"
                    disabled={busy || !e.name.trim()}
                    onClick={async () => {
                      if (await run(() => saveStageAction({ id: s.id, name: e.name, color: e.color, probability: e.probability, kind: k, folded: e.folded }), t("crm.pipeline.config.saved")))
                        setEdits((p) => {
                          const next = { ...p };
                          delete next[s.id];
                          return next;
                        });
                    }}
                  >
                    <Save className="h-4 w-4" aria-hidden />
                    {t("common.save")}
                  </button>
                ) : null}
                <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" disabled={busy} onClick={() => void run(() => deleteStageAction(s.id), t("crm.pipeline.config.stageDeleted"))} aria-label={t("crm.pipeline.config.delete", { name: s.name })}><Trash2 className="h-4 w-4" aria-hidden /></button>
              </div>
            </li>
          );
        })}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (await run(() => saveStageAction({ name, kind, teamId: teamId || null }), t("crm.pipeline.config.saved"))) setName("");
        }}
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="ds-label">{t("crm.pipeline.config.newStage")}</span>
          <input className="ds-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <select className="ds-input w-auto" value={kind} onChange={(e) => setKind(e.target.value as "open" | "won" | "lost")} aria-label={t("crm.pipeline.config.kindLabel")}>
          {(["open", "won", "lost"] as const).map((k) => <option key={k} value={k}>{t(`crm.pipeline.config.kind.${k}`)}</option>)}
        </select>
        {teams.length > 1 ? (
          <select className="ds-input w-auto" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label={t("crm.pipeline.fields.team")}>
            <option value="">{t("crm.pipeline.config.allTeams")}</option>
            {teams.map((tm) => <option key={tm.id} value={tm.id}>{teamLabel(tm, t)}</option>)}
          </select>
        ) : null}
        <button type="submit" className="ds-btn ds-btn-sm" disabled={busy || !name.trim()}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("crm.pipeline.config.add")}
        </button>
      </form>
    </section>
  );
}

function TeamsCard({ teams, people, busy, run }: { teams: readonly CrmTeam[]; people: readonly { id: string; full_name: string }[]; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [edits, setEdits] = useState<Record<string, { name?: string; leaderId?: string; memberIds?: string[] }>>({});
  return (
    <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="crm-teams">
      <div>
        <h2 id="crm-teams" className="font-semibold">{t("crm.pipeline.config.teams")}</h2>
        <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("crm.pipeline.config.teamsHint")}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {teams.map((tm) => {
          const e = edits[tm.id] ?? {};
          const members = e.memberIds ?? tm.member_ids;
          return (
            <li key={tm.id} className="flex flex-col gap-2 p-3" style={{ border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)" }}>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="ds-label">{t("crm.pipeline.config.teamName")}</span>
                  <input className="ds-input" value={e.name ?? tm.name ?? ""} placeholder={teamLabel(tm, t)} maxLength={80} onChange={(ev) => setEdits((p) => ({ ...p, [tm.id]: { ...p[tm.id], name: ev.target.value } }))} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="ds-label">{t("crm.pipeline.config.leader")}</span>
                  <select className="ds-input" value={e.leaderId ?? tm.leader_id ?? ""} onChange={(ev) => setEdits((p) => ({ ...p, [tm.id]: { ...p[tm.id], leaderId: ev.target.value } }))}>
                    <option value="">—</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </label>
              </div>
              <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                <legend className="ds-label mb-1">{t("crm.pipeline.config.members")}</legend>
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-[length:var(--ds-text-sm)]">
                    <input
                      type="checkbox"
                      checked={members.includes(p.id)}
                      onChange={(ev) => setEdits((prev) => ({ ...prev, [tm.id]: { ...prev[tm.id], memberIds: ev.target.checked ? [...members, p.id] : members.filter((m) => m !== p.id) } }))}
                    />
                    {p.full_name}
                  </label>
                ))}
              </fieldset>
              <div className="flex justify-end gap-2">
                {teams.length > 1 ? (
                  <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" disabled={busy} onClick={() => void run(() => deleteTeamAction(tm.id), t("crm.pipeline.config.teamDeleted"))}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                    {t("crm.pipeline.config.deleteTeam")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ds-btn ds-btn-sm ds-btn-primary"
                  disabled={busy || !edits[tm.id]}
                  onClick={async () => {
                    const ok = await run(() => saveTeamAction({ id: tm.id, name: e.name ?? tm.name ?? "", leaderId: e.leaderId ?? tm.leader_id, memberIds: members }), t("crm.pipeline.config.saved"));
                    if (ok)
                      setEdits((p) => {
                        const next = { ...p };
                        delete next[tm.id];
                        return next;
                      });
                  }}
                >
                  <Save className="h-4 w-4" aria-hidden />
                  {t("common.save")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (await run(() => saveTeamAction({ name }), t("crm.pipeline.config.saved"))) setName("");
        }}
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="ds-label">{t("crm.pipeline.config.newTeam")}</span>
          <input className="ds-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <button type="submit" className="ds-btn ds-btn-sm" disabled={busy || !name.trim()}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("crm.pipeline.config.add")}
        </button>
      </form>
    </section>
  );
}

function LostReasonsCard({ reasons, busy, run }: { reasons: readonly { id: string; code: string | null; name: string | null; active: boolean }[]; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  return (
    <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="crm-lost-reasons">
      <h2 id="crm-lost-reasons" className="font-semibold">{t("crm.pipeline.config.lostReasons")}</h2>
      <ul className="flex flex-col gap-1">
        {reasons.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <span className={r.active ? "" : "ds-subtle line-through"}>{lostReasonLabel(r, t)}</span>
            <label className="flex items-center gap-1.5 text-[length:var(--ds-text-xs)]">
              <input type="checkbox" checked={r.active} disabled={busy} onChange={(e) => void run(() => saveLostReasonAction({ id: r.id, name: r.name ?? "", active: e.target.checked }))} />
              {t("crm.pipeline.config.active")}
            </label>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (await run(() => saveLostReasonAction({ name }), t("crm.pipeline.config.saved"))) setName("");
        }}
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="ds-label">{t("crm.pipeline.config.newReason")}</span>
          <input className="ds-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <button type="submit" className="ds-btn ds-btn-sm" disabled={busy || !name.trim()}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("crm.pipeline.config.add")}
        </button>
      </form>
    </section>
  );
}

function TargetsCard({ teams, people, targets, busy, run }: { teams: readonly CrmTeam[]; people: readonly { id: string; full_name: string }[]; targets: readonly { id: string; team_id: string; user_id: string | null; month: string; amount: number }[]; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const names = new Map(people.map((p) => [p.id, p.full_name] as const));
  const money = (n: number) => `${new Intl.NumberFormat(fmt.locale, { maximumFractionDigits: 2 }).format(n)} ${t("common.currency")}`;
  return (
    <section className="ds-card ds-card-pad flex flex-col gap-3" aria-labelledby="crm-targets">
      <div>
        <h2 id="crm-targets" className="font-semibold">{t("crm.pipeline.config.targets")}</h2>
        <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("crm.pipeline.config.targetsHint")}</p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (await run(() => saveTargetAction({ teamId, userId: userId || null, month, amount: Number(amount) }), t("crm.pipeline.config.saved"))) setAmount("");
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="ds-label">{t("crm.pipeline.reports.month")}</span>
          <input className="ds-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="ds-label">{t("crm.pipeline.fields.team")}</span>
          <select className="ds-input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((tm) => <option key={tm.id} value={tm.id}>{teamLabel(tm, t)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="ds-label">{t("crm.pipeline.fields.salesperson")}</span>
          <select className="ds-input" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{t("crm.pipeline.config.wholeTeam")}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="ds-label">{t("crm.pipeline.config.amount")}</span>
          <input className="ds-input ds-mono" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <button type="submit" className="ds-btn ds-btn-sm" disabled={busy || !teamId || amount === ""}>
          <Save className="h-4 w-4" aria-hidden />
          {t("crm.pipeline.config.setTarget")}
        </button>
      </form>
      {targets.length ? (
        <table className="w-full border-collapse text-left text-[length:var(--ds-text-sm)]">
          <thead>
            <tr>
              <th scope="col" className="py-1 ds-label">{t("crm.pipeline.reports.month")}</th>
              <th scope="col" className="py-1 ds-label">{t("crm.pipeline.fields.team")}</th>
              <th scope="col" className="py-1 ds-label">{t("crm.pipeline.fields.salesperson")}</th>
              <th scope="col" className="py-1 text-right ds-label">{t("crm.pipeline.config.amount")}</th>
              <th scope="col"><span className="sr-only">{t("crm.pipeline.config.actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {targets.map((x) => (
              <tr key={x.id} style={{ borderTop: "1px solid var(--ds-border)" }}>
                <td className="py-1.5 ds-mono">{x.month.slice(0, 7)}</td>
                <td className="py-1.5">{teamLabel(teams.find((tm) => tm.id === x.team_id), t)}</td>
                <td className="py-1.5">{x.user_id ? names.get(x.user_id) ?? "—" : t("crm.pipeline.config.wholeTeam")}</td>
                <td className="py-1.5 text-right ds-mono">{money(x.amount)}</td>
                <td className="py-1.5 text-right">
                  <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" disabled={busy} onClick={() => void run(() => deleteTargetAction(x.id), t("crm.pipeline.config.targetDeleted"))} aria-label={t("crm.pipeline.config.deleteTarget")}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="ds-muted">{t("crm.pipeline.reports.noTargets")}</p>
      )}
    </section>
  );
}
