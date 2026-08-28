"use client";

import React from "react";

interface KpiCardProps {
  label: string;
  value: string;
  sublabel?: string;
  icon: React.ReactNode;
  accent?: "blue" | "emerald" | "rose" | "amber" | "indigo" | "slate";
}

const accentStyles = {
  blue: "bg-[color:var(--app-accent-soft)] text-app-accent",
  emerald: "bg-[color:var(--app-success-soft)] text-[color:var(--app-success-text)]",
  rose: "bg-rose-500/10 text-rose-400",
  amber: "bg-amber-500/10 text-amber-400",
  indigo: "bg-[color:var(--app-accent-soft)] text-app-accent",
  slate: "bg-app-card-hover text-app-muted",
};

export default function KpiCard({
  label,
  value,
  sublabel,
  icon,
  accent = "blue",
}: KpiCardProps) {
  return (
    <div className="app-card app-card-elevated app-card-interactive relative overflow-hidden p-5">
      <div className="absolute inset-y-0 left-0 w-1 bg-[image:var(--app-gradient)]" />
      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-app-muted">{label}</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-app">{value}</p>
          {sublabel && <p className="mt-1 text-[11px] text-app-muted">{sublabel}</p>}
        </div>
        <div className={`rounded-xl p-2.5 ${accentStyles[accent]}`}>{icon}</div>
      </div>
    </div>
  );
}
