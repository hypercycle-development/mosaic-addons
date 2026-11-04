import React from "react";
import type { Node } from "./types";

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "good" | "bad" | "warn" | "neutral" }) {
  const c = {
    good: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    bad: "border-red-400/20 bg-red-400/10 text-red-300",
    warn: "border-amber-400/20 bg-amber-400/10 text-amber-300",
    neutral: "border-white/10 bg-white/5 text-slate-400",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${c}`}>{children}</span>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-white/10 bg-white/[.035] shadow-2xl shadow-black/10 backdrop-blur ${className}`}>{children}</section>;
}

export function Metric({ title, value, sub, icon: Icon, accent = "normal" }: { title: string; value: string; sub?: string; icon: React.ElementType; accent?: "normal" | "good" | "bad" | "warn" | "neutral" }) {
  const iconClass = accent === "good" ? "text-emerald-300 bg-emerald-400/10" : accent === "bad" ? "text-red-300 bg-red-400/10" : accent === "warn" ? "text-amber-300 bg-amber-400/10" : "text-sky-300 bg-sky-400/10";
  return <Card className="p-4"><div className="flex items-start justify-between"><div><div className="text-[10px] font-medium uppercase tracking-[.16em] text-slate-500">{title}</div><div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>{sub && <div className="mt-1 text-[10px] text-slate-500">{sub}</div>}</div><div className={`rounded-xl p-2.5 ${iconClass}`}><Icon size={17}/></div></div></Card>;
}

export function fmtDuration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return `${d ? `${d}d ` : ""}${h}h ${m}m`;
}

export function shortDate(value?: string | null, locale = "pt-PT") {
  return value ? new Date(value).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}

export function host(node: Node) { return `${node.apiHost}:${node.apiPort || (node.network === "BASE" ? "8010" : "8000")}`; }
export function maskNumber(value: unknown, hidden: boolean) { const text = String(value ?? ""); return hidden && text ? "••••••" : text; }

export function Info({ label, value }: { label: string; value: React.ReactNode }) { return <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2.5 text-[10px]"><span className="text-slate-600">{label}</span><span className="max-w-[65%] truncate text-right text-slate-300">{value}</span></div>; }
