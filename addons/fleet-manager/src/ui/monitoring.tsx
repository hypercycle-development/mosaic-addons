import React from "react";

export const AUTO_INTERVALS = [
  { value: 60, label: "1 min" },
  { value: 300, label: "5 min" },
  { value: 600, label: "10 min" },
  { value: 1800, label: "30 min" },
  { value: 3600, label: "1 h" },
] as const;

export function AutoIntervalPicker({ value, onChange, language }: { value: number; onChange: (value: number) => void; language: "pt" | "en" }) {
  const custom = !AUTO_INTERVALS.some(x => x.value === value);
  const labels = language === "en" ? { title: "Monitoring interval", custom: "Custom", seconds: "seconds" } : { title: "Intervalo da monitorização", custom: "Personalizado", seconds: "segundos" };
  return <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={labels.title}>
    {AUTO_INTERVALS.map(option => <button key={option.value} type="button" aria-pressed={value === option.value}
      onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); onChange(option.value); } }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className={`cursor-pointer rounded-lg border px-2.5 py-2 text-[10px] transition ${value === option.value ? "border-sky-400/40 bg-sky-400/15 text-sky-200" : "border-white/10 bg-black/20 text-slate-400 hover:bg-white/5 hover:text-white"}`}>
      {option.label}
    </button>)}
    <button type="button" aria-pressed={custom} onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); onChange(custom ? value : 120); } }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      className={`cursor-pointer rounded-lg border px-2.5 py-2 text-[10px] transition ${custom ? "border-sky-400/40 bg-sky-400/15 text-sky-200" : "border-white/10 bg-black/20 text-slate-400 hover:bg-white/5 hover:text-white"}`}>
      {labels.custom}
    </button>
    {custom && <label className="flex items-center gap-1 text-[9px] text-slate-500"><input type="number" min={10} max={86400} step={10} value={value}
      onChange={e => onChange(Math.max(10, Math.min(86400, Number(e.target.value) || 10)))}
      className="w-24 cursor-text rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[10px] text-white outline-none focus:border-sky-400/40"/><span>{labels.seconds}</span></label>}
  </div>;
}

export function enabledLabel(enabled: boolean, language: "pt" | "en") { return enabled ? (language === "en" ? "ACTIVE" : "ATIVA") : (language === "en" ? "OFF" : "DESLIGADA"); }

export function MonitoringControl({ enabled, interval, onToggle, onInterval, onRunNow, countdown, runs, language }: {
  enabled: boolean; interval: number; onToggle: () => void; onInterval: (value: number) => void; onRunNow: () => void;
  countdown: string; runs: number; language: "pt" | "en";
}) {
  const labels = language === "en"
    ? { title: "Automatic monitoring", on: "MONITORING ACTIVE", off: "MONITORING OFF", next: "Next in", runs: "runs", now: "RUN NOW" }
    : { title: "Monitorização automática", on: "MONITORIZAÇÃO ATIVA", off: "MONITORIZAÇÃO DESLIGADA", next: "Próximo em", runs: "execuções", now: "EXECUTAR AGORA" };
  return <div className="rounded-xl border border-white/10 bg-black/20 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={enabled} aria-label={labels.title}
        onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); onToggle(); } }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-semibold select-none transition-colors duration-100 ${enabled ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-black/20 text-slate-400 hover:bg-white/5"}`}
        style={{ WebkitAppRegion: "no-drag", touchAction: "manipulation" } as React.CSSProperties}>
        <span className={`h-2 w-2 rounded-full ${enabled ? "bg-emerald-400" : "bg-slate-600"}`}/>
        <span>{enabled ? labels.on : labels.off}</span>
      </button>
      <AutoIntervalPicker value={interval} onChange={onInterval} language={language}/>
      {enabled && <button type="button" onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); onRunNow(); } }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} className="cursor-pointer select-none rounded-lg border border-emerald-400/20 px-2.5 py-2 text-[9px] text-emerald-300 hover:bg-emerald-400/10" style={{ WebkitAppRegion: "no-drag", touchAction: "manipulation" } as React.CSSProperties}>{labels.now}</button>}
      {enabled && countdown && <span className="rounded-lg bg-sky-400/10 px-2 py-1 text-[9px] text-sky-300">{labels.next} {countdown}</span>}
      <span className="text-[9px] text-slate-600">{runs} {labels.runs}</span>
    </div>
  </div>;
}

/**
 * Explains why the Tilling license-status query could not be answered.
 *
 * The endpoint is a plain-HTTP public API that sends no CORS headers, so a
 * renderer on the `mosaic-addon://` origin is blocked by the browser before
 * the request completes. That is a property of the service, not a
 * misconfiguration on the user's side — and it is different from "the
 * service answered and the license is unknown", which the UI must not
 * confuse with it.
 */
export function tillingFailureReason(tilling: { ok: boolean; error?: string; skipped?: boolean } | undefined): string | undefined {
  if (!tilling || tilling.ok) return undefined;
  if (tilling.skipped) return "Nenhum license configurado neste node.";
  const error = (tilling.error || "").toLowerCase();
  if (error.includes("failed to fetch") || error.includes("networkerror") || error.includes("load failed")) {
    return "A fonte Tilling não devolve cabeçalhos CORS, pelo que o browser bloqueia o pedido a partir do add-on. O valor só fica disponível se a fonte passar a permitir este origem.";
  }
  return tilling.error ? `A fonte Tilling respondeu com um erro: ${tilling.error}` : undefined;
}
