import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, ChevronRight, Clock3, Cpu,
  Database, ExternalLink, Gauge, HeartPulse, LayoutDashboard, Network, Pencil,
  Plus, RefreshCw, Search, Server, Settings2, ShieldCheck, Trash2, Wallet,
  XCircle, Zap, Wrench, TrendingUp as TrendingUpIcon,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import { api } from "./lib/api";
import type { AddonApi } from "./types/addonApi";
import type { FleetSources } from "./lib/types";
import { I18N, useLegacyUiLanguage } from "./i18n";
import { Badge, Card, Info, Metric, fmtDuration, host, maskNumber, shortDate } from "./ui/primitives";
import { MonitoringControl, enabledLabel, tillingFailureReason } from "./ui/monitoring";
import type { Node, Tab, TestResult } from "./ui/types";

const nav: { id: Tab; label: string; icon: React.ElementType; group?: string }[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "nodes", label: "Nodes", icon: Server },
  { id: "licenses", label: "Licenças & Factory", icon: ShieldCheck },
  { id: "aims", label: "AIM Manager", icon: Zap },
  { id: "tilling", label: "Performance & Tilling", icon: BarChart3 },
  { id: "diagnostics", label: "Diagnóstico", icon: Wrench },
  { id: "earnings", label: "Ganhos", icon: Wallet },
  { id: "alerts", label: "Alertas", icon: AlertTriangle },
  { id: "settings", label: "Configuração", icon: Settings2 },
];

const defaults: Partial<Node> = {
  name: "", apiHost: "127.0.0.1", apiPort: "8000", network: "TODA", senderAddress: "",
  aimPort: "9000", aimManagerPort: "8005", aimSlot: 0, aimPath: "/api/aim/0/request", tags: "", isActive: true,
  hasAdminPanel: false, licenseKey: "",
};

/**
 * Opens a URL in the user's browser, through the host.
 *
 * The host's `ui.openExternal` is the only sanctioned way for an add-on to
 * hand a user a link, and it is gated by the `shell:open-external`
 * permission.
 */
async function openExternal(url: string): Promise<void> {
  const addonAPI = (window as unknown as { addonAPI?: AddonApi }).addonAPI;
  if (!addonAPI?.ui?.openExternal) return;
  try {
    await addonAPI.ui.openExternal(url);
  } catch {
    /* the user declined, or the host refused — nothing to report */
  }
}

export function NodeManagerPage() {
  const uiRootRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [history, setHistory] = useState<any[]>([]);
  const [fleetHistory, setFleetHistory] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [heartbeat, setHeartbeat] = useState<any>(null);
  const [selectedId, setSelectedId] = useState("");
  const [compareNodeId, setCompareNodeId] = useState("");
  const [fleetSweepBusy, setFleetSweepBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [dashboardSection, setDashboardSection] = useState<"summary" | "intelligence" | "operations" | "health" | "history" | "explorer">(() => {
    try {
      const saved = localStorage.getItem("node-manager-dashboard-section");
      return saved && ["summary", "intelligence", "operations", "health", "history", "explorer"].includes(saved)
        ? saved as "summary" | "intelligence" | "operations" | "health" | "history" | "explorer"
        : "summary";
    } catch { return "summary"; }
  });
  useEffect(() => {
    try { localStorage.setItem("node-manager-dashboard-section", dashboardSection); } catch {}
  }, [dashboardSection]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [showEditor, setShowEditor] = useState(false);
  const [notice, setNotice] = useState("");
  const [shareExportBusy, setShareExportBusy] = useState(false);
  const [form, setForm] = useState<Partial<Node>>(defaults);
  const [sources, setSources] = useState<any>({});
  const [sourceStatus, setSourceStatus] = useState<Record<string, any>>({});
  const [sourceAuditBusy, setSourceAuditBusy] = useState(false);
  const [sourceAuditAt, setSourceAuditAt] = useState("");
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [tagFilter, setTagFilter] = useState("ALL");
  const [bulkTag, setBulkTag] = useState("");
  const [explorerLicense, setExplorerLicense] = useState("");
  const [explorerData, setExplorerData] = useState<any>(null);
  const [explorerBusy, setExplorerBusy] = useState(false);
  const [explorerError, setExplorerError] = useState("");
  const [explorerFleet, setExplorerFleet] = useState<Record<string, any>>({});
  const [explorerFleetBusy, setExplorerFleetBusy] = useState(false);
  const [sourceInspection, setSourceInspection] = useState<any>(null);
  const [sourceInspectionBusy, setSourceInspectionBusy] = useState(false);
  const [aimManagerInfo, setAimManagerInfo] = useState<any>(null);
  const [aimActionBusy, setAimActionBusy] = useState(false);
  const [aimActionResult, setAimActionResult] = useState<any>(null);
  const [aimDeployForm, setAimDeployForm] = useState({ name: "", tag: "", port: 9000 });
  const [aimSlotInput, setAimSlotInput] = useState(0);
  const [diagnostic, setDiagnostic] = useState<any>(null);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [fleetDiagnostics, setFleetDiagnostics] = useState<any[]>([]);
  const [fleetDiagnosticsBusy, setFleetDiagnosticsBusy] = useState(false);
  const [diagnosticFilter, setDiagnosticFilter] = useState<"ALL" | "PROBLEMS" | "HEALTHY">("ALL");
  const [autoDiagnostics, setAutoDiagnostics] = useState(() => localStorage.getItem("nodeManager.autoDiagnostics") === "1");
  const [autoDiagnosticInterval, setAutoDiagnosticInterval] = useState(() => Number(localStorage.getItem("nodeManager.autoDiagnosticInterval") || "60"));
  const [lastAutoDiagnosticAt, setLastAutoDiagnosticAt] = useState<string>(() => localStorage.getItem("nodeManager.lastAutoDiagnosticAt") || "");
  const [nextAutoDiagnosticAt, setNextAutoDiagnosticAt] = useState<string>("");
  const [autoDiagnosticRuns, setAutoDiagnosticRuns] = useState(() => Number(localStorage.getItem("nodeManager.autoDiagnosticRuns") || "0"));
  const [historyRange, setHistoryRange] = useState<"24H" | "7D" | "30D" | "ALL">("24H");
  const [uiLanguage, setUiLanguage] = useState<"pt" | "en">(() => (localStorage.getItem("nodeManager.language") as "pt" | "en") || "pt");
  const [hideNumbers, setHideNumbers] = useState(() => localStorage.getItem("nodeManager.hideNumbers") === "1");
  const autoNodesRef = useRef<Node[]>([]);
  const autoBusyRef = useRef(false);
  const intervalRef = useRef(autoDiagnosticInterval);
  const enabledRef = useRef(autoDiagnostics);
  const selectedIdRef = useRef(selectedId);
  const t = (key: string) => (I18N[uiLanguage] as Record<string, string>)[key] ?? (I18N.pt as Record<string, string>)[key] ?? key;
  const navLabel = (id: string, fallback: string) => { const map: Record<string,string> = { overview:"dashboard", nodes:"nodes", licenses:"licenses", aims:"aims", tilling:"tilling", diagnostics:"diagnostics", earnings:"earnings", alerts:"alerts", settings:"settings" }; return t(map[id] || "") || fallback; };
  const text = (pt: string, en: string) => uiLanguage === "pt" ? pt : en;
  const tx = text;
  useLegacyUiLanguage(uiRootRef, uiLanguage);
  useEffect(() => { localStorage.setItem("nodeManager.language", uiLanguage); localStorage.setItem("nodeManager.hideNumbers", hideNumbers ? "1" : "0"); localStorage.setItem("nodeManager.autoDiagnostics", autoDiagnostics ? "1" : "0"); localStorage.setItem("nodeManager.autoDiagnosticInterval", String(autoDiagnosticInterval)); }, [uiLanguage, hideNumbers, autoDiagnostics, autoDiagnosticInterval]);
  useEffect(() => { if (lastAutoDiagnosticAt) localStorage.setItem("nodeManager.lastAutoDiagnosticAt", lastAutoDiagnosticAt); }, [lastAutoDiagnosticAt]);
  useEffect(() => { localStorage.setItem("nodeManager.autoDiagnosticRuns", String(autoDiagnosticRuns)); }, [autoDiagnosticRuns]);

  const selected = nodes.find(n => n.id === selectedId) || nodes[0];

  const refreshAimManagerInfo = useCallback(async () => {
    if (!selected) { setAimManagerInfo(null); return; }
    try { setAimManagerInfo(await api.nodes.aimManagerInfo(selected)); } catch (e) { setAimManagerInfo({ error: e instanceof Error ? e.message : String(e) }); }
  }, [api, selected]);

  useEffect(() => { void refreshAimManagerInfo(); }, [refreshAimManagerInfo]);

  const runDiagnostic = async () => {
    if (!selected) return;
    setDiagnosticBusy(true);
    try { setDiagnostic(await api.nodes.diagnose(selected)); }
    catch (e) { setDiagnostic({ overall: "OFFLINE", checks: [], summary: { passed: 0, failed: 1, skipped: 0 }, error: e instanceof Error ? e.message : String(e) }); }
    finally { setDiagnosticBusy(false); }
  };

  const runFleetDiagnostics = async () => {
    setFleetDiagnosticsBusy(true);
    try { setFleetDiagnostics(await api.nodes.diagnoseFleet(nodes)); }
    catch { setFleetDiagnostics([]); }
    finally { setFleetDiagnosticsBusy(false); }
  };

  const runInterventionSweep = async () => {
    const targets = diagnosticCommandQueue.map(x => x.n).filter(Boolean) as Node[];
    if (!targets.length || fleetDiagnosticsBusy) return;
    setFleetDiagnosticsBusy(true);
    try {
      const rows = await api.nodes.diagnoseFleet(targets);
      const byId = new Map(rows.map((r: any) => [r.nodeId, r]));
      setFleetDiagnostics(prev => prev.map((r: any) => byId.get(r.nodeId) || r));
      const selectedRow = rows.find((r: any) => r.nodeId === selectedIdRef.current);
      if (selectedRow) setDiagnostic(selectedRow);
    } catch {
      // Best effort: keep the existing observed diagnostics if the sweep fails.
    } finally {
      setFleetDiagnosticsBusy(false);
    }
  };

  useEffect(() => { autoNodesRef.current = nodes; }, [nodes]);

  const filteredFleetDiagnostics = useMemo(() => {
    if (diagnosticFilter === "PROBLEMS") return fleetDiagnostics.filter((d: any) => d.overall !== "HEALTHY");
    if (diagnosticFilter === "HEALTHY") return fleetDiagnostics.filter((d: any) => d.overall === "HEALTHY");
    return fleetDiagnostics;
  }, [fleetDiagnostics, diagnosticFilter]);

  const diagnosticAnalytics = useMemo(() => {
    // These are the keys the diagnostics actually produce. The list used to
    // name `health`, `info`, `nonce`, `balance` and `aimCost`, which are the
    // keys of the *node test* result, not of a diagnostic check — so every
    // lookup missed and the coverage and reliability figures were always
    // zero.
    const keys = ["node-info", "node-health", "aim-manager", "aim-service", "admin-panel"];
    const stats = keys.map(key => {
      let ok = 0, failed = 0, skipped = 0, latency = 0;
      for (const d of fleetDiagnostics) {
        const c = (d.checks || []).find((x: any) => x.key === key);
        if (!c) continue;
        if (c.skipped) skipped++;
        else if (c.ok) { ok++; if (typeof c.latencyMs === "number") latency += c.latencyMs; }
        else failed++;
      }
      return { key, ok, failed, skipped, samples: ok + failed + skipped, avgLatency: ok ? Math.round(latency / ok) : null };
    });
    const total = stats.reduce((a, x) => a + x.ok + x.failed, 0);
    const passed = stats.reduce((a, x) => a + x.ok, 0);
    const failed = stats.reduce((a, x) => a + x.failed, 0);
    const skipped = stats.reduce((a, x) => a + x.skipped, 0);
    const endpointReliability = stats.map(x => ({
      ...x,
      reliability: (x.ok + x.failed) ? Math.round(x.ok / (x.ok + x.failed) * 100) : null
    })).sort((a, b) => (a.reliability ?? -1) - (b.reliability ?? -1));
    return { stats, endpointReliability, total, passed, failed, skipped, coverage: total ? Math.round(passed / total * 100) : 0 };
  }, [fleetDiagnostics]);

  const diagnosticCommandQueue = useMemo(() => {
    return fleetDiagnostics
      .map((d: any) => {
        const n = nodes.find(x => x.id === d.nodeId);
        const failed = Number(d.summary?.failed || 0);
        const skipped = Number(d.summary?.skipped || 0);
        const latency = typeof d.totalLatencyMs === "number" ? d.totalLatencyMs : null;
        const priority = d.overall !== "HEALTHY" ? "CRITICAL" : failed > 0 || (latency != null && latency > 1000) ? "ATTENTION" : skipped > 0 ? "CHECK" : "OK";
        const reason = d.overall !== "HEALTHY" ? (d.overall === "DEGRADED" ? "Estado degradado" : "Node indisponível") : failed > 0 ? `${failed} falha(s) observada(s)` : latency != null && latency > 1000 ? "Latência elevada observada" : skipped > 0 ? `${skipped} endpoint(s) ignorado(s)` : "Sem anomalia observada";
        return { d, n, priority, reason, failed, skipped, latency };
      })
      .filter(x => x.priority !== "OK")
      .sort((a, b) => (a.priority === "CRITICAL" ? 0 : 1) - (b.priority === "CRITICAL" ? 0 : 1) || b.failed - a.failed || (b.latency ?? -1) - (a.latency ?? -1))
      .slice(0, 12);
  }, [fleetDiagnostics, nodes]);

  const runAutoDiagnostics = useCallback(async () => {
    const active = autoNodesRef.current.filter(n => n.isActive !== false);
    if (!active.length || autoBusyRef.current) return false;
    autoBusyRef.current = true;
    setFleetDiagnosticsBusy(true);
    try {
      const rows = await api.nodes.diagnoseFleet(active);
      setFleetDiagnostics(rows);
      const now = new Date().toISOString();
      setLastAutoDiagnosticAt(now);
      setNextAutoDiagnosticAt(new Date(Date.now() + Math.max(10, intervalRef.current) * 1000).toISOString());
      setAutoDiagnosticRuns(v => v + 1);
      const selectedRow = rows.find((r: any) => r.nodeId === selectedIdRef.current);
      if (selectedRow) setDiagnostic(selectedRow);
      return true;
    } catch {
      return false;
    } finally {
      autoBusyRef.current = false;
      setFleetDiagnosticsBusy(false);
    }
  }, [api]);

  // V39: stable scheduler. Changing the interval only changes the next deadline;
  // it never triggers an immediate network call. This keeps controls responsive.
  const activeNodeKey = nodes.filter(n => n.isActive !== false).map(n => n.id).join(",");
  useEffect(() => { intervalRef.current = autoDiagnosticInterval; }, [autoDiagnosticInterval]);
  useEffect(() => { enabledRef.current = autoDiagnostics; }, [autoDiagnostics]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    if (!autoDiagnostics || !activeNodeKey) { setNextAutoDiagnosticAt(""); return; }
    let cancelled=false; let timer:number|undefined;
    const schedule=()=>{ if(cancelled || !enabledRef.current) return; const delay=Math.max(10,intervalRef.current)*1000; setNextAutoDiagnosticAt(new Date(Date.now()+delay).toISOString()); timer=window.setTimeout(async()=>{ if(cancelled || !enabledRef.current) return; await runAutoDiagnostics(); schedule(); },delay); };
    void runAutoDiagnostics().then(schedule);
    return()=>{cancelled=true; if(timer) window.clearTimeout(timer);};
  },[autoDiagnostics,activeNodeKey,runAutoDiagnostics]);

  const [autoCountdownNow, setAutoCountdownNow] = useState(() => Date.now());
  useEffect(() => {
    if (!autoDiagnostics || !nextAutoDiagnosticAt) return;
    const timer = window.setInterval(() => setAutoCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [autoDiagnostics, nextAutoDiagnosticAt]);

  const autoCountdownSeconds = nextAutoDiagnosticAt
    ? Math.max(0, Math.ceil((Date.parse(nextAutoDiagnosticAt) - autoCountdownNow) / 1000))
    : 0;
  const autoCountdownLabel = autoCountdownSeconds >= 60
    ? `${Math.floor(autoCountdownSeconds / 60)}m ${autoCountdownSeconds % 60}s`
    : `${autoCountdownSeconds}s`;

  // The original wrote the sanitised export to a file in the main process. An
  // add-on renderer has no filesystem, so the export is handed to the user as
  // a download instead — the content is identical, and it still carries no
  // license, sender address, hostname or probe payload.
  const exportSanitizedShare = async () => {
    setShareExportBusy(true);
    try {
      const result = await api.nodes.exportSanitized();
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `fleet-manager-demo-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(
        uiLanguage === "en"
          ? "Safe demo profile exported."
          : "Perfil demo seguro exportado.",
      );
    } catch (e) {
      setNotice(
        uiLanguage === "en"
          ? `Safe export failed: ${e instanceof Error ? e.message : String(e)}`
          : `Exportação segura falhou: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally { setShareExportBusy(false); }
  };

  const runAimPreflight = async () => {
    if (!selected) { setNotice(t("noSelectedNode")); return; }
    setAimActionBusy(true);
    try {
      const result = await api.nodes.diagnose(selected);
      setDiagnostic(result);
      const checks = Array.isArray(result?.checks) ? result.checks : [];
      const nodeOk = checks.some((x:any) => x.key === "node-info" && x.ok) || checks.some((x:any) => x.key === "node-health" && x.ok);
      const manager = checks.find((x:any) => x.key === "aim-manager");
      const service = checks.find((x:any) => x.key === "aim-service");
      setNotice(`AIM preflight: Node ${nodeOk ? "OK" : "OFFLINE"} · Manager ${manager?.ok ? "OK" : "FALHA"} · AIM service ${service?.ok ? "OK" : "FALHA"}`);
    } catch (e) { setNotice(`AIM preflight: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setAimActionBusy(false); }
  };

  const runAimAction = async (action: "deploy" | "remove" | "retry") => {
    if (!selected) return;
    setAimActionBusy(true); setAimActionResult(null);
    try {
      const result = action === "deploy"
        ? await api.nodes.aimDeploy(selected, aimDeployForm)
        : action === "remove"
          ? await api.nodes.aimRemove(selected, Number(aimSlotInput))
          : await api.nodes.aimRetry(selected, Number(aimSlotInput));
      setAimActionResult(result);
      setNotice(result?.ok ? `AIM Manager: ${action} concluído.` : `AIM Manager: operação falhou.`);
    } catch (e) { setAimActionResult({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
    finally { setAimActionBusy(false); }
  };

  const refresh = useCallback(async () => {
    const ns = await api.nodes.get();
    setNodes(ns);
    if (!selectedId && ns[0]) setSelectedId(ns[0].id);
    try {
      setAnalytics(await api.nodes.analytics());
      setFleetHistory(await api.nodes.fleetHistory(1500));
      setAlerts(await api.nodes.alerts(undefined, 100));
      setSources(await api.nodes.sourcesGet());
    } catch { /* keep UI usable if one optional source fails */ }
  }, [api, selectedId]);

  useEffect(() => {
    void refresh();
    const off = api.nodes.onChanged(() => void refresh());
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { off(); window.clearInterval(timer); };
  }, [refresh, api]);

  useEffect(() => {
    if (selected?.licenseKey && !explorerLicense) setExplorerLicense(String(selected.licenseKey));
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) return;
    void api.nodes.history(selected.id, 300).then(setHistory).catch(() => setHistory([]));
    void api.nodes.heartbeat(selected.id).then(setHeartbeat).catch(() => setHeartbeat(null));
  }, [selected?.id, api]);

  const test = useCallback(async (node: Node) => {
    setBusy(b => ({ ...b, [node.id]: true }));
    try {
      const r = await api.nodes.test(node);
      setResults(x => ({ ...x, [node.id]: r }));
      if (node.id === selected?.id) {
        setHistory(await api.nodes.history(node.id, 300));
        setHeartbeat(await api.nodes.heartbeat(node.id));
      }
      setAlerts(await api.nodes.alerts(undefined, 100));
      setAnalytics(await api.nodes.analytics());
      setFleetHistory(await api.nodes.fleetHistory(1500));
      setNotice(`${node.name}: ${r.alive ? "ALIVE" : "DEAD"} · ${r.totalLatencyMs} ms`);
    } catch (e) { setNotice(String(e)); }
    finally { setBusy(b => ({ ...b, [node.id]: false })); }
  }, [api, selected?.id]);

  const testAll = async () => {
    const active = nodes.filter(n => n.isActive !== false);
    setNotice(`A testar ${active.length} nodes…`);
    const rs = await api.nodes.testAll(active);
    const map: Record<string, TestResult> = {};
    rs.forEach((r: TestResult) => { map[r.nodeId] = r; });
    setResults(map);
    if (selected) { setHistory(await api.nodes.history(selected.id, 300)); setHeartbeat(await api.nodes.heartbeat(selected.id)); }
    setAnalytics(await api.nodes.analytics());
    setFleetHistory(await api.nodes.fleetHistory(1500));
    setAlerts(await api.nodes.alerts(undefined, 100));
    setNotice(`Teste concluído · ${rs.filter(r => r.alive).length}/${rs.length} ALIVE`);
  };

  const refreshExplorerFleet = useCallback(async () => {
    const licenses = nodes.map(n => String(n.licenseKey || '').trim()).filter(Boolean);
    if (!licenses.length) { setNotice("Não existem licenças configuradas."); return; }
    setExplorerFleetBusy(true);
    setExplorerError("");
    try {
      const rows = await api.nodes.explorerFleet(licenses);
      const map: Record<string, any> = {};
      rows.forEach((r: any) => { map[r.license] = r.data || { error: r.error }; });
      setExplorerFleet(map);
      // Keep the selected license visible immediately in the Node Manager.
      const selectedLicense = String(selected?.licenseKey || explorerLicense || '').trim();
      if (selectedLicense && map[selectedLicense] && !map[selectedLicense].error) {
        setExplorerLicense(selectedLicense);
        setExplorerData(map[selectedLicense]);
      }
      const ok = rows.filter((r: any) => r.data).length;
      const failed = rows.filter((r: any) => !r.data);
      setNotice(`Explorer atualizado · ${ok}/${rows.length} licenças${failed.length ? ` · ${failed.length} sem resposta` : ''}`);
    } catch (e) { setExplorerError(e instanceof Error ? e.message : String(e)); }
    finally { setExplorerFleetBusy(false); }
  }, [api, nodes]);

  const auditDataSources = async () => {
    setSourceAuditBusy(true);
    const kinds = ["explorerUrl", "licensesUrl", "tillingUrl", "earningsUrl"] as const;
    const next: Record<string, any> = {};
    try {
      for (const kind of kinds) {
        const url = String(sources[kind] || "").trim();
        if (!url) { next[kind] = { ok: false, skipped: true, reason: "Fonte não configurada" }; continue; }
        try { next[kind] = await api.nodes.sourceRead(kind); }
        catch (e) { next[kind] = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
      }
      setSourceStatus(prev => ({ ...prev, ...next }));
      setSourceAuditAt(new Date().toISOString());
      const ok = kinds.filter(k => next[k]?.ok).length;
      setNotice(`Auditoria de fontes concluída · ${ok}/${kinds.length} fontes com resposta`);
    } finally { setSourceAuditBusy(false); }
  };

  // The node registry belongs to the Mosaic application and the add-on API
  // exposes it read-only (nodes:read). Adding, editing and removing a node is
  // therefore done in Mosaic's own settings, not here — the editor explains
  // that instead of pretending to save.
  const saveNode = async () => {
    setNotice(
      uiLanguage === "en"
        ? "The node registry is managed by Mosaic. Edit nodes in Mosaic's node settings, then refresh."
        : "O registo de nodes é gerido pelo Mosaic. Edite os nodes nas definições de nodes do Mosaic e depois atualize.",
    );
    setShowEditor(false);
    await refresh();
  };

  const remove = async (node: Node) => {
    setNotice(
      uiLanguage === "en"
        ? `Remove "${node.name}" from Mosaic's node settings — this add-on only reads the registry.`
        : `Remova "${node.name}" nas definições de nodes do Mosaic — este add-on apenas lê o registo.`,
    );
    await refresh();
  };

  const stat = analytics || { total: nodes.length, active: nodes.filter(n => n.isActive !== false).length, alive: 0, dead: 0, untested: nodes.length, avgLatencyMs: null };
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    nodes.forEach(n => (n.tags || "").split(",").map(x => x.trim()).filter(Boolean).forEach(x => set.add(x)));
    return Array.from(set).sort((a,b) => a.localeCompare(b));
  }, [nodes]);
  const filtered = useMemo(() => nodes.filter(n => {
    const hay = `${n.name} ${n.apiHost} ${n.tags || ""} ${n.licenseKey || ""}`.toLowerCase();
    const searchOk = !filter || hay.includes(filter.toLowerCase());
    const statusOk = statusFilter === "ALL" || (statusFilter === "ACTIVE" && n.isActive !== false) || (statusFilter === "ALIVE" && results[n.id]?.alive) || (statusFilter === "DEAD" && results[n.id] && !results[n.id]?.alive);
    const tagOk = tagFilter === "ALL" || (n.tags || "").split(",").map(x => x.trim()).includes(tagFilter);
    return searchOk && statusOk && tagOk;
  }), [nodes, filter, statusFilter, tagFilter, results]);
  useEffect(() => { setSelectedNodeIds(ids => ids.filter(id => nodes.some(n => n.id === id))); }, [nodes]);
  const toggleNodeSelection = (id: string) => setSelectedNodeIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const selectVisibleNodes = () => setSelectedNodeIds(ids => Array.from(new Set([...ids, ...filtered.map(n => n.id)])));
  const clearNodeSelection = () => setSelectedNodeIds([]);
  const runBulk = async (chosen: Node[], worker: (node: Node) => Promise<void>, doneMessage: string) => {
    if (!chosen.length || bulkBusy) return;
    setBulkBusy(true); setBulkProgress({ done: 0, total: chosen.length });
    try {
      const queue = [...chosen];
      const concurrency = Math.min(12, Math.max(1, chosen.length));
      const workers = Array.from({ length: concurrency }, async () => {
        while (queue.length) {
          const node = queue.shift();
          if (!node) return;
          try { await worker(node); } catch { /* continue fleet operation */ }
          setBulkProgress(p => ({ ...p, done: Math.min(p.done + 1, p.total) }));
        }
      });
      await Promise.all(workers);
      await refresh();
      setNotice(doneMessage);
    } finally {
      setBulkBusy(false);
    }
  };
  const bulkTestSelected = async () => {
    const chosen = nodes.filter(n => selectedNodeIds.includes(n.id)); if (!chosen.length || bulkBusy) return;
    setBulkBusy(true); setBulkProgress({ done: 0, total: chosen.length });
    setNotice(text(`A testar ${chosen.length} node(s)…`, `Testing ${chosen.length} node(s)…`));
    try {
      const result = await api.nodes.testAll(chosen);
      setResults(prev => { const next = { ...prev }; for (const r of result as TestResult[]) next[r.nodeId] = r; return next; });
      await refresh();
      setBulkProgress({ done: chosen.length, total: chosen.length });
      setNotice(text(`${chosen.length} node(s) testado(s).`, `${chosen.length} node(s) tested.`));
    } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
    finally { setBulkBusy(false); }
  };
  const bulkSetActive = async (active: boolean) => {
    const chosen = nodes.filter(n => selectedNodeIds.includes(n.id)); if (!chosen.length) return;
    setNotice(
      uiLanguage === "en"
        ? "Enable or disable nodes in Mosaic's node settings — this add-on only reads the registry."
        : "Ative ou desative nodes nas definições de nodes do Mosaic — este add-on apenas lê o registo.",
    );
  };
  const bulkApplyTag = async () => {
    const tag = bulkTag.trim(); const chosen = nodes.filter(n => selectedNodeIds.includes(n.id)); if (!tag || !chosen.length) return;
    setNotice(
      uiLanguage === "en"
        ? "Tags are managed in Mosaic's node settings — this add-on only reads the registry."
        : "As tags são geridas nas definições de nodes do Mosaic — este add-on apenas lê o registo.",
    );
    setBulkTag("");
  };
  const historyWindow = useMemo(() => {
    if (!history.length) return [];
    if (historyRange === "ALL") return history;
    const hours = historyRange === "24H" ? 24 : historyRange === "7D" ? 168 : 720;
    const cutoff = Date.now() - hours * 3600_000;
    return history.filter(h => Date.parse(h.testedAt) >= cutoff);
  }, [history, historyRange]);
  const chart = historyWindow.map(h => ({
    time: new Date(h.testedAt).toLocaleString(uiLanguage === "en" ? "en-US" : "pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    latency: h.totalLatencyMs, health: h.alive ? 100 : 0, status: h.alive ? 1 : 0,
  })).slice(-120);
  const rangeLabel = historyRange === "24H" ? "24 horas" : historyRange === "7D" ? "7 dias" : historyRange === "30D" ? "30 dias" : "todo o histórico";
  const fleetWindow = useMemo(() => {
    const cutoff = historyRange === "ALL" ? 0 : Date.now() - (historyRange === "24H" ? 24 : historyRange === "7D" ? 168 : 720) * 3600_000;
    return fleetHistory.filter(h => !cutoff || Date.parse(h.testedAt) >= cutoff);
  }, [fleetHistory, historyRange]);
  const fleetTimeline = useMemo(() => {
    const buckets = new Map<number, { ts:number; alive:Set<string>; dead:Set<string>; latency:number[] }>();
    for (const h of fleetWindow) { const ts = Math.floor(Date.parse(h.testedAt) / 60000) * 60000; if (!Number.isFinite(ts)) continue; let b=buckets.get(ts); if(!b){b={ts,alive:new Set(),dead:new Set(),latency:[]}; buckets.set(ts,b);} if(h.alive) b.alive.add(h.nodeId); else b.dead.add(h.nodeId); if(typeof h.totalLatencyMs === "number") b.latency.push(h.totalLatencyMs); }
    return [...buckets.values()].sort((a,b)=>a.ts-b.ts).map(b=>({ time:new Date(b.ts).toLocaleTimeString(uiLanguage === "en" ? "en-US" : "pt-PT",{hour:"2-digit",minute:"2-digit"}), alive:b.alive.size, dead:b.dead.size, latency:b.latency.length?Math.round(b.latency.reduce((a,x)=>a+x,0)/b.latency.length):null }));
  }, [fleetWindow]);
  const fleetIntelligence = useMemo(() => {
    const active = nodes.filter(n => n.isActive !== false);
    if (!fleetWindow.length) return { current: null, previous: null, trend: [], degrading: [], improving: [], stable: active.map(n => n.id), failures: 0, recoveries: 0, attention: [] as any[] };
    const end = Math.max(...fleetWindow.map(h => Date.parse(h.testedAt)).filter(Number.isFinite));
    const spanHours = historyRange === "24H" ? 12 : historyRange === "7D" ? 84 : historyRange === "30D" ? 360 : Math.max(1, (end - Math.min(...fleetWindow.map(h => Date.parse(h.testedAt)).filter(Number.isFinite))) / 3600000 / 2);
    const mid = end - spanHours * 3600000;
    const currentRows = fleetWindow.filter(h => Date.parse(h.testedAt) >= mid);
    const previousRows = fleetWindow.filter(h => Date.parse(h.testedAt) < mid);
    const summary = (rows:any[]) => {
      const by = new Map<string, any[]>(); rows.forEach(h => { const a=by.get(h.nodeId)||[]; a.push(h); by.set(h.nodeId,a); });
      const vals=[...by.entries()].map(([nodeId,rs])=>({ nodeId, uptime: rs.length ? rs.filter(x=>x.alive).length/rs.length*100 : null, latency: rs.map(x=>x.totalLatencyMs).filter(Number.isFinite).length ? rs.map(x=>x.totalLatencyMs).filter(Number.isFinite).reduce((a,b)=>a+b,0)/rs.map(x=>x.totalLatencyMs).filter(Number.isFinite).length : null, last: rs.slice().sort((a,b)=>Date.parse(a.testedAt)-Date.parse(b.testedAt)).at(-1) }));
      return vals;
    };
    const cur=summary(currentRows), prev=summary(previousRows);
    const pm=new Map(prev.map(x=>[x.nodeId,x]));
    const trend=cur.map(x=>{ const p=pm.get(x.nodeId); const delta=p&&x.uptime!=null&&p.uptime!=null?x.uptime-p.uptime:null; const latencyDelta=p&&x.latency!=null&&p.latency!=null?x.latency-p.latency:null; const direction=delta!=null ? (delta<=-10?"DEGRADING":delta>=10?"IMPROVING":"STABLE") : latencyDelta!=null ? (latencyDelta>200?"DEGRADING":latencyDelta<-200?"IMPROVING":"STABLE") : "STABLE"; return {...x, previous:p, delta, latencyDelta, direction}; });
    const degrading=trend.filter(x=>x.direction==="DEGRADING"); const improving=trend.filter(x=>x.direction==="IMPROVING"); const stable=trend.filter(x=>x.direction==="STABLE");
    const ordered=[...fleetWindow].filter(h=>Number.isFinite(Date.parse(h.testedAt))).sort((a,b)=>Date.parse(a.testedAt)-Date.parse(b.testedAt));
    const transitions=new Map<string,{failures:number;recoveries:number;tests:number;dead:number}>();
    const lastByNode=new Map<string,boolean>();
    ordered.forEach(h=>{ const z=transitions.get(h.nodeId)||{failures:0,recoveries:0,tests:0,dead:0}; z.tests++; if(!h.alive) z.dead++; const prev=lastByNode.get(h.nodeId); if(prev===true && h.alive===false) z.failures++; if(prev===false && h.alive===true) z.recoveries++; lastByNode.set(h.nodeId,!!h.alive); transitions.set(h.nodeId,z); });
    const failures=[...transitions.values()].reduce((a,x)=>a+x.failures,0);
    const recoveries=[...transitions.values()].reduce((a,x)=>a+x.recoveries,0);
    const patterns=trend.map(x=>{const z=transitions.get(x.nodeId)||{failures:0,recoveries:0,tests:0,dead:0}; return {...x, failures:z.failures,recoveries:z.recoveries, deadRate:z.tests?z.dead/z.tests*100:0, stability:z.tests?100-(z.dead/z.tests*100):null};}).sort((a,b)=>(b.failures-a.failures)||(b.deadRate-a.deadRate));
    const attention=patterns.filter(x=>x.direction==="DEGRADING" || x.last?.alive===false || (x.latency!=null && x.latency>1000) || x.failures>0).sort((a,b)=>(b.failures-a.failures)||((a.delta??0)-(b.delta??0))).slice(0,12);
    const buckets=new Map<number,{ts:number;alive:number;dead:number;latency:number[]}>();
    currentRows.forEach(h=>{const ts=Math.floor(Date.parse(h.testedAt)/3600000)*3600000; if(!Number.isFinite(ts)) return; const b=buckets.get(ts)||{ts,alive:0,dead:0,latency:[]}; h.alive?b.alive++:b.dead++; if(Number.isFinite(h.totalLatencyMs)) b.latency.push(h.totalLatencyMs); buckets.set(ts,b);});
    const chart=[...buckets.values()].sort((a,b)=>a.ts-b.ts).map(b=>({time:new Date(b.ts).toLocaleString(uiLanguage === "en" ? "en-US":"pt-PT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}), alive:b.alive, dead:b.dead, latency:b.latency.length?Math.round(b.latency.reduce((a,x)=>a+x,0)/b.latency.length):null})).slice(-48);
    return {current:cur,previous:prev,trend,degrading,improving,stable,failures,recoveries,attention,patterns,chart};
  }, [fleetWindow, nodes, historyRange, uiLanguage]);
  const fleetChart = [{ name: "ALIVE", value: stat.alive }, { name: "DEAD", value: stat.dead }, { name: "Sem teste", value: stat.untested }];
  const pieTotal = fleetChart.reduce((a, b) => a + b.value, 0);
  const fleetInsights = useMemo(() => {
    const active = nodes.filter(n => n.isActive !== false);
    const tested = active.map(n => results[n.id]).filter(Boolean) as TestResult[];
    const latencies = tested.map(r => r.totalLatencyMs).filter(Number.isFinite);
    const worst = tested.slice().sort((a,b) => b.totalLatencyMs - a.totalLatencyMs)[0];
    const toda = active.filter(n => (n.network || "TODA") === "TODA").length;
    const base = active.filter(n => n.network === "BASE").length;
    return { active: active.length, tested: tested.length, responseRate: active.length ? Math.round(tested.length / active.length * 100) : 0, avgLatency: latencies.length ? Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length) : null, worst, toda, base };
  }, [nodes, results]);
  const openAdd = () => { setForm({ ...defaults }); setShowEditor(true); };
  const openEdit = () => { if (selected) { setForm({ ...selected }); setShowEditor(true); } };

  const selectTab = (next: Tab, event?: React.SyntheticEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    setTab(next);
  };

  const Sidebar = () => <aside className="relative z-30 hidden w-60 shrink-0 border-r border-white/10 bg-black/20 p-3 lg:block">
    <div className="flex h-full flex-col">
      <div className="mb-5 flex items-center gap-3 px-2 py-2"><div className="rounded-xl bg-gradient-to-br from-sky-400/20 to-indigo-500/10 p-2.5 text-sky-300"><Network size={19}/></div><div><div className="text-sm font-semibold">Node Manager</div><div className="text-[9px] uppercase tracking-[.18em] text-slate-600">{t("fleetControl")}</div></div></div>
      <nav className="space-y-1 pointer-events-auto">{nav.map(item => { const Icon = item.icon; const active = tab === item.id; const alertCount = item.id === "alerts" ? alerts.filter(a => !a.acknowledged).length : 0; return <button type="button" key={item.id} onMouseDown={(e) => selectTab(item.id, e)} onClick={(e) => selectTab(item.id, e)} className={`relative z-40 flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition ${active ? "bg-white text-black shadow-lg" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}><Icon size={15}/><span className="flex-1">{({overview:t("dashboard"),nodes:t("nodes"),licenses:t("licenses"),aims:t("aims"),tilling:t("tilling"),diagnostics:t("diagnostics"),earnings:t("earnings"),alerts:t("alerts"),settings:t("settings")} as any)[item.id]}</span>{alertCount > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${active ? "bg-black text-white" : "bg-red-400/15 text-red-300"}`}>{alertCount}</span>}</button>; })}</nav>
      <div className="mt-auto rounded-2xl border border-emerald-400/10 bg-emerald-400/[.04] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold text-emerald-300"><ShieldCheck size={13}/> {t("nonCustodial")}</div><p className="mt-1 text-[9px] leading-4 text-slate-600">{t("privateKeysNever")}</p></div>
    </div>
  </aside>;

  const MobileNav = () => <nav className="relative z-30 flex gap-1 overflow-auto border-b border-white/10 bg-black/20 p-2 lg:hidden pointer-events-auto">{nav.map(item => { const Icon = item.icon; return <button type="button" key={item.id} onMouseDown={(e) => selectTab(item.id, e)} onClick={(e) => selectTab(item.id, e)} className={`relative z-40 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-2 text-[10px] ${tab === item.id ? "bg-white text-black" : "text-slate-500"}`}><Icon size={12}/>{({overview:t("dashboard"),nodes:t("nodes"),licenses:t("licenses"),aims:t("aims"),tilling:t("tilling"),diagnostics:t("diagnostics"),earnings:t("earnings"),alerts:t("alerts"),settings:t("settings")} as any)[item.id]}</button>; })}</nav>;


  const [compareId, setCompareId] = useState("");

  const fleetOperations = useMemo(() => {
    const active = nodes.filter(n => n.isActive !== false);
    const compare = nodes.find(n => n.id === compareId) || active.find(n => n.id !== selectedId) || active[0];
    const aId = selected?.id || active[0]?.id || "";
    const bId = compare?.id || "";
    const nodeStats = (id:string) => {
      const rows = fleetWindow.filter(h => h.nodeId === id).slice().sort((a,b)=>Date.parse(a.testedAt)-Date.parse(b.testedAt));
      const tests=rows.length, alive=rows.filter(x=>x.alive).length, dead=tests-alive;
      const lats=rows.map(x=>Number(x.totalLatencyMs)).filter(Number.isFinite);
      let failures=0,recoveries=0;
      rows.forEach((r,i)=>{ if(i&&rows[i-1].alive===true&&r.alive===false) failures++; if(i&&rows[i-1].alive===false&&r.alive===true) recoveries++; });
      const localUptime=tests?alive/tests*100:null;
      const ex=explorerFleet[String(nodes.find(n=>n.id===id)?.licenseKey||"").trim()];
      return {id,tests,alive,dead,uptime:localUptime,latency:lats.length?lats.reduce((a,b)=>a+b,0)/lats.length:null,failures,recoveries,stability:localUptime,explorerUptime:ex?.upPercent,rows};
    };
    const incidents = (id:string) => { const rows=nodeStats(id).rows; const out:any[]=[]; rows.forEach((r,i)=>{if(!i)return; const prev=rows[i-1]; if(prev.alive!==r.alive) out.push({at:r.testedAt,type:r.alive?"RECOVERY":"FAILURE"});}); return out.slice(-20).reverse(); };
    const statsA=nodeStats(aId), statsB=nodeStats(bId);
    const unstable=active.map(n=>nodeStats(n.id)).filter(x=>x.tests).sort((a,b)=>(b.dead-a.dead)||(b.failures-a.failures)||(a.stability??101)-(b.stability??101)).slice(0,10);
    return {a:statsA,b:statsB,incidentsA:incidents(aId),incidentsB:incidents(bId),unstable};
  }, [nodes, selected, compareId, fleetWindow, explorerFleet]);

  const runFleetSweep = useCallback(async () => {
    const active = nodes.filter(n => n.isActive !== false);
    if (!active.length || fleetSweepBusy) return;
    setFleetSweepBusy(true);
    setNotice(t("sweepRunning"));
    try {
      const rs = await api.nodes.testAll(active);
      const map: Record<string, TestResult> = {};
      rs.forEach((r: TestResult) => { map[r.nodeId] = r; });
      setResults(map);
      setAnalytics(await api.nodes.analytics());
      setFleetHistory(await api.nodes.fleetHistory(1500));
      setAlerts(await api.nodes.alerts(undefined, 100));
      if (selected) { setHistory(await api.nodes.history(selected.id, 300)); setHeartbeat(await api.nodes.heartbeat(selected.id)); }
      setNotice(`${t("commandSweep")} · ${rs.filter(r => r.alive).length}/${rs.length} ALIVE`);
    } catch (e) { setNotice(String(e)); }
    finally { setFleetSweepBusy(false); }
  }, [api, nodes, selected, fleetSweepBusy, t]);

  const fleetReadiness = useMemo(() => {
    const now = Date.now();
    const active = nodes.filter(n => n.isActive !== false);
    const rows = active.map(n => {
      const history = fleetHistory.filter(h => h.nodeId === n.id && Number.isFinite(Date.parse(h.testedAt))).sort((a,b)=>Date.parse(b.testedAt)-Date.parse(a.testedAt));
      const latest = history[0];
      const ageMin = latest ? Math.max(0, (now - Date.parse(latest.testedAt)) / 60000) : null;
      const result = results[n.id];
      return { id:n.id, node:n, latest, ageMin, alive:latest?.alive ?? result?.alive ?? null, latency:latest?.totalLatencyMs ?? result?.totalLatencyMs ?? null };
    });
    const thresholdMin = 60;
    const stale = rows.filter(x => x.ageMin == null || x.ageMin > thresholdMin).sort((a,b)=>(b.ageMin??Infinity)-(a.ageMin??Infinity));
    const alive = rows.filter(x=>x.alive===true).length;
    const dead = rows.filter(x=>x.alive===false).length;
    const observed = rows.filter(x=>x.latest || x.alive != null).length;
    return { rows, stale, alive, dead, observed, thresholdMin };
  }, [nodes, fleetHistory, results]);

  const fleetCommand = useMemo(() => {
    const patterns = fleetIntelligence?.patterns || [];
    const rows = fleetReadiness.rows.map((r:any) => {
      const p = patterns.find((x:any) => x.nodeId === r.id);
      const reason = r.ageMin == null ? "STALE" : r.ageMin > fleetReadiness.thresholdMin ? "STALE" : r.alive === false ? "DEAD" : (p?.failures ?? 0) > 0 ? "FAILURES" : "READY";
      return { ...r, reason, failures: p?.failures || 0 };
    });
    const attention = rows.filter((r:any) => r.reason !== "READY").sort((a:any,b:any) => (a.alive === false ? 0 : 1) - (b.alive === false ? 0 : 1) || (b.failures-a.failures) || ((b.ageMin??Infinity)-(a.ageMin??Infinity))).slice(0,20);
    return { rows, attention, ready: rows.filter((r:any)=>r.reason === "READY") };
  }, [fleetReadiness, fleetIntelligence]);

  const commandBoard = useMemo(() => {
    const rows = fleetCommand.rows;
    const sortRows = (items: any[]) => items.slice().sort((a,b) => (b.failures-a.failures) || ((b.ageMin??-1)-(a.ageMin??-1)) || ((b.latency??-1)-(a.latency??-1))).slice(0,8);
    return {
      critical: sortRows(rows.filter((r:any) => r.reason === "DEAD")),
      stale: sortRows(rows.filter((r:any) => r.reason === "STALE")),
      failures: sortRows(rows.filter((r:any) => r.reason === "FAILURES")),
      ready: sortRows(rows.filter((r:any) => r.reason === "READY")),
      total: rows.length
    };
  }, [fleetCommand]);

  const fleetRanking = useMemo(() => {
    return nodes.filter(n => n.isActive !== false).map(n => {
      const d = fleetDiagnostics.find((x:any) => x.nodeId === n.id);
      const r = results[n.id];
      const x = explorerFleet[String(n.licenseKey || "").trim()];
      const localUptime = analytics?.uptime24h?.[n.id];
      const latency = d?.latencyMs ?? r?.totalLatencyMs;
      const evidence = Boolean(d || r || x || typeof localUptime === "number");
      let score = 0;
      if (d?.overall === "HEALTHY" || r?.alive === true) score += 45;
      else if (d?.overall === "DEGRADED") score += 25;
      if (typeof localUptime === "number") score += Math.min(30, localUptime * 0.30);
      if (typeof x?.upPercent === "number") score += Math.min(20, x.upPercent * 0.20);
      if (typeof latency === "number") score += latency <= 250 ? 5 : latency <= 500 ? 3 : latency <= 1000 ? 1 : 0;
      return { node:n, score:evidence ? Math.min(100, Math.round(score)) : null, alive:d?.overall === "HEALTHY" || r?.alive === true, latency, uptime:localUptime, explorerUptime:x?.upPercent, evidence };
    }).sort((a,b)=>(b.score ?? -1)-(a.score ?? -1));
  }, [nodes, fleetDiagnostics, results, explorerFleet, analytics]);

  const incidents = useMemo(() => {
    const rows = alerts.filter((a:any) => a && (a.type === "DEAD" || a.type === "ALIVE")).slice(0, 12);
    return rows.map((a:any) => {
      const n = nodes.find(x => x.id === a.nodeId);
      return { ...a, nodeName: n?.name || a.nodeId || "Node", open: a.type === "DEAD" };
    });
  }, [alerts, nodes]);

  const fleetHealth = useMemo(() => {
    const active = nodes.filter(n => n.isActive !== false);
    const tested = active.filter(n => results[n.id]);
    const alive = tested.filter(n => results[n.id]?.alive).length;
    const score = active.length ? Math.round(((alive + (active.length - tested.length) * 0.5) / active.length) * 100) : 0;
    const problemNodes = active.filter(n => results[n.id] && !results[n.id]?.alive).length;
    return { active: active.length, tested: tested.length, alive, problemNodes, score };
  }, [nodes, results]);

  const dataAvailability = useMemo(() => {
    const testedNodes = nodes.filter(n => results[n.id]).length;
    const explorerConfigured = nodes.filter(n => String(n.licenseKey || '').trim()).length;
    const explorerReceived = Object.values(explorerFleet).filter((x:any) => x && !x.error).length;
    return {
      localHistory: fleetHistory.length,
      testedNodes,
      activeNodes: nodes.filter(n => n.isActive !== false).length,
      explorerConfigured,
      explorerReceived,
      licensesSource: Boolean(String(sources.licensesUrl || '').trim()),
      tillingSource: Boolean(String(sources.tillingUrl || '').trim()),
      earningsSource: Boolean(String(sources.earningsUrl || '').trim()),
    };
  }, [nodes, results, fleetHistory, explorerFleet, sources]);

  const projectAreas = useMemo(() => {
    const historyReady = dataAvailability.localHistory >= 2;
    const explorerReady = dataAvailability.explorerConfigured > 0 && dataAvailability.explorerReceived > 0;
    return [
      { name: 'Dashboard', score: 96, state: 'FUNCTIONAL', detail: 'Resumo, operações, inteligência, saúde, histórico e Explorer.', next: historyReady ? 'Continuar a acumular histórico real.' : 'Executar TESTAR FROTA.' },
      { name: 'Nodes', score: 98, state: 'FUNCTIONAL', detail: 'Registo, edição, testes, seleção, tags, bulk actions e monitorização.', next: 'Adicionar nodes reais quando disponíveis.' },
      { name: 'Licenças & Factory', score: explorerReady ? 90 : 82, state: explorerReady ? 'FUNCTIONAL' : 'DATA DEPENDENT', detail: 'Explorer real e histórico público; Factory/Unlock dependem de fonte autoritativa.', next: explorerReady ? 'Explorar dados recebidos.' : 'Configurar licença e consultar o Explorer.' },
      { name: 'AIM Manager', score: selected ? 92 : 84, state: selected ? 'FUNCTIONAL' : 'PARTIAL', detail: 'Preflight, deploy, retry e remove através dos endpoints documentados.', next: selected ? 'Executar PRE-FLIGHT antes de uma operação real.' : 'Selecionar um node AIM.' },
      { name: 'Performance & Tilling', score: dataAvailability.tillingSource ? 82 : 72, state: dataAvailability.tillingSource ? 'DATA DEPENDENT' : 'API LIMITED', detail: 'Uptime/Explorer funcionam; Computation/Reputation/Tilling só aparecem quando existe fonte real.', next: dataAvailability.tillingSource ? 'Testar a fonte configurada.' : 'Encontrar uma API autoritativa.' },
      { name: 'Diagnóstico', score: 99, state: 'FUNCTIONAL', detail: 'Testes reais, cobertura, reliability, fila e Function Health Monitor.', next: 'Manter monitorização e auditorias.' },
      { name: 'Ganhos', score: dataAvailability.earningsSource ? 65 : 45, state: dataAvailability.earningsSource ? 'DATA DEPENDENT' : 'API LIMITED', detail: 'Estrutura preparada para dados reais, sem fabricar earnings.', next: dataAvailability.earningsSource ? 'Testar a fonte.' : 'Identificar API autoritativa de ganhos.' },
      { name: 'Alertas', score: 94, state: 'FUNCTIONAL', detail: 'Transições observadas, cooldown, reconhecimento e limpeza.', next: 'Ajustar regras conforme utilização.' },
      { name: 'Configuração', score: 96, state: 'FUNCTIONAL', detail: 'Fontes, idioma, privacidade, ocultação e exportação demo segura.', next: 'Usar EXPORTAR PERFIL DEMO antes de partilhar.' },
    ];
  }, [dataAvailability, selected]);

  const runSelectedQuick = async () => { if (selected) await test(selected); };
  const runExplorerQuick = async () => { await refreshExplorerFleet(); };

  const Overview = () => <>
    <style>{`
      .dashboard-panels[data-section="summary"] > :not(:nth-child(1)):not(:nth-child(7)):not(:nth-child(8)) { display:none !important; }
      .dashboard-panels[data-section="intelligence"] > :not(:nth-child(2)):not(:nth-child(9)):not(:nth-child(10)) { display:none !important; }
      .dashboard-panels[data-section="operations"] > :not(:nth-child(3)):not(:nth-child(4)):not(:nth-child(5)) { display:none !important; }
      .dashboard-panels[data-section="health"] > :not(:nth-child(6)):not(:nth-child(13)) { display:none !important; }
      .dashboard-panels[data-section="history"] > :not(:nth-child(12)):not(:nth-child(14)) { display:none !important; }
      .dashboard-panels[data-section="explorer"] > :not(:nth-child(11)) { display:none !important; }
    `}</style>
    <div className="mb-4 rounded-2xl border border-white/10 bg-white/[.025] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-white">{t("dashboard")}</div>
          <div className="mt-1 text-[9px] text-slate-500">{t("dashboardSectionHint")}</div>
        </div>
      </div>
      <div className="relative z-50 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["summary", t("dashboardSummary"), LayoutDashboard],
          ["intelligence", t("dashboardIntelligence"), BarChart3],
          ["operations", t("dashboardOperations"), Network],
          ["health", t("dashboardHealth"), HeartPulse],
          ["history", t("dashboardHistory"), Clock3],
          ["explorer", t("dashboardExplorer"), ShieldCheck],
        ].map(([id, labelText, Icon]: any) => (
          <button
            type="button"
            key={id}
            aria-pressed={dashboardSection === id}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              setDashboardSection(id as typeof dashboardSection);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setDashboardSection(id as typeof dashboardSection);
              }
            }}
            className={`relative z-50 flex min-h-14 w-full cursor-pointer select-none items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[9px] font-semibold transition-colors duration-100 ${dashboardSection === id ? "border-sky-400/40 bg-sky-400/10 text-sky-200 shadow-[0_0_0_1px_rgba(56,189,248,.08)]" : "border-white/5 bg-black/20 text-slate-500 hover:border-white/10 hover:bg-white/5 hover:text-slate-300"}`}
            style={{ WebkitAppRegion: "no-drag", touchAction: "manipulation" } as React.CSSProperties}
          >
            <Icon size={13}/> {labelText}
          </button>
        ))}
      </div>
    </div>
    <div className="dashboard-panels relative space-y-4" data-section={dashboardSection}>
    <Card className="overflow-hidden border-sky-400/10">
      <div className="border-b border-white/10 bg-gradient-to-r from-sky-400/[.08] via-transparent to-emerald-400/[.05] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-2"><Gauge size={17} className="text-sky-300"/><h2 className="text-sm font-semibold">{t("operations")}</h2></div><p className="mt-1 text-[10px] text-slate-500">{t("languageComplete")}</p></div>
          <Badge tone={fleetHealth.score >= 90 ? "good" : fleetHealth.score >= 70 ? "warn" : "bad"}>{t("healthScore")} {fleetHealth.score}%</Badge>
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title={t("healthScore")} value={`${fleetHealth.score}%`} sub={`${fleetHealth.alive}/${fleetHealth.tested || fleetHealth.active || 0} ${t("healthy").toLowerCase()}`} icon={HeartPulse} accent={fleetHealth.score >= 90 ? "good" : fleetHealth.score >= 70 ? "warn" : "bad"}/>
        <Metric title={t("problems")} value={String(fleetHealth.problemNodes)} sub={t("stale")} icon={AlertTriangle} accent={fleetHealth.problemNodes ? "bad" : "good"}/>
        <Metric title={t("autoMonitoring")} value={autoDiagnostics ? t("enabled") : t("disabled")} sub={autoDiagnostics ? `${t("interval")}: ${autoDiagnosticInterval < 60 ? autoDiagnosticInterval + "s" : Math.round(autoDiagnosticInterval / 60) + "m"}` : t("quickActions")} icon={RefreshCw} accent={autoDiagnostics ? "good" : "normal"}/>
        <div className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><div className="text-[10px] font-medium uppercase tracking-[.16em] text-slate-500">{t("quickActions")}</div><div className="mt-3 flex flex-wrap gap-2"><button type="button" {...immediateButton(() => void runSelectedQuick())} disabled={!selected || !!busy[selected?.id || ""]} className="cursor-pointer select-none rounded-lg border border-white/10 px-2.5 py-2 text-[9px] text-slate-300 disabled:opacity-40">{t("testNow")}</button><button type="button" {...immediateButton(() => void testAll())} disabled={!fleetHealth.active} className="cursor-pointer select-none rounded-lg border border-sky-400/20 px-2.5 py-2 text-[9px] text-sky-200 disabled:opacity-40">{t("testFleetLabel")}</button><button type="button" {...immediateButton(() => void runExplorerQuick())} disabled={explorerFleetBusy} className="cursor-pointer select-none rounded-lg border border-violet-400/20 px-2.5 py-2 text-[9px] text-violet-200 disabled:opacity-40">{t("refreshExplorer")}</button></div></div>
      </div>
      <div className="border-t border-white/10 p-4">
        <div className="mb-3 flex items-center justify-between gap-2"><div><h3 className="text-[11px] font-semibold">{t("projectMap")}</h3><p className="mt-1 text-[9px] text-slate-600">{t("projectMapHint")}</p></div><Badge tone="neutral">V72</Badge></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {projectAreas.map((area) => <div key={area.name} className="rounded-xl border border-white/5 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-medium text-slate-200">{area.name}</span><Badge tone={area.state === "FUNCTIONAL" ? "good" : area.state === "DATA DEPENDENT" ? "warn" : "neutral"}>{area.score}%</Badge></div>
            <div className="mt-1 text-[8px] font-semibold uppercase tracking-[.08em] text-slate-600">{area.state}</div>
            <div className="mt-1 text-[9px] leading-4 text-slate-500">{area.detail}</div>
            <div className="mt-2 border-t border-white/5 pt-2 text-[8px] leading-4 text-slate-600"><span className="text-slate-500">Próximo passo:</span> {area.next}</div>
          </div>)}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Metric title="Histórico local" value={String(dataAvailability.localHistory)} sub="registos disponíveis" icon={Clock3}/>
          <Metric title="Nodes testados" value={`${dataAvailability.testedNodes}/${dataAvailability.activeNodes}`} sub="cobertura atual" icon={CheckCircle2} accent={dataAvailability.testedNodes ? "good" : "warn"}/>
          <Metric title="Explorer" value={`${dataAvailability.explorerReceived}/${dataAvailability.explorerConfigured}`} sub={tx("respostas / licenças configuradas", "responses / configured licenses")} icon={ShieldCheck} accent={dataAvailability.explorerReceived ? "good" : "warn"}/>
          <Metric title="Fontes externas" value={`${Number(dataAvailability.licensesSource) + Number(dataAvailability.tillingSource) + Number(dataAvailability.earningsSource)}/3`} sub="Licença · Tilling · Earnings" icon={Database}/>
        </div>
        <Card className="mt-4 overflow-hidden border-violet-400/10">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
            <div><h3 className="text-sm font-semibold">{t("dataReadiness")}</h3><p className="mt-1 text-[9px] text-slate-600">{t("dataReadinessHint")}</p></div>
            <button type="button" {...immediateButton(() => void auditDataSources())} disabled={sourceAuditBusy} className="cursor-pointer select-none rounded-lg border border-violet-400/20 bg-violet-400/10 px-3 py-2 text-[9px] font-semibold text-violet-200 disabled:opacity-40">{sourceAuditBusy ? t("sourceAuditRunning") : t("auditSources")}</button>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {[['explorerUrl','Explorer','Consulta pública por licença'],['licensesUrl','Licenças / Factory','Fonte externa configurável'],['tillingUrl','Tilling','Métrica externa ainda dependente de API'],['earningsUrl','Earnings','Ganhos dependentes de fonte autoritativa']].map(([k,label,detail]) => { const r=sourceStatus[k]; const configured=Boolean(String(sources[k]||'').trim()); const tone=r?.ok?'good':r?.error?'bad':configured?'warn':'neutral'; return <div key={k} className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-medium text-slate-200">{label}</span><Badge tone={tone as any}>{r?.ok?t("sourceReady"):r?.error?t("sourceFailed"):configured?t("configured"):t("sourceMissing")}</Badge></div><div className="mt-2 text-[8px] leading-4 text-slate-600">{detail}</div>{r?.latencyMs!=null&&<div className="mt-1 text-[8px] text-slate-500">{r.latencyMs} ms</div>}</div> })}
          </div>
          {sourceAuditAt && <div className="px-4 pb-3 text-[8px] text-slate-600">Última auditoria: {shortDate(sourceAuditAt, uiLanguage === "en" ? "en-US" : "pt-PT")}</div>}
        </Card>
      </div>
    </Card>
    <Card className="overflow-hidden p-0">
      <div className="border-b border-white/10 bg-gradient-to-r from-indigo-400/[.07] via-transparent to-sky-400/[.05] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-2"><BarChart3 size={16} className="text-indigo-300"/><h2 className="text-sm font-semibold">{t("intelligenceCenter")}</h2></div><p className="mt-1 text-[10px] text-slate-600">{t("intelligenceMethod")} {t("patternInfo")}</p></div>
          <div className="flex gap-2"><Badge tone={fleetIntelligence.degrading.length ? "warn":"good"}>{t("degrading")}: {fleetIntelligence.degrading.length}</Badge><Badge tone="neutral">{t("failures")}: {fleetIntelligence.failures}</Badge><Badge tone="good">{t("recoveries")}: {fleetIntelligence.recoveries}</Badge></div>
        </div>
      </div>
      <div className="grid gap-2 border-b border-white/10 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="text-[9px] uppercase tracking-[.12em] text-slate-600">Histórico</div><div className="mt-1 text-sm font-semibold">{dataAvailability.localHistory}</div><div className="text-[8px] text-slate-600">testes persistidos</div></div>
        <div className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="text-[9px] uppercase tracking-[.12em] text-slate-600">Explorer</div><div className="mt-1 text-sm font-semibold">{dataAvailability.explorerReceived}/{dataAvailability.explorerConfigured}</div><div className="text-[8px] text-slate-600">licenças com resposta</div></div>
        <div className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="text-[9px] uppercase tracking-[.12em] text-slate-600">Tilling API</div><div className="mt-1 text-sm font-semibold">{dataAvailability.tillingSource ? "CONFIGURADA" : "NÃO CONFIGURADA"}</div><div className="text-[8px] text-slate-600">fonte externa</div></div>
        <div className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="text-[9px] uppercase tracking-[.12em] text-slate-600">Earnings API</div><div className="mt-1 text-sm font-semibold">{dataAvailability.earningsSource ? "CONFIGURADA" : "NÃO CONFIGURADA"}</div><div className="text-[8px] text-slate-600">fonte externa</div></div>
      </div>
      {fleetIntelligence.chart?.length ? <div className="p-4"><div className="mb-2 text-[10px] text-slate-500">{t("trend")} · {t("currentWindow")}</div><div className="h-48"><ResponsiveContainer width="100%" height="100%"><LineChart data={fleetIntelligence.chart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)"/><XAxis dataKey="time" tick={{fontSize:9}}/><YAxis tick={{fontSize:9}} allowDecimals={false}/><Tooltip contentStyle={{background:"#0d1117",border:"1px solid rgba(255,255,255,.1)",fontSize:10}}/><Line type="monotone" dataKey="alive" name="ALIVE" stroke="#34d399" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="dead" name="DEAD" stroke="#f87171" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div></div> : <div className="p-6 text-center"><div className="text-[10px] text-slate-500">{t("intelligenceEmpty")}</div><button type="button" {...immediateButton(() => void testAll())} disabled={!fleetHealth.active} className="mt-3 cursor-pointer select-none rounded-lg border border-indigo-400/20 bg-indigo-400/10 px-3 py-2 text-[9px] font-semibold text-indigo-200 disabled:opacity-40">{t("runFleetForIntelligence")}</button></div>}
      <div className="grid gap-3 border-t border-white/10 p-4 sm:grid-cols-3"><Metric title={t("degrading")} value={String(fleetIntelligence.degrading.length)} sub={t("attentionNodes")} icon={AlertTriangle} accent={fleetIntelligence.degrading.length?"warn":"good"}/><Metric title={t("improving")} value={String(fleetIntelligence.improving.length)} sub={t("comparison")} icon={TrendingUpIcon} accent="good"/><Metric title={t("stable")} value={String(fleetIntelligence.stable.length)} sub={t("comparison")} icon={Activity}/></div>
      <div className="border-t border-white/10 p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-[11px] font-semibold">{t("attentionNodes")}</h3><p className="text-[9px] text-slate-600">{t("noEstimates")}</p></div><Badge tone="neutral">{fleetIntelligence.attention.length}</Badge></div>{fleetIntelligence.attention.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-[10px]"><thead className="text-slate-600"><tr><th className="p-2">Node</th><th className="p-2">{t("trend")}</th><th className="p-2">Uptime Δ</th><th className="p-2">{t("avgLatency")}</th><th className="p-2">{t("currentAlive")}</th></tr></thead><tbody>{fleetIntelligence.attention.map((x:any)=><tr key={x.nodeId} onClick={()=>setSelectedId(x.nodeId)} className="cursor-pointer border-t border-white/5 hover:bg-white/[.025]"><td className="p-2 text-slate-200">{nodes.find(n=>n.id===x.nodeId)?.name || x.nodeId}</td><td className="p-2"><Badge tone="bad">{x.direction}</Badge></td><td className="p-2 text-amber-300">{x.delta!=null?`${x.delta>=0?"+":""}${x.delta.toFixed(1)} pp`:"—"}</td><td className="p-2 text-sky-300">{x.latency!=null?`${Math.round(x.latency)} ms`:"—"}</td><td className="p-2"><Badge tone={x.last?.alive?"good":"bad"}>{x.last?.alive?"ALIVE":"DEAD"}</Badge></td></tr>)}</tbody></table></div> : <div className="text-[10px] text-slate-600">{t("noTrendData")}</div>}</div>
      <div className="border-t border-white/10 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[11px] font-semibold">{t("nodePatterns")}</h3><p className="text-[9px] text-slate-600">{t("observedOnly")}</p></div><Badge tone="neutral">{fleetIntelligence.patterns?.length || 0}</Badge></div>{fleetIntelligence.patterns?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[10px]"><thead className="text-slate-600"><tr><th className="p-2">Node</th><th className="p-2">{t("trend")}</th><th className="p-2">{t("failureTransitions")}</th><th className="p-2">{t("recoveryTransitions")}</th><th className="p-2">DEAD %</th><th className="p-2">{t("stability")}</th></tr></thead><tbody>{fleetIntelligence.patterns.slice(0,20).map((x:any)=><tr key={x.nodeId} onClick={()=>setSelectedId(x.nodeId)} className="cursor-pointer border-t border-white/5 hover:bg-white/[.025]"><td className="p-2 text-slate-200">{nodes.find(n=>n.id===x.nodeId)?.name || x.nodeId}</td><td className="p-2"><Badge tone={x.direction==="DEGRADING"?"bad":x.direction==="IMPROVING"?"good":"neutral"}>{x.direction}</Badge></td><td className="p-2 text-red-300">{x.failures}</td><td className="p-2 text-emerald-300">{x.recoveries}</td><td className="p-2 text-amber-300">{x.deadRate.toFixed(1)}%</td><td className="p-2">{x.stability==null?"—":`${x.stability.toFixed(1)}%`}</td></tr>)}</tbody></table></div> : <div className="text-[10px] text-slate-600">{t("noPatternData")}</div>}</div>
    </Card>
    <Card className="overflow-hidden p-0">
      <div className="border-b border-white/10 bg-gradient-to-r from-emerald-400/[.06] via-transparent to-indigo-400/[.06] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-2"><Network size={16} className="text-emerald-300"/><h2 className="text-sm font-semibold">{t("operationsCenter")}</h2></div><p className="mt-1 text-[10px] text-slate-600">{t("observedOnly")}</p></div>
          <div className="flex items-center gap-2"><span className="text-[9px] text-slate-500">{t("compareNode")}</span><select value={compareId} onChange={e=>setCompareId(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[10px] text-slate-300"><option value="">{t("selectNode")}</option>{nodes.filter(n=>n.id!==selected?.id && n.isActive!==false).map(n=><option key={n.id} value={n.id}>{n.name || n.id}</option>)}</select></div>
        </div>
      </div>
      {fleetOperations.a?.id && fleetOperations.b?.id && fleetOperations.a.id!==fleetOperations.b.id ? <div className="p-4">
        <div className="grid gap-3 lg:grid-cols-2">{[fleetOperations.a,fleetOperations.b].map((x:any,i)=><Card key={x.id} className="p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-xs font-semibold text-slate-200">{i===0?t("nodeA"):t("nodeB")} · {nodes.find(n=>n.id===x.id)?.name || x.id}</h3><div className="text-[9px] text-slate-600">{x.tests} {t("runs")}</div></div><Badge tone={x.rows.at(-1)?.alive?"good":x.tests?"bad":"neutral"}>{x.rows.at(-1)?.alive?"ALIVE":x.tests?"DEAD":"—"}</Badge></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric title="Uptime" value={x.uptime!=null?`${x.uptime.toFixed(1)}%`:"—"} icon={Activity}/><Metric title={t("avgLatency")} value={x.latency!=null?`${Math.round(x.latency)} ms`:"—"} icon={Zap}/><Metric title={t("failureTransitions")} value={String(x.failures)} icon={AlertTriangle} accent={x.failures?"bad":"good"}/><Metric title={t("recoveryTransitions")} value={String(x.recoveries)} icon={RefreshCw} accent="good"/></div><div className="mt-2 flex flex-wrap gap-2 text-[9px] text-slate-500"><span>DEAD {x.tests?((x.dead/x.tests)*100).toFixed(1):"—"}%</span><span>{t("stability")} {x.stability!=null?`${x.stability.toFixed(1)}%`:"—"}</span><span>{t("explorerUptime")} {x.explorerUptime!=null?`${x.explorerUptime}%`:"—"}</span></div></Card>)}</div>
        <div className="mt-4"><h3 className="mb-2 text-[11px] font-semibold">{t("perNodeTimeline")}</h3><div className="grid gap-2 lg:grid-cols-2">{[fleetOperations.a,fleetOperations.b].map((x:any)=><div key={x.id} className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="mb-2 text-[9px] text-slate-500">{nodes.find(n=>n.id===x.id)?.name || x.id}</div><div className="flex h-7 items-stretch gap-[2px] overflow-hidden rounded-lg">{x.rows.slice(-80).map((r:any,i:number)=><div key={i} title={`${shortDate(r.testedAt)} · ${r.alive?"ALIVE":"DEAD"}`} className={`min-w-[3px] flex-1 rounded-sm ${r.alive?"bg-emerald-400/80":"bg-red-400/80"}`}/>)}</div></div>)}</div></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">{[[fleetOperations.a,t("nodeA")],[fleetOperations.b,t("nodeB")]].map(([x,label]:any)=><div key={x.id} className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="mb-2 flex items-center justify-between"><h3 className="text-[11px] font-semibold">{t("historicalIncidents")} · {label}</h3><Badge tone="neutral">{x.id===fleetOperations.a.id?fleetOperations.incidentsA.length:fleetOperations.incidentsB.length}</Badge></div>{(x.id===fleetOperations.a.id?fleetOperations.incidentsA:fleetOperations.incidentsB).length ? <div className="space-y-1">{(x.id===fleetOperations.a.id?fleetOperations.incidentsA:fleetOperations.incidentsB).slice(0,8).map((ev:any,i:number)=><div key={i} className="flex justify-between text-[9px]"><Badge tone={ev.type==="FAILURE"?"bad":"good"}>{ev.type}</Badge><span className="text-slate-500">{shortDate(ev.at)}</span></div>)}</div> : <div className="text-[9px] text-slate-600">{t("noIncidentHistory")}</div>}</div>)}</div>
      </div> : <div className="p-5 text-center text-[10px] text-slate-600">{t("noComparisonData")}</div>}
      <div className="border-t border-white/10 p-4"><h3 className="mb-2 text-[11px] font-semibold">{t("mostUnstable")}</h3>{fleetOperations.unstable.length?<div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-[10px]"><thead className="text-slate-600"><tr><th className="p-2">Node</th><th className="p-2">DEAD %</th><th className="p-2">{t("failureTransitions")}</th><th className="p-2">{t("stability")}</th></tr></thead><tbody>{fleetOperations.unstable.map((x:any)=><tr key={x.id} onClick={()=>setSelectedId(x.id)} className="cursor-pointer border-t border-white/5 hover:bg-white/[.025]"><td className="p-2 text-slate-200">{nodes.find(n=>n.id===x.id)?.name||x.id}</td><td className="p-2 text-amber-300">{(x.dead/x.tests*100).toFixed(1)}%</td><td className="p-2 text-red-300">{x.failures}</td><td className="p-2">{x.stability?.toFixed(1)}%</td></tr>)}</tbody></table></div>:<div className="text-[9px] text-slate-600">{t("noPatternData")}</div>}</div>
    </Card>
    <Card className="overflow-hidden p-0">
      <div className="border-b border-white/10 bg-gradient-to-r from-sky-400/[.07] via-transparent to-amber-400/[.05] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-2"><ShieldCheck size={16} className="text-sky-300"/><h2 className="text-sm font-semibold">{t("fleetCommand")}</h2></div><p className="mt-1 text-[10px] text-slate-600">{t("fleetCommandMethod")}</p></div>
          <button type="button" {...immediateButton(() => void runFleetSweep())} disabled={fleetSweepBusy || !nodes.some(n=>n.isActive!==false)} className="cursor-pointer select-none rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-[10px] font-medium text-sky-200 disabled:opacity-40">{fleetSweepBusy?t("sweepRunning"):t("commandSweep")}</button>
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <Metric title={t("readyNodes")} value={String(fleetCommand.ready.length)} sub={t("readyReason")} icon={CheckCircle2} accent="good"/>
        <Metric title={t("attentionQueue")} value={String(fleetCommand.attention.length)} sub={t("commandAction")} icon={AlertTriangle} accent={fleetCommand.attention.length?"warn":"normal"}/>
        <Metric title={t("observedOnly")} value={`${fleetReadiness.observed}/${fleetReadiness.rows.length}`} sub={t("lastObserved")} icon={Database}/>
      </div>
      <div className="border-t border-white/10 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[11px] font-semibold">{t("commandBoard")}</h3><p className="mt-1 text-[9px] text-slate-600">{t("boardHint")}</p></div><Badge>{commandBoard.total} {t("classified")}</Badge></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[["criticalNodes",commandBoard.critical,"bad","DEAD"],["staleCommand",commandBoard.stale,"warn","STALE"],["failureCommand",commandBoard.failures,"warn","FAILURES"],["readyCommand",commandBoard.ready,"good","READY"]].map(([title,items,tone,reason]:any)=><div key={reason} className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between"><span className="text-[9px] font-semibold uppercase tracking-[.12em] text-slate-500">{t(title)}</span><Badge tone={tone}>{items.length}</Badge></div><div className="mt-2 space-y-1.5">{items.length ? items.slice(0,4).map((x:any)=><button key={x.id} type="button" onPointerDown={(e)=>{if(e.button===0){e.preventDefault();e.stopPropagation();setSelectedId(x.id);}}} onClick={(e)=>{e.preventDefault();e.stopPropagation();}} className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-white/5 px-2 py-1.5 text-left hover:bg-white/[.04]" style={{WebkitAppRegion:"no-drag",touchAction:"manipulation"} as React.CSSProperties}><span className="min-w-0 truncate text-[9px] text-slate-300">{x.node?.name||x.id}</span><span className="ml-2 shrink-0 text-[8px] text-slate-600">{x.latency!=null?`${Math.round(x.latency)}ms`:x.ageMin!=null?`${Math.round(x.ageMin)}m`:"—"}</span></button>):<div className="py-3 text-center text-[9px] text-slate-700">{t("commandClear")}</div>}</div>{items.length>4&&<div className="mt-2 text-[8px] text-slate-600">+{items.length-4} {t("nodes")}</div>}</div>)}
        </div>
      </div>
      <div className="border-t border-white/10 p-4">
        {fleetCommand.attention.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[10px]"><thead className="text-slate-600"><tr><th className="p-2">Node</th><th className="p-2">{t("currentAlive")}</th><th className="p-2">{t("stateReason")}</th><th className="p-2">{t("age")}</th><th className="p-2">{t("failures")}</th><th className="p-2"></th></tr></thead><tbody>{fleetCommand.attention.map((x:any)=><tr key={x.id} onClick={()=>setSelectedId(x.id)} className="cursor-pointer border-t border-white/5 hover:bg-white/[.025]"><td className="p-2 text-slate-200">{x.node.name || x.id}</td><td className="p-2"><Badge tone={x.alive===true?"good":x.alive===false?"bad":"neutral"}>{x.alive===true?"ALIVE":x.alive===false?"DEAD":"—"}</Badge></td><td className="p-2"><Badge tone={x.reason==="DEAD"?"bad":x.reason==="FAILURES"?"warn":"neutral"}>{x.reason==="STALE"?t("staleReason"):x.reason==="DEAD"?t("deadReason"):x.reason==="FAILURES"?t("failureReason"):x.reason}</Badge></td><td className="p-2 text-slate-400">{x.ageMin==null?"—":`${Math.round(x.ageMin)}m`}</td><td className="p-2 text-red-300">{x.failures}</td><td className="p-2"><button type="button" onClick={(e)=>{e.stopPropagation();void test(x.node)}} className="rounded-lg border border-sky-400/20 px-2 py-1 text-[9px] text-sky-200 hover:bg-sky-400/10">{t("testNowOps")}</button></td></tr>)}</tbody></table></div> : <div className="p-5 text-center text-[10px] text-slate-600">{t("noCommandItems")}</div>}
      </div>
    </Card>
    <Card className="overflow-hidden p-0">
      <div className="border-b border-white/10 bg-gradient-to-r from-amber-400/[.06] via-transparent to-emerald-400/[.05] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-2"><Wrench size={16} className="text-amber-300"/><h2 className="text-sm font-semibold">{t("operationalReadiness")}</h2></div><p className="mt-1 text-[10px] text-slate-600">{t("operationalSummary")}</p></div>
          <div className="flex gap-2"><Badge tone={fleetReadiness.stale.length?"warn":"good"}>{t("staleNodes")}: {fleetReadiness.stale.length}</Badge><Badge tone="good">ALIVE: {fleetReadiness.alive}</Badge><Badge tone="bad">DEAD: {fleetReadiness.dead}</Badge></div>
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <Metric title={t("observedOnly")} value={`${fleetReadiness.observed}/${fleetReadiness.rows.length}`} sub={t("lastObserved")} icon={Database}/>
        <Metric title={t("staleNodes")} value={String(fleetReadiness.stale.length)} sub={`${t("threshold")}: ${fleetReadiness.thresholdMin}m`} icon={Clock3} accent={fleetReadiness.stale.length?"warn":"good"}/>
        <Metric title={t("currentAlive")} value={`${fleetReadiness.alive}/${fleetReadiness.rows.length}`} sub={t("operationalReadiness")} icon={HeartPulse} accent="good"/>
      </div>
      <div className="border-t border-white/10 p-4">
        {fleetReadiness.stale.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-[10px]"><thead className="text-slate-600"><tr><th className="p-2">Node</th><th className="p-2">{t("currentAlive")}</th><th className="p-2">{t("lastObserved")}</th><th className="p-2">{t("age")}</th><th className="p-2">{t("latency")}</th><th className="p-2"></th></tr></thead><tbody>{fleetReadiness.stale.slice(0,20).map((x:any)=><tr key={x.id} onClick={()=>setSelectedId(x.id)} className="cursor-pointer border-t border-white/5 hover:bg-white/[.025]"><td className="p-2 text-slate-200">{x.node.name || x.id}</td><td className="p-2"><Badge tone={x.alive===true?"good":x.alive===false?"bad":"neutral"}>{x.alive===true?"ALIVE":x.alive===false?"DEAD":"—"}</Badge></td><td className="p-2 text-slate-500">{x.latest?shortDate(x.latest.testedAt):"—"}</td><td className="p-2 text-amber-300">{x.ageMin==null?"—":x.ageMin<60?`${Math.round(x.ageMin)}m`:x.ageMin<1440?`${Math.round(x.ageMin/60)}h`:`${Math.round(x.ageMin/1440)}d`}</td><td className="p-2 text-slate-400">{Number.isFinite(x.latency)?`${Math.round(x.latency)} ms`:"—"}</td><td className="p-2"><button type="button" onClick={(e)=>{e.stopPropagation(); void test(x.node);}} className="rounded-lg border border-amber-400/20 px-2 py-1 text-[9px] text-amber-200 hover:bg-amber-400/10">{t("testNowOps")}</button></td></tr>)}</tbody></table></div> : <div className="p-5 text-center text-[10px] text-slate-600">{t("noStaleNodes")}</div>}
      </div>
    </Card>
    <Card className="overflow-hidden p-0">
      <div className="border-b border-white/10 bg-white/[.02] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><Activity size={16} className="text-sky-300"/><h2 className="text-sm font-semibold">{t("fleetHealthMatrix")}</h2></div>
            <p className="mt-1 max-w-3xl text-[10px] leading-4 text-slate-600">{t("rankingExplain")}</p>
          </div>
          <Badge tone="neutral">{fleetRanking.filter(x => x.score != null).length}/{fleetRanking.length} {t("evidence").toLowerCase()}</Badge>
        </div>
      </div>
      {fleetRanking.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[10px]">
          <thead className="bg-black/20 text-slate-500"><tr><th className="p-3">#</th><th className="p-3">Node</th><th className="p-3">{t("score")}</th><th className="p-3">{t("diagnostics")}</th><th className="p-3">{t("latency")}</th><th className="p-3">{tx("Uptime", "Uptime")}</th><th className="p-3">{t("evidence")}</th></tr></thead>
          <tbody>{fleetRanking.slice(0, 12).map((x, i) => {
            const tone = x.score == null ? "neutral" : x.score >= 85 ? "good" : x.score >= 65 ? "warn" : "bad";
            const status = x.alive === true ? "ALIVE" : x.alive === false ? "DEAD" : "—";
            return <tr key={x.node.id} onClick={() => setSelectedId(x.node.id)} className="cursor-pointer border-t border-white/5 hover:bg-white/[.025]">
              <td className="p-3 text-slate-500">{i + 1}</td>
              <td className="p-3"><div className="font-medium text-slate-200">{x.node.name || "Node"}</div><div className="text-[9px] text-slate-600">{host(x.node)}</div></td>
              <td className="p-3">{x.score == null ? <Badge>{t("noEvidence")}</Badge> : <Badge tone={tone}>{x.score}%</Badge>}</td>
              <td className="p-3"><Badge tone={x.alive === true ? "good" : x.alive === false ? "bad" : "neutral"}>{status}</Badge></td>
              <td className="p-3 text-slate-400">{typeof x.latency === "number" ? `${Math.round(x.latency)} ms` : "—"}</td>
              <td className="p-3 text-slate-400">{typeof x.explorerUptime === "number" ? `${x.explorerUptime}% Explorer` : typeof x.uptime === "number" ? `${x.uptime}% observado` : "—"}</td>
              <td className="p-3 text-slate-500">{[x.latency != null, x.uptime != null, x.explorerUptime != null, x.alive != null].filter(Boolean).length}/4</td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <div className="p-8 text-center text-xs text-slate-600">{t("noEvidence")}</div>}
    </Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric title="Fleet" value={String(stat.total)} sub={`${stat.active} ${tx("ativos", "active")}`} icon={Server}/><Metric title="Online" value={String(stat.alive)} sub={`${stat.total ? Math.round(stat.alive / stat.total * 100) : 0}% da frota`} icon={CheckCircle2} accent="good"/><Metric title="Offline" value={String(stat.dead)} sub={tx("último estado conhecido", "last known state")} icon={XCircle} accent="bad"/><Metric title={tx("Uptime observado", "Observed uptime")} value={selected && analytics?.uptime24h?.[selected.id] != null ? `${analytics.uptime24h[selected.id]}%` : "—"} sub={tx("últimas 24 horas", "last 24 hours")} icon={Activity}/><Metric title="Heartbeat" value={heartbeat?.lastHeartbeatAt ? new Date(heartbeat.lastHeartbeatAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : "—"} sub={heartbeat?.heartbeatCount ? `${heartbeat.heartbeatCount} batimentos` : "aguarda primeiro teste"} icon={HeartPulse} accent="good"/></div>
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
        <div><h2 className="text-sm font-semibold">{t("recentIncidents")}</h2><p className="text-[10px] text-slate-500">{text("Transições ALIVE/DEAD detetadas pelo Node Manager.", "ALIVE/DEAD transitions detected by Node Manager.")}</p></div>
        <Badge tone={incidents.some((x:any)=>x.open) ? "bad" : "good"}>{incidents.length ? `${incidents.filter((x:any)=>x.open).length} ${t("incidentOpen").toLowerCase()}` : t("noIncidents")}</Badge>
      </div>
      {incidents.length ? <div className="divide-y divide-white/5">{incidents.slice(0,6).map((a:any) => <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3"><Badge tone={a.type === "DEAD" ? "bad" : "good"}>{a.type}</Badge><div className="min-w-0 flex-1"><div className="text-[10px] text-slate-200">{a.nodeName}</div><div className="text-[9px] text-slate-600">{a.message || text("Transição de estado", "State transition")}</div></div><span className="text-[9px] text-slate-600">{shortDate(a.createdAt, uiLanguage === "en" ? "en-US" : "pt-PT")}</span></div>)}</div> : <div className="p-6 text-center text-[10px] text-slate-600">{t("noIncidents")}</div>}
    </Card>
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-sm font-semibold">{text("Inteligência da frota", "Fleet intelligence")}</h2><p className="text-[10px] text-slate-600">{text("Resumo operacional calculado apenas a partir dos testes locais já realizados.", "Operational summary calculated only from local tests already performed.")}</p></div>
        <Badge tone={fleetInsights.responseRate >= 90 ? "good" : fleetInsights.responseRate >= 60 ? "warn" : "neutral"}>{text("Cobertura", "Coverage")} {fleetInsights.responseRate}%</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Metric title={text("Média de latência", "Average latency")} value={fleetInsights.avgLatency != null ? `${fleetInsights.avgLatency} ms` : "—"} sub={text("nodes testados", "tested nodes")} icon={Zap}/>
        <Metric title="TODA" value={String(fleetInsights.toda)} sub={text("nodes ativos", "active nodes")} icon={Network}/>
        <Metric title="BASE" value={String(fleetInsights.base)} sub={text("nodes ativos", "active nodes")} icon={Network}/>
        <Metric title={text("Testados", "Tested")} value={`${fleetInsights.tested}/${fleetInsights.active}`} sub={text("cobertura atual", "current coverage")} icon={CheckCircle2} accent="good"/>
        <Metric title={text("Maior latência", "Highest latency")} value={fleetInsights.worst ? `${fleetInsights.worst.totalLatencyMs} ms` : "—"} sub={fleetInsights.worst ? (nodes.find(n=>n.id===fleetInsights.worst?.nodeId)?.name || fleetInsights.worst.nodeId) : text("sem testes", "no tests")} icon={AlertTriangle} accent={fleetInsights.worst && fleetInsights.worst.totalLatencyMs > 1000 ? "warn" : "normal"}/>
      </div>
    </Card>
    <Card className="overflow-hidden p-0">
      <div className="border-b border-white/10 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">{t("fleetRanking")}</h2><p className="text-[10px] text-slate-600">{t("rankingBasis")}</p></div><Badge tone="neutral">{fleetRanking.filter(x=>x.score!=null).length}/{fleetRanking.length}</Badge></div></div>
      {fleetRanking.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[10px]"><thead className="bg-black/20 text-slate-500"><tr><th className="p-3">{t("rank")}</th><th className="p-3">Node</th><th className="p-3">{t("healthScore")}</th><th className="p-3">{t("response")}</th><th className="p-3">{t("latency")}</th><th className="p-3">Uptime</th></tr></thead><tbody>{fleetRanking.slice(0,10).map((x,i)=><tr key={x.node.id} onClick={()=>setSelectedId(x.node.id)} className="cursor-pointer border-t border-white/5 hover:bg-white/[.03]"><td className="p-3 font-semibold text-slate-300">#{i+1}</td><td className="p-3 text-slate-200">{x.node.name}</td><td className="p-3">{x.score!=null ? <Badge tone={x.score>=80?"good":x.score>=50?"warn":"bad"}>{x.score}/100</Badge> : <Badge>{tx("SEM DADOS","NO DATA")}</Badge>}</td><td className="p-3">{x.alive ? <span className="text-emerald-300">ONLINE</span> : x.evidence ? <span className="text-red-300">{tx("PROBLEMA","PROBLEM")}</span> : <span className="text-slate-600">—</span>}</td><td className="p-3 text-sky-300">{x.latency!=null?`${x.latency} ms`:"—"}</td><td className="p-3 text-emerald-300">{x.explorerUptime!=null?`${x.explorerUptime}%`:x.uptime!=null?`${x.uptime}%`:"—"}</td></tr>)}</tbody></table></div> : <div className="p-6 text-center text-[10px] text-slate-600">{t("noNode")}</div>}
    </Card>
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-gradient-to-r from-sky-400/[.06] via-transparent to-indigo-400/[.05] p-4">
        <div><h2 className="text-sm font-semibold"> {tx("HyperCycle Explorer · Comunicação da frota", "HyperCycle Explorer · Fleet communication")} </h2><p className="text-[10px] text-slate-500"> {tx("Dados históricos da licença apresentados dentro do Node Manager, sem abrir o browser.", "License history is shown inside Node Manager without opening the browser.")} </p></div>
        <div className="flex items-center gap-2"><Badge tone={Object.keys(explorerFleet).length ? "good" : "neutral"}>{Object.keys(explorerFleet).length ? "DADOS RECEBIDOS" : "AGUARDA ATUALIZAÇÃO"}</Badge><button type="button" {...immediateButton(() => void refreshExplorerFleet())} disabled={explorerFleetBusy} className="cursor-pointer select-none rounded-xl border border-sky-400/20 px-3 py-2 text-[10px] text-sky-200 disabled:opacity-40"><RefreshCw size={12} className={`mr-1 inline ${explorerFleetBusy ? "animate-spin" : ""}`}/> {explorerFleetBusy ? "A CONSULTAR…" : "ATUALIZAR EXPLORER"}</button></div>
      </div>
      {Object.keys(explorerFleet).length ? <><div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">{(() => { const rows = Object.values(explorerFleet).filter((x:any) => x && !x.error); const alive = rows.filter((x:any) => /alive/i.test(x.status || "")).length; const hb = rows.reduce((a:any,x:any) => a + (Number(x.heartbeat) || 0), 0); const up = rows.filter((x:any) => x.upPercent != null).length ? rows.reduce((a:any,x:any) => a + (Number(x.upPercent) || 0), 0) / rows.filter((x:any) => x.upPercent != null).length : null; return <><Metric title="Licenças" value={String(rows.length)} sub="Explorer consultado" icon={ShieldCheck}/><Metric title="Alive" value={String(alive)} sub={`${rows.length ? Math.round(alive / rows.length * 100) : 0}% das licenças`} icon={CheckCircle2} accent="good"/><Metric title="Uptime médio" value={up != null ? `${up.toFixed(2)}%` : "—"} sub="histórico Explorer" icon={Activity} accent="good"/><Metric title="Heartbeats" value={hb ? hb.toLocaleString(uiLanguage === "en" ? "en-US" : "pt-PT") : "—"} sub={tx("contador agregado", "aggregate counter")} icon={HeartPulse}/></>; })()}</div>
      <div className="overflow-x-auto border-t border-white/5"><table className="w-full min-w-[760px] text-left text-[10px]"><thead className="bg-black/20 text-slate-500"><tr><th className="p-3">Node</th><th className="p-3"> {tx("Licença", "License")} </th><th className="p-3">Level</th><th className="p-3"> {tx("Estado", "Status")} </th><th className="p-3">Uptime</th><th className="p-3">Downtime</th><th className="p-3">Heartbeats</th><th className="p-3"> {tx("Atualizado", "Updated")} </th></tr></thead><tbody>{nodes.filter(n => n.licenseKey).map(n => { const x = explorerFleet[String(n.licenseKey).trim()]; const err = x?.error; return <tr key={n.id} onClick={() => { setSelectedId(n.id); if (x && !err) { setExplorerLicense(String(n.licenseKey)); setExplorerData(x); } }} className="cursor-pointer border-t border-white/5 transition hover:bg-white/[.03]"><td className="p-3 font-medium text-slate-200">{n.name}</td><td className="p-3 font-mono text-slate-500">{maskNumber(n.licenseKey, hideNumbers)}</td><td className="p-3 text-slate-400">{x?.level ? `L${x.level}` : "—"}</td><td className="p-3">{err ? <Badge tone="warn"> {tx("SEM RESPOSTA", "NO RESPONSE")} </Badge> : x ? <Badge tone={/alive/i.test(x.status || "") ? "good" : "bad"}>{x.status || "—"}</Badge> : <Badge> {tx("AGUARDA", "WAITING")} </Badge>}</td><td className="p-3 text-emerald-300">{x?.upPercent != null ? `${Number(x.upPercent).toLocaleString(uiLanguage === "en" ? "en-US" : "pt-PT", { maximumFractionDigits: 2 })}%` : "—"}</td><td className="p-3 text-amber-300">{x?.downHours != null ? `${Number(x.downHours).toLocaleString(uiLanguage === "en" ? "en-US" : "pt-PT")} h` : "—"}</td><td className="p-3 text-slate-300">{x?.heartbeat != null ? Number(x.heartbeat).toLocaleString(uiLanguage === "en" ? "en-US" : "pt-PT") : "—"}</td><td className="p-3 text-slate-600">{x?.fetchedAt ? shortDate(x.fetchedAt, uiLanguage === "en" ? "en-US" : "pt-PT") : err || "—"}</td></tr>; })}</tbody></table></div>
      <div className="border-t border-white/5 p-3 text-[9px] text-slate-600"> {tx("Clique numa linha para abrir os detalhes históricos dessa licença aqui mesmo no Node Manager.", "Click a row to open this license history inside Node Manager.")} </div></> : <div className="p-8 text-center text-xs text-slate-600">Clique em <b className="text-slate-400">ATUALIZAR EXPLORER</b> para consultar as licenças configuradas e trazer os dados para esta janela.</div>}
    </Card>
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold"> {tx("Histórico da frota", "Fleet history")} </h2><p className="text-[10px] text-slate-600"> {tx("Estado agregado por minuto · dados dos testes locais persistidos.", "Minute-aggregated status · persisted local test data.")} </p></div><div className="flex gap-1 rounded-xl border border-white/5 bg-black/20 p-1">{(["24H","7D","30D","ALL"] as const).map(r=><button key={r} type="button" {...immediateButton(() => setHistoryRange(r))} className={`cursor-pointer select-none rounded-lg px-2 py-1 text-[9px] ${historyRange===r?"bg-white text-black":"text-slate-500 hover:bg-white/5"}`}>{r==="ALL"?"TUDO":r}</button>)}</div></div>
      {fleetTimeline.length ? <div className="grid gap-4 lg:grid-cols-2"><div><div className="mb-2 text-[9px] uppercase tracking-[.15em] text-slate-600"> {tx("Nodes online / offline", "Nodes online / offline")} </div><ResponsiveContainer width="100%" height={210}><LineChart data={fleetTimeline}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)"/><XAxis dataKey="time" stroke="#475569" fontSize={8} minTickGap={30}/><YAxis allowDecimals={false} stroke="#475569" fontSize={8}/><Tooltip contentStyle={{background:"#111827",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,fontSize:10}}/><Line type="monotone" dataKey="alive" name="ALIVE" stroke="#34d399" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="dead" name="DEAD" stroke="#f87171" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div><div><div className="mb-2 text-[9px] uppercase tracking-[.15em] text-slate-600"> {tx("Latência média da frota", "Average fleet latency")} </div><ResponsiveContainer width="100%" height={210}><LineChart data={fleetTimeline}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)"/><XAxis dataKey="time" stroke="#475569" fontSize={8} minTickGap={30}/><YAxis domain={[0,"auto"]} stroke="#475569" fontSize={8}/><Tooltip contentStyle={{background:"#111827",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,fontSize:10}}/><Line type="monotone" dataKey="latency" name="ms" stroke="#a5b4fc" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div></div> : <div className="flex h-[210px] items-center justify-center text-xs text-slate-600"> {tx("Ainda não existem testes suficientes para construir o histórico da frota.", "There are not enough tests to build fleet history yet.")} </div>}
      <div className="mt-3 flex flex-wrap gap-4 text-[9px] text-slate-600"><span><b className="text-slate-300">{fleetWindow.length}</b> amostras no período</span><span><b className="text-slate-300">{fleetTimeline.length}</b> minutos agregados</span><span>janela: <b className="text-slate-300">{rangeLabel}</b></span></div>
    </Card>
    <div className="grid gap-4 xl:grid-cols-[1.6fr_.8fr]">
      <Card className="p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold"> {tx("Saúde e latência", "Health and latency")} </h2><p className="text-[10px] text-slate-600">{selected ? selected.name : "Selecione um node"} · histórico local</p></div><Badge tone={heartbeat?.lastHeartbeatAt ? "good" : "neutral"}><HeartPulse size={11}/>{heartbeat?.lastHeartbeatAt ? "HEARTBEAT ATIVO" : "SEM AMOSTRAS"}</Badge></div>{chart.length ? <ResponsiveContainer width="100%" height={250}><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)"/><XAxis dataKey="time" stroke="#475569" fontSize={9}/><YAxis stroke="#475569" fontSize={9}/><Tooltip contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, fontSize: 10 }}/><Line type="monotone" dataKey="latency" stroke="#7dd3fc" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer> : <div className="flex h-[250px] items-center justify-center text-xs text-slate-600">Faça um teste para começar a construir o histórico.</div>}</Card>
      <Card className="p-4"><div className="mb-2 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Estado da frota</h2><p className="text-[10px] text-slate-600"> {tx("último estado conhecido", "last known status")} </p></div><Gauge size={17} className="text-slate-600"/></div>{pieTotal ? <div className="relative h-[190px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={fleetChart} dataKey="value" innerRadius={58} outerRadius={78} paddingAngle={3}>{fleetChart.map((_, i) => <Cell key={i} fill={i === 0 ? "#34d399" : i === 1 ? "#f87171" : "#475569"}/>)}</Pie><Tooltip contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, fontSize: 10 }}/></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><div className="text-2xl font-semibold">{stat.alive}</div><div className="text-[9px] uppercase tracking-wider text-slate-600"> {tx("online", "online")} </div></div></div> : <div className="flex h-[190px] items-center justify-center text-xs text-slate-600"> {tx("Sem dados", "No data")} </div>}<div className="grid grid-cols-3 gap-2">{fleetChart.map((x, i) => <div key={x.name} className="rounded-xl bg-white/[.03] p-2 text-center"><div className={`text-sm font-semibold ${i === 0 ? "text-emerald-300" : i === 1 ? "text-red-300" : "text-slate-500"}`}>{x.value}</div><div className="text-[8px] text-slate-600">{x.name}</div></div>)}</div></Card>
    </div>
    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <Card className="p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{t("selectedNode")}</h2>{selected && <button onClick={openEdit} className="text-[10px] text-slate-500 hover:text-white"><Pencil size={11} className="mr-1 inline"/> editar</button>}</div>{selected ? <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2"><Info label="Node" value={selected.name}/><Info label="Endpoint" value={host(selected)}/><Info label="Network" value={selected.network || "TODA"}/><Info label="Primeiro heartbeat" value={shortDate(heartbeat?.firstObservedAt, uiLanguage === "en" ? "en-US" : "pt-PT")}/><Info label="Último heartbeat" value={shortDate(heartbeat?.lastHeartbeatAt, uiLanguage === "en" ? "en-US" : "pt-PT")}/><Info label="Tempo observado" value={fmtDuration(heartbeat?.observedDurationSeconds)}/><Info label="Uptime observado" value={heartbeat?.observedUptimePercent != null ? `${heartbeat.observedUptimePercent}%` : "—"}/><Info label="Uptime reportado pelo node" value={heartbeat?.reportedUptimeSeconds != null ? fmtDuration(heartbeat.reportedUptimeSeconds) : "Não disponibilizado"}/></div> : <div className="py-8 text-center text-xs text-slate-600">{t("noNode")}</div>}</Card>
      <Card className="p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold"> {tx("Últimas transições", "Latest transitions")} </h2><p className="text-[10px] text-slate-600"> {tx("mudanças ALIVE / DEAD", "ALIVE / DEAD changes")} </p></div><button onClick={() => setTab("alerts")} className="text-[10px] text-slate-500 hover:text-white">ver todas <ChevronRight size={11} className="inline"/></button></div>{alerts.slice(0, 5).map(a => <div key={a.id} className="flex items-center gap-3 border-b border-white/5 py-2 last:border-0"><Badge tone={a.type === "DEAD" ? "bad" : "good"}>{a.type}</Badge><div className="min-w-0 flex-1 truncate text-[10px] text-slate-300">{a.message}</div><div className="text-[9px] text-slate-600">{shortDate(a.createdAt, uiLanguage === "en" ? "en-US" : "pt-PT")}</div></div>)}{!alerts.length && <div className="py-8 text-center text-xs text-slate-600">{t("noAlerts")}</div>}</Card>
    </div>
  </div>
  </>;

  const NodesView = () => <div className="grid gap-4 xl:grid-cols-[.9fr_1.6fr]">
    <Card className="overflow-hidden">
      <div className="border-b border-white/10 p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-2.5 text-slate-600" />
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t("searchPlaceholder")} className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-[11px] outline-none placeholder:text-slate-700" />
          </div>
          <button type="button" {...immediateButton(openAdd)} className="cursor-pointer select-none rounded-xl bg-white p-2 text-black" title={text("Adicionar node", "Add node")}><Plus size={15} /></button>
        </div>
        <div className="mt-2 flex gap-1">
          {[["ALL", t("allNodes")], ["ACTIVE", t("active")], ["ALIVE", t("aliveFilter")], ["DEAD", t("deadFilter")]].map(([x, labelText]) => (
            <button key={x} type="button" {...immediateButton(() => setStatusFilter(x))} className={`cursor-pointer select-none rounded-lg px-2 py-1 text-[9px] ${statusFilter === x ? "bg-white text-black" : "text-slate-600 hover:bg-white/5"}`}>{labelText}</button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[9px] text-slate-400">
            <option value="ALL">{text("TODAS AS TAGS", "ALL TAGS")}</option>
            {availableTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </select>
          <span className="text-[9px] text-slate-600">{selectedNodeIds.length} {text("selecionados", "selected")}</span>{bulkBusy && <span className="text-[9px] text-sky-300">{text("A processar", "Processing")} {bulkProgress.done}/{bulkProgress.total}</span>}
          <button type="button" {...immediateButton(selectVisibleNodes)} className="cursor-pointer select-none text-[9px] text-sky-300">{text("selecionar visíveis", "select visible")}</button>
          <button type="button" {...immediateButton(clearNodeSelection)} className="cursor-pointer select-none text-[9px] text-slate-500">{text("limpar", "clear")}</button>
        </div>
        {selectedNodeIds.length > 0 && (
          <div className="mt-3 rounded-xl border border-sky-400/10 bg-sky-400/[.03] p-2">
            <div className="mb-2 text-[9px] uppercase tracking-[.14em] text-slate-600">{text("Operações em lote", "Bulk operations")}</div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" disabled={bulkBusy} {...immediateButton(() => void bulkTestSelected())} className="rounded-lg border border-sky-400/20 px-2 py-1.5 text-[9px] text-sky-200">{text("TESTAR SELECIONADOS", "TEST SELECTED")}</button>
              <button type="button" disabled={bulkBusy} {...immediateButton(() => void bulkSetActive(true))} className="rounded-lg border border-emerald-400/20 px-2 py-1.5 text-[9px] text-emerald-200">{text("ATIVAR", "ENABLE")}</button>
              <button type="button" disabled={bulkBusy} {...immediateButton(() => void bulkSetActive(false))} className="rounded-lg border border-amber-400/20 px-2 py-1.5 text-[9px] text-amber-200">{text("DESATIVAR", "DISABLE")}</button>
              <input value={bulkTag} onChange={e => setBulkTag(e.target.value)} placeholder={text("Nova tag…", "New tag…")} className="min-w-[110px] rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[9px] text-white" />
              <button type="button" {...immediateButton(() => void bulkApplyTag())} disabled={!bulkTag.trim() || bulkBusy} className="rounded-lg border border-violet-400/20 px-2 py-1.5 text-[9px] text-violet-200 disabled:opacity-40">{text("APLICAR TAG", "APPLY TAG")}</button>
            </div>
          </div>
        )}
      </div>
      <div className="max-h-[650px] overflow-auto">
        {filtered.map(n => {
          const r = results[n.id];
          const isSel = selected?.id === n.id;
          const checked = selectedNodeIds.includes(n.id);
          return (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                setSelectedId(n.id);
              }}
              onMouseDown={(e) => { if (e.button === 0) e.stopPropagation(); }}
              onClick={(e) => { e.stopPropagation(); setSelectedId(n.id); }}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setSelectedId(n.id); } }}
              className={`w-full cursor-pointer select-none border-b border-white/5 p-3 text-left transition ${isSel ? "bg-sky-400/[.06] ring-inset ring-1 ring-sky-400/10" : "hover:bg-white/[.025]"}`}
              style={{ WebkitAppRegion: "no-drag", touchAction: "manipulation" } as React.CSSProperties}
            >
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={checked} onChange={() => toggleNodeSelection(n.id)} onClick={e => e.stopPropagation()} className="h-3.5 w-3.5 accent-sky-400" />
                <span className={`h-2.5 w-2.5 rounded-full ${r ? (r.alive ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.6)]" : "bg-red-400") : "bg-slate-700"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-white">{n.name}</div>
                  <div className="mt-0.5 truncate text-[9px] text-slate-600">{host(n)} · {n.network || "TODA"}</div>
                </div>
                {busy[n.id] ? <RefreshCw size={12} className="animate-spin text-sky-300" /> : <ChevronRight size={13} className="text-slate-700" />}
              </div>
              <div className="mt-2 flex gap-1.5">
                {n.licenseKey && <Badge>LICENSE</Badge>}
                {n.tags && <Badge>{n.tags.split(",")[0]}</Badge>}
                {r && <span className="ml-auto text-[9px] text-slate-600">{r.totalLatencyMs} ms</span>}
              </div>
            </div>
          );
        })}
        {!filtered.length && <div className="p-8 text-center text-xs text-slate-600">{t("noResults")}</div>}
      </div>
    </Card>
    <div className="space-y-4">{selected ? <><Card className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-base font-semibold">{selected.name}</h2><Badge tone={results[selected.id] ? (results[selected.id].alive ? "good" : "bad") : "neutral"}>{results[selected.id] ? (results[selected.id].alive ? "ALIVE" : "DEAD") : "SEM TESTE"}</Badge></div><div className="mt-1 text-[10px] text-slate-600">{host(selected)} · {selected.network || "TODA"}</div></div><div className="flex gap-2"><button type="button" {...immediateButton(openEdit)} className="cursor-pointer select-none rounded-xl border border-white/10 px-3 py-2 text-[10px] text-slate-300"><Pencil size={12} className="mr-1 inline"/> EDITAR</button><button type="button" {...immediateButton(() => void test(selected))} disabled={busy[selected.id]} className="cursor-pointer select-none rounded-xl bg-white px-3 py-2 text-[10px] font-semibold text-black"><RefreshCw size={12} className={`mr-1 inline ${busy[selected.id] ? "animate-spin" : ""}`}/> TESTAR AGORA</button></div></div><div className="mt-4 grid gap-2 sm:grid-cols-4"><Metric title="Heartbeat" value={String(heartbeat?.heartbeatCount || 0)} icon={HeartPulse} accent="good"/><Metric title={tx("Observado", "Observed")} value={fmtDuration(heartbeat?.observedDurationSeconds)} icon={Clock3}/><Metric title="Uptime" value={heartbeat?.observedUptimePercent != null ? `${heartbeat.observedUptimePercent}%` : "—"} icon={Activity}/><Metric title={tx("Latência", "Latency")} value={results[selected.id]?.totalLatencyMs != null ? `${results[selected.id].totalLatencyMs} ms` : "—"} icon={Zap}/></div></Card><Card className="p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold"> {tx("Diagnóstico dos endpoints", "Endpoint diagnostics")} </h3><span className="text-[9px] text-slate-600"> {tx("consulta ao node e à fonte Tilling", "node and Tilling source query")} </span></div><div className="grid gap-2 sm:grid-cols-2">{["health", "info", "tilling"].map(k => { const r = results[selected.id]?.tests?.[k]; return <div key={k} className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="flex items-center justify-between"><span className="text-[10px] font-medium text-slate-300">/{k}</span><Badge tone={!r ? "neutral" : r.skipped ? "warn" : r.ok ? "good" : "bad"}>{!r ? "—" : r.skipped ? "SKIPPED" : r.ok ? `OK ${r.status || ""}` : `ERROR ${r.status || ""}`}</Badge></div><div className="mt-1 text-[9px] text-slate-600">{r?.latencyMs != null ? `${r.latencyMs} ms · ` : ""}{r?.error || ""}</div></div>; })}</div></Card><Card className="p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold"> {tx("Histórico do node", "Node history")} </h3><p className="text-[10px] text-slate-600">{historyWindow.length} amostras · {rangeLabel}</p></div><div className="flex gap-1 rounded-xl border border-white/5 bg-black/20 p-1">{(["24H", "7D", "30D", "ALL"] as const).map(r => <button key={r} type="button" {...immediateButton(() => setHistoryRange(r))} className={`cursor-pointer select-none rounded-lg px-2 py-1 text-[9px] ${historyRange === r ? "bg-white text-black" : "text-slate-500 hover:bg-white/5"}`}>{r === "ALL" ? "TUDO" : r}</button>)}</div></div>{chart.length ? <><div className="grid gap-4 lg:grid-cols-2"><div><div className="mb-2 text-[9px] uppercase tracking-[.15em] text-slate-600"> {tx("Disponibilidade ALIVE / DEAD", "ALIVE / DEAD availability")} </div><ResponsiveContainer width="100%" height={190}><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)"/><XAxis dataKey="time" stroke="#475569" fontSize={8} minTickGap={28}/><YAxis domain={[0,100]} ticks={[0,100]} stroke="#475569" fontSize={8}/><Tooltip contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, fontSize: 10 }}/><Line type="stepAfter" dataKey="health" name="Estado" stroke="#34d399" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div><div><div className="mb-2 text-[9px] uppercase tracking-[.15em] text-slate-600">{tx("Latência", "Latency")}</div><ResponsiveContainer width="100%" height={190}><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)"/><XAxis dataKey="time" stroke="#475569" fontSize={8} minTickGap={28}/><YAxis domain={[0,"auto"]} stroke="#475569" fontSize={8}/><Tooltip contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, fontSize: 10 }}/><Line type="monotone" dataKey="latency" name="ms" stroke="#a5b4fc" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div></div><div className="mt-3 rounded-xl border border-white/5 bg-black/20 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-[9px] uppercase tracking-[.15em] text-slate-600"> {tx("Linha temporal", "Timeline")} </span><span className="text-[9px] text-slate-600"> {tx("cada bloco = teste/heartbeat", "each block = test/heartbeat")} </span></div><div className="flex h-7 items-stretch gap-[2px] overflow-hidden rounded-lg">{chart.slice(-80).map((x,i) => <div key={i} title={`${x.time} · ${x.status ? "ALIVE" : "DEAD"}`} className={`min-w-[3px] flex-1 rounded-sm ${x.status ? "bg-emerald-400/80" : "bg-red-400/80"}`}/>)}</div></div></> : <div className="flex h-[210px] items-center justify-center text-xs text-slate-600">Sem amostras neste período. Execute <b className="mx-1 text-slate-400">{t("testNow")}</b> ou aguarde o heartbeat automático.</div>}</Card></> : <Card className="p-10 text-center text-xs text-slate-600"> {tx("Selecione ou adicione um node.", "Select or add a node.")} </Card>}</div>
  </div>;

  const immediateButton = (handler: () => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      handler();
    },
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
    },
    style: { WebkitAppRegion: "no-drag", touchAction: "manipulation" } as React.CSSProperties
  });

  const SimpleSource = ({ kind, title, description }: { kind: keyof FleetSources; title: string; description: string }) => <Card className="p-5"><div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-[10px] leading-5 text-slate-600">{description}</p></div><Database size={18} className="text-slate-600"/></div><div className="mt-4 rounded-xl border border-white/5 bg-black/20 p-3"><div className="break-all text-[9px] text-slate-500">{sources[kind] || "Fonte não configurada"}</div></div><button type="button" {...immediateButton(() => { const url = String(sources[kind] || "").trim(); if (!url) { setNotice(`${title}: fonte não configurada.`); setSourceStatus(s => ({ ...s, [kind]: { ok: false, skipped: true, reason: "Fonte não configurada" } })); return; } void api.nodes.sourceRead(kind).then((r: any) => { setSourceStatus(s => ({ ...s, [kind]: r })); setNotice(`${title}: teste concluído.`); }).catch((e: any) => { setSourceStatus(s => ({ ...s, [kind]: { ok: false, error: e instanceof Error ? e.message : String(e) } })); setNotice(`${title}: teste falhou.`); }); })} className="mt-3 cursor-pointer select-none rounded-xl border border-white/10 px-3 py-2 text-[10px] text-slate-300 hover:bg-white/5">TESTAR FONTE</button><pre className="mt-3 max-h-40 overflow-auto text-[9px] text-slate-600">{JSON.stringify(sourceStatus[kind] || {}, null, 2)}</pre></Card>;

  const PlaceholderView = ({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) => <div className="space-y-4"><Card className="p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-white/5 p-2.5 text-sky-300"><Icon size={18}/></div><div><h2 className="text-base font-semibold">{title}</h2><p className="text-[10px] text-slate-600"> {tx("Dados reais serão apresentados apenas quando existir uma fonte autoritativa.", "Real data is shown only when an authoritative source exists.")} </p></div></div></Card>{children}</div>;

  const DiagnosticsView = () => {
    const statusTone = (v: string) => v === "HEALTHY" ? "good" : v === "DEGRADED" ? "warn" : "bad";
    const label = (v: string) => v === "HEALTHY" ? t("healthyStatus") : v === "DEGRADED" ? t("degradedStatus") : t("offlineStatus");
    return <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="flex items-center gap-2"><div className="rounded-xl bg-sky-400/10 p-2 text-sky-300"><Wrench size={18}/></div><div><h2 className="text-base font-semibold"> {tx("Diagnóstico do Node", "Node diagnostics")} </h2><p className="mt-1 text-[10px] leading-5 text-slate-500"> {tx("Teste não-invasivo dos principais serviços: Node, AIM Manager, AIM service e Admin Panel.", "Non-invasive test of the main services: Node, AIM Manager, AIM service and Admin Panel.")} </p></div></div></div>
          <div className="flex gap-2"><button onClick={() => void runDiagnostic()} disabled={!selected || diagnosticBusy} className="rounded-xl bg-white px-4 py-2 text-[10px] font-semibold text-black disabled:opacity-40">{diagnosticBusy ? "A TESTAR…" : "TESTAR NODE"}</button><button onClick={() => void runFleetDiagnostics()} disabled={!nodes.length || fleetDiagnosticsBusy} className="rounded-xl border border-sky-400/20 px-4 py-2 text-[10px] text-sky-200 disabled:opacity-40">{fleetDiagnosticsBusy ? "A TESTAR FROTA…" : "TESTAR FROTA"}</button></div><div className="mt-3">
            <MonitoringControl
              enabled={autoDiagnostics}
              interval={autoDiagnosticInterval}
              language={uiLanguage}
              onToggle={() => {
                const next = !autoDiagnostics;
                setAutoDiagnostics(next);
                localStorage.setItem("nodeManager.autoDiagnostics", next ? "1" : "0");
                setNextAutoDiagnosticAt(next ? new Date(Date.now() + Math.max(10, autoDiagnosticInterval) * 1000).toISOString() : "");
              }}
              onInterval={value => {
                const next = Math.max(10, Math.min(86400, value));
                setAutoDiagnosticInterval(next);
                localStorage.setItem("nodeManager.autoDiagnosticInterval", String(next));
                setNextAutoDiagnosticAt(autoDiagnostics ? new Date(Date.now() + next * 1000).toISOString() : "");
              }}
              onRunNow={() => void runAutoDiagnostics()}
              countdown={autoCountdownLabel}
              runs={autoDiagnosticRuns}
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2"><div className="text-[8px] uppercase tracking-wider text-slate-600">{tx("Monitorização", "Monitoring")}</div><div className="mt-1 text-xs font-semibold text-slate-200">{enabledLabel(autoDiagnostics, uiLanguage)}</div></div>
              <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2"><div className="text-[8px] uppercase tracking-wider text-slate-600">{tx("Intervalo", "Interval")}</div><div className="mt-1 text-xs font-semibold text-sky-200">{autoDiagnosticInterval < 60 ? `${autoDiagnosticInterval}s` : `${Math.round(autoDiagnosticInterval / 60)}m`}</div></div>
              <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2"><div className="text-[8px] uppercase tracking-wider text-slate-600">{tx("Execuções", "Runs")}</div><div className="mt-1 text-xs font-semibold text-slate-200">{autoDiagnosticRuns}</div></div>
              <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2"><div className="text-[8px] uppercase tracking-wider text-slate-600">{tx("Próxima", "Next")}</div><div className="mt-1 text-xs font-semibold text-slate-200">{autoDiagnostics ? (autoCountdownLabel || "—") : "—"}</div></div>
            </div>
          </div>
        </div>
        {selected && <div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric title="Node selecionado" value={selected.name} sub={host(selected)} icon={Server}/><Metric title="Rede" value={selected.network || "TODA"} sub={`Node :${selected.apiPort || (selected.network === "BASE" ? "8010" : "8000")}`} icon={Network}/><Metric title="Resultado" value={diagnostic ? label(diagnostic.overall) : "AGUARDA"} sub={diagnostic ? `${diagnostic.summary.passed} OK · ${diagnostic.summary.failed} falhas · ${diagnostic.summary.skipped} ignorados` : "Execute um diagnóstico"} icon={Activity} accent={diagnostic ? statusTone(diagnostic.overall) as any : "normal"}/></div>}
      </Card>
      {diagnostic && <Card className="overflow-hidden p-0"><div className="flex items-center justify-between border-b border-white/10 p-4"><div><h3 className="text-sm font-semibold"> {tx("Resultado detalhado", "Detailed result")} </h3><p className="text-[10px] text-slate-500">{selected?.name} · {shortDate(diagnostic.testedAt, uiLanguage === "en" ? "en-US" : "pt-PT")}</p></div><Badge tone={statusTone(diagnostic.overall) as any}>{label(diagnostic.overall)}</Badge></div><div className="divide-y divide-white/5">{diagnostic.checks.map((c:any) => <div key={c.key} className="flex flex-wrap items-center gap-3 p-4"><div className="w-5">{c.skipped ? <span className="text-slate-600">—</span> : c.ok ? <CheckCircle2 size={17} className="text-emerald-300"/> : <XCircle size={17} className="text-red-300"/>}</div><div className="min-w-[190px] flex-1"><div className="text-xs font-medium text-slate-200">{c.label}</div><div className="mt-1 text-[9px] text-slate-600 truncate">{c.url || c.error}</div></div><div className="text-[10px] text-slate-500">{c.skipped ? "NÃO CONFIGURADO" : c.status != null ? `HTTP ${c.status}` : c.error || "sem resposta"}</div><div className="w-20 text-right text-[10px] text-slate-500">{c.latencyMs != null ? `${c.latencyMs} ms` : "—"}</div></div>)}</div></Card>}
      {fleetDiagnostics.length > 0 && <>
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold">{tx("Cobertura dos endpoints", "Endpoint coverage")}</h3><p className="mt-1 text-[9px] text-slate-600">{tx("Métricas calculadas apenas a partir dos diagnósticos reais executados.", "Metrics calculated only from real diagnostics that were executed.")}</p></div>
            <Badge tone={diagnosticAnalytics.coverage >= 90 ? "good" : diagnosticAnalytics.coverage >= 70 ? "warn" : "bad"}>{diagnosticAnalytics.coverage}% {tx("OK observado", "observed OK")}</Badge>
          </div>
          <div className="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
            <Metric title="TESTES" value={String(diagnosticAnalytics.total)} sub={tx("não ignorados", "not skipped")} icon={Gauge}/>
            <Metric title="OK" value={String(diagnosticAnalytics.passed)} sub={tx("respostas válidas", "valid responses")} icon={CheckCircle2} accent="good"/>
            <Metric title="FALHAS" value={String(diagnosticAnalytics.failed)} sub={tx("observadas", "observed")} icon={XCircle} accent="bad"/>
            <Metric title="IGNORADOS" value={String(diagnosticAnalytics.skipped)} sub={tx("não configurados", "not configured")} icon={Wrench} accent="warn"/>
            {diagnosticAnalytics.stats.map(x => <div key={x.key} className="rounded-2xl border border-white/10 bg-white/[.025] p-3"><div className="text-[9px] uppercase tracking-[.12em] text-slate-500">/{x.key}</div><div className="mt-2 text-sm font-semibold text-white">{x.ok}/{x.samples}</div><div className="mt-1 text-[9px] text-slate-600">{x.avgLatency != null ? `${x.avgLatency} ms avg` : tx("sem latência", "no latency")}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-emerald-400" style={{width:`${x.samples ? Math.round(x.ok / x.samples * 100) : 0}%`}}/></div></div>)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold">{tx("Matriz de fiabilidade dos endpoints", "Endpoint reliability matrix")}</h3><p className="mt-1 text-[9px] text-slate-600">{tx("Comparação das respostas observadas por endpoint. Ignorados não entram na fiabilidade.", "Comparison of observed responses by endpoint. Skipped checks are excluded from reliability.")}</p></div><Badge>{tx("Somente observado", "Observed only")}</Badge>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-5">
            {diagnosticAnalytics.endpointReliability.map(x => <div key={x.key} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between"><span className="text-[9px] font-medium text-slate-300">/{x.key}</span><span className={`text-[10px] font-semibold ${x.reliability == null ? "text-slate-600" : x.reliability >= 90 ? "text-emerald-300" : x.reliability >= 70 ? "text-amber-300" : "text-red-300"}`}>{x.reliability == null ? "—" : `${x.reliability}%`}</span></div><div className="mt-2 flex justify-between text-[8px] text-slate-600"><span>{x.ok} OK · {x.failed} {tx("falhas", "failures")}</span><span>{x.avgLatency != null ? `${x.avgLatency} ms` : "—"}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-sky-400/70" style={{width:`${x.reliability ?? 0}%`}}/></div></div>)}
          </div>
        </Card>
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
            <div><h3 className="text-sm font-semibold">{tx("Fila de intervenção", "Intervention queue")}</h3><p className="mt-1 text-[9px] text-slate-600">{tx("Prioridade criada somente com base no último diagnóstico observado. Nenhuma ação é executada automaticamente.", "Priority is based only on the latest observed diagnostic. No action is executed automatically.")}</p></div>
            <div className="flex flex-wrap items-center gap-2"><Badge tone="bad">{diagnosticCommandQueue.filter(x => x.priority === "CRITICAL").length} {tx("críticos", "critical")}</Badge><Badge tone="warn">{diagnosticCommandQueue.filter(x => x.priority !== "CRITICAL").length} {tx("atenção", "attention")}</Badge><button type="button" onPointerDown={e => { if(e.button===0){e.preventDefault();e.stopPropagation();void runInterventionSweep();}}} onClick={e => {e.preventDefault();e.stopPropagation();}} disabled={!diagnosticCommandQueue.length || fleetDiagnosticsBusy} className="cursor-pointer rounded-lg border border-sky-400/20 px-3 py-1.5 text-[9px] text-sky-200 disabled:opacity-40" style={{WebkitAppRegion:"no-drag",touchAction:"manipulation"} as React.CSSProperties}>{fleetDiagnosticsBusy ? tx("A testar…", "Testing…") : tx("TESTAR INTERVENÇÃO", "RUN INTERVENTION SWEEP")}</button></div>
          </div>
          {diagnosticCommandQueue.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[10px]"><thead className="bg-black/20 text-slate-500"><tr><th className="p-3">Node</th><th className="p-3">{tx("Prioridade", "Priority")}</th><th className="p-3">{tx("Motivo", "Reason")}</th><th className="p-3">{tx("Falhas", "Failures")}</th><th className="p-3">{tx("Latência", "Latency")}</th><th className="p-3">{tx("Ação", "Action")}</th></tr></thead><tbody>{diagnosticCommandQueue.map(x => <tr key={x.d.nodeId} className="border-t border-white/5"><td className="p-3 font-medium text-slate-200">{x.n?.name || x.d.nodeId}</td><td className="p-3"><Badge tone={x.priority === "CRITICAL" ? "bad" : "warn"}>{x.priority}</Badge></td><td className="p-3 text-slate-400">{tx(x.reason, x.reason)}</td><td className="p-3 text-red-300">{x.failed}</td><td className="p-3 text-slate-400">{x.latency != null ? `${x.latency} ms` : "—"}</td><td className="p-3"><button type="button" onPointerDown={async e => { if(e.button===0){e.preventDefault();e.stopPropagation();if(x.n){setSelectedId(x.n.id);setDiagnosticBusy(true);try{setDiagnostic(await api.nodes.diagnose(x.n));}catch(e){setDiagnostic({overall:"OFFLINE",checks:[],summary:{passed:0,failed:1,skipped:0},error:e instanceof Error?e.message:String(e)});}finally{setDiagnosticBusy(false);}}}}} onClick={e => {e.preventDefault();e.stopPropagation();}} className="cursor-pointer rounded-lg border border-sky-400/20 px-3 py-1.5 text-[9px] text-sky-200" style={{WebkitAppRegion:"no-drag",touchAction:"manipulation"} as React.CSSProperties}>{tx("TESTAR AGORA", "TEST NOW")}</button></td></tr>)}</tbody></table></div> : <div className="p-8 text-center text-xs text-slate-600">{tx("Nenhum node requer intervenção neste diagnóstico.", "No node currently requires intervention in this diagnostic.")}</div>}
        </Card>
        <Card className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">{tx("Resumo da monitorização da frota", "Fleet monitoring snapshot")}</h3><p className="mt-1 text-[9px] text-slate-600">{tx("Estado baseado no último diagnóstico real de cada node.", "Status based on the latest real diagnostic for each node.")}</p></div><button type="button" onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); void runFleetDiagnostics(); } }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} disabled={fleetDiagnosticsBusy} className="cursor-pointer rounded-lg border border-sky-400/20 px-3 py-2 text-[9px] text-sky-200 disabled:opacity-40">{fleetDiagnosticsBusy ? tx("A testar…", "Testing…") : tx("Atualizar frota", "Refresh fleet")}</button></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric title="TOTAL" value={String(fleetDiagnostics.length)} sub={tx("diagnosticados", "diagnosed")} icon={Server}/><Metric title="SAUDÁVEIS" value={String(fleetDiagnostics.filter((d:any)=>d.overall==="HEALTHY").length)} sub="HEALTHY" icon={CheckCircle2} accent="good"/><Metric title="DEGRADADOS" value={String(fleetDiagnostics.filter((d:any)=>d.overall==="DEGRADED").length)} sub="DEGRADED" icon={Activity} accent="warn"/><Metric title="OFFLINE" value={String(fleetDiagnostics.filter((d:any)=>d.overall!=="HEALTHY" && d.overall!=="DEGRADED").length)} sub="OFFLINE" icon={XCircle} accent="bad"/></div></Card><Card className="overflow-hidden p-0"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4"><div><h3 className="text-sm font-semibold"> {tx("Diagnóstico da frota", "Fleet diagnostics")} </h3><p className="text-[10px] text-slate-500">{filteredFleetDiagnostics.length} de {fleetDiagnostics.length} nodes · verificação paralela.</p></div><div className="flex gap-1.5">{([["ALL","TODOS"],["PROBLEMS","PROBLEMAS"],["HEALTHY","SAUDÁVEIS"]] as const).map(([key,labelText]) => <button key={key} type="button" {...immediateButton(() => setDiagnosticFilter(key))} aria-pressed={diagnosticFilter===key} className={`cursor-pointer select-none rounded-lg border px-2.5 py-1.5 text-[9px] ${diagnosticFilter===key ? "border-sky-400/30 bg-sky-400/10 text-sky-200" : "border-white/10 text-slate-500 hover:bg-white/5"}`}>{labelText}</button>)}</div></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[10px]"><thead className="bg-black/20 text-slate-500"><tr><th className="p-3">Node</th><th className="p-3"> {tx("Estado", "Status")} </th><th className="p-3">OK</th><th className="p-3">{tx("Falhas", "Failures")}</th><th className="p-3">{tx("Ignorados", "Skipped")}</th><th className="p-3">{tx("Cobertura", "Coverage")}</th><th className="p-3">{tx("Latência", "Latency")}</th><th className="p-3">{tx("Testado", "Tested")}</th></tr></thead><tbody>{filteredFleetDiagnostics.map((d:any) => { const n=nodes.find(x=>x.id===d.nodeId); return <tr key={d.nodeId} onClick={() => {setSelectedId(d.nodeId); setDiagnostic(d);}} className="cursor-pointer border-t border-white/5 hover:bg-white/[.03]"><td className="p-3 text-slate-200">{n?.name || d.nodeId}</td><td className="p-3"><Badge tone={statusTone(d.overall) as any}>{label(d.overall)}</Badge></td><td className="p-3 text-emerald-300">{d.summary.passed}</td><td className="p-3 text-red-300">{d.summary.failed}</td><td className="p-3 text-slate-500">{d.summary.skipped}</td><td className="p-3 text-sky-200">{(d.summary.passed + d.summary.failed) ? `${Math.round(d.summary.passed / (d.summary.passed + d.summary.failed) * 100)}%` : "—"}</td><td className="p-3 text-slate-400">{d.totalLatencyMs != null ? `${d.totalLatencyMs} ms` : "—"}</td><td className="p-3 text-slate-600">{shortDate(d.testedAt)}</td></tr>})}</tbody></table></div></Card></>}
    </div>;
  };

  const tabContent = tab === "overview" ? <Overview/> : tab === "nodes" ? <NodesView/> : tab === "licenses" ? <div className="space-y-4"><Card className="overflow-hidden p-0"><div className="border-b border-white/10 bg-gradient-to-r from-sky-400/[.08] via-transparent to-indigo-400/[.06] p-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2"><div className="rounded-xl bg-sky-400/10 p-2 text-sky-300"><ShieldCheck size={18}/></div><div><h2 className="text-base font-semibold">HyperCycle Explorer</h2><p className="text-[10px] text-slate-500"> {tx("Dados históricos da licença diretamente da fonte pública da HyperCycle.", "License history directly from the public HyperCycle source.")} </p></div></div></div><button onClick={() => explorerLicense && void openExternal(`https://explorer.hypercycle.ai/license/${encodeURIComponent(explorerLicense)}`)} disabled={!explorerLicense} className="rounded-xl border border-white/10 px-3 py-2 text-[10px] text-slate-300 disabled:opacity-40"><ExternalLink size={12} className="mr-1 inline"/> ABRIR NO EXPLORER</button><button onClick={() => void refreshExplorerFleet()} disabled={explorerFleetBusy || !nodes.some(n => n.licenseKey)} className="rounded-xl border border-sky-400/20 px-3 py-2 text-[10px] text-sky-200 disabled:opacity-40"><RefreshCw size={12} className={`mr-1 inline ${explorerFleetBusy ? "animate-spin" : ""}`}/> {t("refreshFleet")}</button></div><div className="mt-5 flex flex-col gap-2 sm:flex-row"><input value={explorerLicense} onChange={e => setExplorerLicense(e.target.value.replace(/\D/g, ""))} placeholder="Número da licença (ex.: 8796629893134)" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white outline-none focus:border-sky-400/40"/><button disabled={explorerBusy || !explorerLicense} onClick={async () => { setExplorerBusy(true); setExplorerError(""); try { setExplorerData(await api.nodes.explorerLicense(explorerLicense)); } catch (e) { setExplorerData(null); setExplorerError(e instanceof Error ? e.message : String(e)); } finally { setExplorerBusy(false); } }} className="rounded-xl bg-white px-5 py-3 text-[10px] font-semibold text-black disabled:opacity-40">{explorerBusy ? "A CONSULTAR…" : "CONSULTAR LICENÇA"}</button></div>{explorerError && <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-[10px] text-red-300">{explorerError}</div>}</div>{explorerData ? <div className="p-5"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><div className="text-lg font-semibold text-white">Licença {maskNumber(explorerData.license, hideNumbers)}</div><div className="mt-1 text-[10px] text-slate-500">{explorerData.network || "HyperCycle"}{explorerData.level ? ` · Level ${explorerData.level}` : ""} · atualizado {shortDate(explorerData.fetchedAt)}</div></div><Badge tone={String(explorerData.status).toLowerCase() === "alive" ? "good" : "neutral"}>{explorerData.status || "SEM ESTADO"}</Badge></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric title="Tempo total" value={explorerData.totalHours != null ? `${explorerData.totalHours.toLocaleString("pt-PT")} h` : "—"} sub="Explorer" icon={Clock3}/><Metric title="Uptime" value={explorerData.upHours != null ? `${explorerData.upHours.toLocaleString("pt-PT")} h` : "—"} sub={explorerData.upPercent != null ? `${Number(explorerData.upPercent).toLocaleString(uiLanguage === "en" ? "en-US" : "pt-PT", { maximumFractionDigits: 2 })}% online` : ""} icon={Activity} accent="good"/><Metric title="Downtime" value={explorerData.downHours != null ? `${explorerData.downHours.toLocaleString("pt-PT")} h` : "—"} sub="histórico do Explorer" icon={XCircle} accent="warn"/><Metric title="Heartbeats" value={explorerData.heartbeat != null ? explorerData.heartbeat.toLocaleString("pt-PT") : "—"} sub="contador reportado" icon={HeartPulse} accent="good"/></div><div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><Card className="p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold"> {tx("Uptime histórico", "Historical uptime")} </h3><p className="text-[10px] text-slate-500"> {tx("Valor histórico fornecido pelo HyperCycle Explorer.", "Historical value provided by HyperCycle Explorer.")} </p></div><Badge tone="good">{t("realData")}</Badge></div><div className="h-4 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.max(0, Math.min(100, explorerData.upPercent ?? 0))}%` }}/></div><div className="mt-3 flex justify-between text-[10px]"><span className="text-emerald-300">{explorerData.upPercent ?? "—"}% uptime</span><span className="text-slate-500">{explorerData.downHours != null ? `${explorerData.downHours.toLocaleString("pt-PT")} h downtime` : "—"}</span></div></Card><Card className="p-4"><Info label="Chain" value={explorerData.chain || "—"}/><Info label="Block" value={explorerData.block || "—"}/><Info label="CHyPC" value={explorerData.chypc != null ? explorerData.chypc.toLocaleString("pt-PT") : "—"}/><Info label="Fonte" value="HyperCycle Explorer"/></Card></div><Card className="mt-4 overflow-hidden p-0"><div className="border-b border-white/10 p-4"><h3 className="text-sm font-semibold"> {tx("Histórico de uptime / heartbeat", "Uptime / heartbeat history")} </h3><p className="text-[10px] text-slate-500"> {tx("Registos históricos disponíveis na página da licença.", "Historical records available on the license page.")} </p></div>{explorerData.reports?.length ? <div className="max-h-[360px] overflow-auto"><table className="w-full text-left text-[10px]"><thead className="sticky top-0 bg-[#0d1117] text-slate-500"><tr><th className="p-3"> {tx("Estado", "Status")} </th><th className="p-3">Node</th><th className="p-3">{tx("Versão", "Version")}</th><th className="p-3">{tx("Timestamp", "Timestamp")}</th></tr></thead><tbody>{explorerData.reports.map((r:any,i:number) => <tr key={i} className="border-t border-white/5"><td className="p-3"><Badge tone={/alive/i.test(r.status||"") ? "good" : "bad"}>{r.status || "—"}</Badge></td><td className="p-3 text-slate-300">{r.name || "—"}</td><td className="p-3 text-slate-500">{r.version || "—"}</td><td className="p-3 text-slate-500">{r.timestamp || "—"}</td></tr>)}</tbody></table></div> : <div className="p-8 text-center text-xs text-slate-600">{tx("O Explorer devolveu os totais, mas não foi possível estruturar a tabela de eventos desta consulta.", "Explorer returned totals, but the event table could not be structured from this query.")}</div>}</Card>{explorerData.billingLines?.length ? <Card className="mt-4 overflow-hidden p-0"><div className="border-b border-white/10 p-4"><h3 className="text-sm font-semibold"> {tx("Billing histórico", "Historical billing")} </h3><p className="text-[10px] text-slate-500"> {tx("Informação de billing encontrada na resposta pública do Explorer.", "Billing information found in the public Explorer response.")} </p></div><div className="max-h-[260px] overflow-auto p-4">{explorerData.billingLines.map((line:string,i:number) => <div key={i} className="border-b border-white/5 py-2 text-[10px] text-slate-400">{line}</div>)}</div></Card> : null}</div> : <div className="p-8 text-center text-xs text-slate-600"> {tx("Introduza o número da licença para carregar os dados históricos reais do HyperCycle Explorer.", "Enter the license number to load real historical data from HyperCycle Explorer.")} </div>}</Card><div className="grid gap-4 lg:grid-cols-2"><Card className="p-5"><Info label="Licenças locais" value={String(nodes.filter(n => n.licenseKey).length)}/><Info label="Capacidade máxima local" value="500 nodes"/><Info label="Unlock" value="Fonte oficial / ação explícita"/></Card><SimpleSource kind="licensesUrl" title="Outras fontes de licença / Factory" description="Mantemos esta fonte configurável para futuras APIs autoritativas de fábrica."/></div></div> : tab === "aims" ? <div className="space-y-4">
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2"><div className="rounded-xl bg-sky-400/10 p-2 text-sky-300"><Zap size={18}/></div><div><h2 className="text-base font-semibold">AIM Manager</h2><p className="mt-1 text-[10px] leading-5 text-slate-500"> {tx("Integração baseada nas operações REST documentadas pelo Node Manager oficial da HyperCycle.", "Integration based on REST operations documented by the official HyperCycle Node Manager.")} </p></div></div></div>
        <Badge tone={aimManagerInfo?.error ? "bad" : "good"}>{aimManagerInfo?.error ? "ERRO" : "API :8005 CONFIGURADA"}</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="Node" value={selected?.name || "—"} sub={selected ? host(selected) : ""} icon={Server}/>
        <Metric title="AIM Manager" value={aimManagerInfo?.port || selected?.aimManagerPort || "8005"} sub={tx("API oficial documentada", "Documented official API")} icon={Network} accent="good"/>
        <Metric title="AIM port" value={selected?.aimPort || "9000"} sub="primeira porta recomendada" icon={Zap}/>
        <Metric title="Slot" value={String(selected?.aimSlot ?? 0)} sub="configuração local" icon={Database}/>
      </div>
    </Card>

    <Card className="p-5 border-sky-400/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold">{t("aimPreflight")}</h3><p className="mt-1 text-[10px] leading-5 text-slate-500">{t("aimPreflightHint")}</p></div>
        <button type="button" {...immediateButton(() => void runAimPreflight())} disabled={!selected || aimActionBusy} className="cursor-pointer select-none rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-[9px] font-semibold text-sky-200 disabled:opacity-40">{t("testAimConnection")}</button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Badge tone={selected ? "good" : "neutral"}>Node {selected ? host(selected) : "—"}</Badge>
        <Badge tone="good">AIM Manager :{selected?.aimManagerPort || "8005"}</Badge>
        <Badge tone="neutral">AIM service :{selected?.aimPort || "9000"}</Badge>
      </div>
    </Card>

    <Card className="p-5 border-amber-400/10">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">{t("aimLab")}</h3><p className="mt-1 text-[10px] leading-5 text-slate-500">{t("aimLabHint")}</p></div><Badge tone="warn">{t("protectedAction")}</Badge></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="text-[9px] text-slate-500">{t("endpoint")}</div><div className="mt-1 text-[10px] text-slate-300">POST /add_aim</div><div className="mt-1 text-[8px] text-slate-600">{t("protectedAction")}</div></div>
        <div className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="text-[9px] text-slate-500">{t("endpoint")}</div><div className="mt-1 text-[10px] text-slate-300">POST /retry_aim/&lt;slot&gt;</div><div className="mt-1 text-[8px] text-slate-600">{t("protectedAction")}</div></div>
        <div className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="text-[9px] text-slate-500">{t("endpoint")}</div><div className="mt-1 text-[10px] text-slate-300">POST /remove_aim/&lt;slot&gt;</div><div className="mt-1 text-[8px] text-slate-600">{t("protectedAction")}</div></div>
      </div>
      <div className="mt-3 rounded-xl border border-sky-400/10 bg-sky-400/[.03] p-3 text-[9px] leading-5 text-slate-500">{tx("A V72 não executa operações destrutivas em modo de auditoria. Primeiro use PRE-FLIGHT; só depois, conscientemente, uma operação real.","V72 does not execute destructive operations in audit mode. Use PRE-FLIGHT first; only then, consciously, a real operation.")}</div>
    </Card>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold">Deploy AIM</h3><p className="mt-1 text-[10px] text-slate-500"> {tx("Operação real: POST /add_aim. Não é executada automaticamente.", "Real operation: POST /add_aim. It is not executed automatically.")} </p></div><Badge>REST</Badge></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-[10px] text-slate-500">Name<input value={aimDeployForm.name} onChange={e => setAimDeployForm({...aimDeployForm,name:e.target.value})} placeholder="ollama" className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-2.5 text-[11px] text-white"/></label>
          <label className="text-[10px] text-slate-500">Tag / versão<input value={aimDeployForm.tag} onChange={e => setAimDeployForm({...aimDeployForm,tag:e.target.value})} placeholder="0.1.0" className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-2.5 text-[11px] text-white"/></label>
          <label className="text-[10px] text-slate-500">Porta<input type="number" value={aimDeployForm.port} onChange={e => setAimDeployForm({...aimDeployForm,port:Number(e.target.value)})} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-2.5 text-[11px] text-white"/></label>
        </div>
        <button disabled={!selected || aimActionBusy} onClick={() => void runAimAction("deploy")} className="mt-4 rounded-xl bg-white px-4 py-2.5 text-[10px] font-semibold text-black disabled:opacity-40">{aimActionBusy ? "A EXECUTAR…" : "DEPLOY AIM"}</button>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold"> {tx("Lifecycle do AIM", "AIM lifecycle")} </h3><p className="mt-1 text-[10px] text-slate-500"> {tx("Operações documentadas: POST /retry_aim/&lt;slot&gt; e POST /remove_aim/&lt;slot&gt;.", "Documented operations: POST /retry_aim/&lt;slot&gt; and POST /remove_aim/&lt;slot&gt;.")} </p></div><Badge> {tx("CONTROLADO", "CONTROLLED")} </Badge></div>
        <label className="mt-4 block text-[10px] text-slate-500">AIM slot<input type="number" min="0" value={aimSlotInput} onChange={e => setAimSlotInput(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-2.5 text-[11px] text-white"/></label>
        <div className="mt-3 flex flex-wrap gap-2"><button disabled={!selected || aimActionBusy} onClick={() => void runAimAction("retry")} className="rounded-xl border border-white/10 px-3 py-2 text-[10px] text-slate-300 disabled:opacity-40">{t("retryAim")}</button><button disabled={!selected || aimActionBusy} onClick={() => { if (confirm(`Remover o AIM do slot ${aimSlotInput} no node ${selected?.name || ""}?`)) void runAimAction("remove"); }} className="rounded-xl border border-red-400/20 px-3 py-2 text-[10px] text-red-300 disabled:opacity-40">{t("removeAim")}</button></div>
      </Card>
    </div>

    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">{tx("Capacidades AIM Manager", "AIM Manager capabilities")}</h3><p className="mt-1 text-[10px] text-slate-500">{tx("O que podemos testar agora, o que exige ação real e o que não está disponível sem uma API documentada.", "What we can test now, what requires a real action, and what is unavailable without a documented API.")}</p></div><Badge tone={aimManagerInfo?.error ? "warn" : "good"}>{aimManagerInfo?.error ? "AGUARDA CONEXÃO" : "PREPARADO"}</Badge></div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {[
          ["PRE-FLIGHT", "Verifica Node + AIM Manager + AIM service", "SEGURO"],
          ["DEPLOY", "POST /add_aim · instala um AIM", "AÇÃO REAL"],
          ["RETRY", "POST /retry_aim/<slot> · repete uma operação", "AÇÃO REAL"],
          ["REMOVE", "POST /remove_aim/<slot> · remove o AIM do slot", "AÇÃO REAL"],
          ["LISTAGEM", "Não existe endpoint documentado no conjunto atual", "NÃO DISPONÍVEL"],
          ["DRY RUN", "Pré-visualização dos parâmetros antes da operação", "SEGURO"],
        ].map(([name, detail, mode]) => <div key={name} className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold text-slate-200">{name}</span><Badge tone={mode === "SEGURO" ? "good" : mode === "AÇÃO REAL" ? "warn" : "neutral"}>{mode}</Badge></div><div className="mt-2 text-[9px] leading-4 text-slate-500">{detail}</div></div>)}
      </div>
      <div className="mt-3 rounded-xl border border-sky-400/10 bg-sky-400/[.03] p-3 text-[9px] leading-5 text-slate-500">{selected ? <>Node selecionado: <b className="text-slate-300">{selected.name}</b> · Manager :{selected.aimManagerPort || "8005"} · AIM :{selected.aimPort || "9000"}. Faça primeiro o <b className="text-sky-200">PRE-FLIGHT</b>; só depois execute Deploy/Retry/Remove.</> : <>{tx("Selecione um node para activar a preparação do AIM Manager.", "Select a node to enable AIM Manager preparation.")}</>}</div>
    </Card>

    <Card className="p-5">
      <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">API AIM Manager</h3><p className="mt-1 text-[10px] text-slate-500"> {tx("Endpoints importados diretamente da documentação fornecida. O Node Manager não chama endpoints de listagem não documentados.", "Endpoints imported directly from the supplied documentation. Node Manager does not call undocumented listing endpoints.")} </p></div><button onClick={() => void refreshAimManagerInfo()} className="rounded-xl border border-white/10 px-3 py-2 text-[10px]">{t("update")}</button></div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {(aimManagerInfo?.documentedEndpoints || ["/add_aim","/remove_aim/<aim_slot>","/retry_aim/<aim_slot>"]).map((ep:string) => <div key={ep} className="rounded-xl border border-white/5 bg-black/20 p-3 font-mono text-[10px] text-sky-200">{ep}</div>)}
      </div>
      {aimActionResult && <pre className={`mt-4 max-h-56 overflow-auto rounded-xl border p-3 text-[9px] ${aimActionResult.ok ? "border-emerald-400/10 text-emerald-200" : "border-red-400/10 text-red-300"}`}>{JSON.stringify(aimActionResult, null, 2)}</pre>}
    </Card>
  </div> : tab === "diagnostics" ? <DiagnosticsView/> : tab === "tilling" ? <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/10 bg-gradient-to-r from-emerald-400/[.07] via-transparent to-sky-400/[.06] p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><div className="flex items-center gap-2"><div className="rounded-xl bg-emerald-400/10 p-2 text-emerald-300"><BarChart3 size={18}/></div><div><h2 className="text-base font-semibold">Performance & Tilling</h2><p className="text-[10px] text-slate-500"> {tx("Dados reais disponíveis + métricas observadas localmente, sem inventar valores de Computation/Reputation.", "Real data available + locally observed metrics, without inventing Computation/Reputation values.")} </p></div></div></div>
            <div className="flex gap-2"><button onClick={() => void testAll()} className="rounded-xl border border-white/10 px-3 py-2 text-[10px] text-slate-300"><Gauge size={12} className="mr-1 inline"/>{t("testFleet")}</button><button type="button" {...immediateButton(() => void refreshExplorerFleet())} disabled={explorerFleetBusy} className="cursor-pointer select-none rounded-xl border border-sky-400/20 px-3 py-2 text-[10px] text-sky-200 disabled:opacity-40"><RefreshCw size={12} className={`mr-1 inline ${explorerFleetBusy ? "animate-spin" : ""}`}/> ATUALIZAR DADOS</button><button type="button" {...immediateButton(() => { const lic = String(selected?.licenseKey || explorerLicense || "").trim(); if (!lic) { setNotice("Selecione um node com licença para investigar a fonte."); return; } setSourceInspectionBusy(true); void api.nodes.explorerSourceInspect(lic).then(r => { setSourceInspection(r); setNotice("Inspeção do Explorer concluída."); }).catch(e => { setSourceInspection(null); setNotice(e instanceof Error ? e.message : String(e)); }).finally(() => setSourceInspectionBusy(false)); })} disabled={sourceInspectionBusy || !nodes.some(n => n.licenseKey)} className="cursor-pointer select-none rounded-xl border border-violet-400/20 px-3 py-2 text-[10px] text-violet-200 disabled:opacity-40"><Search size={12} className={`mr-1 inline ${sourceInspectionBusy ? "animate-pulse" : ""}`}/> {sourceInspectionBusy ? "A INVESTIGAR…" : "INVESTIGAR FONTE"}</button></div>
          </div>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric title={tx("Uptime observado", "Observed uptime")} value={selected && analytics?.uptime24h?.[selected.id] != null ? `${analytics.uptime24h[selected.id]}%` : "—"} sub={tx("últimas 24 horas · testes locais", "last 24 hours · local tests")} icon={Activity} accent="good"/>
          <Metric title="Uptime Explorer" value={selected && explorerFleet[String(selected.licenseKey || "").trim()]?.upPercent != null ? `${Number(explorerFleet[String(selected.licenseKey || "").trim()].upPercent).toLocaleString(uiLanguage === "en" ? "en-US" : "pt-PT", { maximumFractionDigits: 2 })}%` : "—"} sub={tx("dado histórico da licença", "license historical data")} icon={ShieldCheck} accent="good"/>
          <Metric title="Computation" value={selected ? String(explorerFleet[String(selected.licenseKey || '').trim()]?.computation ?? "—") : "—"} sub={selected && explorerFleet[String(selected.licenseKey || '').trim()]?.computation != null ? "fonte recebida" : "aguarda fonte autoritativa"} icon={Cpu}/><Metric title="Reputation" value={selected ? String(explorerFleet[String(selected.licenseKey || '').trim()]?.reputation ?? "—") : "—"} sub={selected && explorerFleet[String(selected.licenseKey || '').trim()]?.reputation != null ? "fonte recebida" : "aguarda fonte autoritativa"} icon={Network}/><Metric title="Tilling" value={selected ? (results[selected.id]?.tilling?.status || "—") : "—"} sub={selected && results[selected.id]?.tilling?.latencyMs != null ? `${results[selected.id].tilling?.latencyMs} ms · API real` : "teste ao executar TEST FLEET/NODE"} icon={BarChart3} accent={selected && results[selected.id]?.tilling?.ok ? "good" : "neutral"}/></div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/10 bg-black/20 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">Tilling API — Estado da licença</h2><p className="mt-1 text-[10px] text-slate-500">Consulta real feita pelo TEST NODE / TEST FLEET através do License configurado em cada node.</p></div>{selected && results[selected.id]?.tilling?.ok ? <Badge tone="good">API ONLINE</Badge> : selected && results[selected.id]?.tilling?.error ? <Badge tone="bad">SEM RESPOSTA</Badge> : <Badge>{selected ? "EXECUTAR TESTE" : "SEM NODE"}</Badge>}</div></div>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Metric title="Status" value={selected ? (results[selected.id]?.tilling?.status || "—") : "—"} sub="license_status" icon={HeartPulse} accent={selected && results[selected.id]?.tilling?.ok ? "good" : "neutral"}/>
          <Metric title="Status Since" value={selected ? (results[selected.id]?.tilling?.statusSince ? shortDate(results[selected.id].tilling!.statusSince!, uiLanguage === "en" ? "en-US" : "pt-PT") : "—") : "—"} sub="fonte Tilling" icon={Clock3}/>
          <Metric title="Latência" value={selected && results[selected.id]?.tilling?.latencyMs != null ? `${results[selected.id].tilling!.latencyMs} ms` : "—"} sub="HTTP API" icon={Gauge}/>
        </div>
        {selected && tillingFailureReason(results[selected.id]?.tilling) && <div className="border-t border-amber-400/10 bg-amber-400/[.03] px-4 py-3 text-[10px] leading-5 text-amber-200">{tillingFailureReason(results[selected.id]?.tilling)}</div>}
        {selected && results[selected.id]?.tilling?.error && <div className="border-t border-red-400/10 bg-red-400/[.03] px-4 py-3 text-[10px] text-red-300">Tilling: {results[selected.id].tilling!.error}</div>}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/10 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold"> {tx("Performance por Node", "Performance by Node")} </h2><p className="text-[10px] text-slate-600"> {tx("Comparação entre o que o Node Manager observa e o que o Explorer reporta.", "Comparison between what Node Manager observes and what Explorer reports.")} </p></div><Badge tone="good">{t("noEstimates")}</Badge></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-[10px]"><thead className="bg-black/20 text-slate-500"><tr><th className="p-3">Node</th><th className="p-3">Level</th><th className="p-3"> {tx("Estado", "Status")} </th><th className="p-3">Uptime local 24h</th><th className="p-3">Uptime Explorer</th><th className="p-3">Heartbeats</th><th className="p-3">Computation</th><th className="p-3">Reputation</th><th className="p-3">Tilling Ratio</th><th className="p-3">Tilling API</th></tr></thead><tbody>{nodes.map(n => { const x = explorerFleet[String(n.licenseKey || "").trim()]; const a = analytics?.uptime24h?.[n.id]; const hb = n.id === selected?.id ? heartbeat?.heartbeatCount : undefined; return <tr key={n.id} onClick={() => setSelectedId(n.id)} className={`cursor-pointer border-t border-white/5 hover:bg-white/[.03] ${n.id === selected?.id ? "bg-sky-400/[.03]" : ""}`}><td className="p-3 font-medium text-slate-200">{n.name}</td><td className="p-3 text-slate-400">{x?.level ? `L${x.level}` : "—"}</td><td className="p-3">{x?.status ? <Badge tone={/alive/i.test(x.status) ? "good" : "bad"}>{x.status}</Badge> : <Badge> {tx("AGUARDA", "WAITING")} </Badge>}</td><td className="p-3 text-emerald-300">{a != null ? `${a}%` : "—"}</td><td className="p-3 text-emerald-300">{x?.upPercent != null ? `${Number(x.upPercent).toLocaleString(uiLanguage === "en" ? "en-US" : "pt-PT", { maximumFractionDigits: 2 })}%` : "—"}</td><td className="p-3 text-slate-300">{x?.heartbeat != null ? Number(x.heartbeat).toLocaleString(uiLanguage === "en" ? "en-US" : "pt-PT") : hb != null ? String(hb) : "—"}</td><td className="p-3">{x?.computation != null ? <span className="text-sky-300">{x.computation}</span> : <Badge>{tx("AGUARDA FONTE", "WAITING FOR SOURCE")}</Badge>}</td><td className="p-3">{x?.reputation != null ? <span className="text-violet-300">{x.reputation}</span> : <Badge>{tx("AGUARDA FONTE", "WAITING FOR SOURCE")}</Badge>}</td><td className="p-3">{x?.tillingRatio != null || x?.tillingScore != null ? <span className="font-semibold text-amber-300">{x.tillingRatio ?? x.tillingScore}</span> : <Badge>{tx("AGUARDA FONTE", "WAITING FOR SOURCE")}</Badge>}</td><td className="p-3">{results[n.id]?.tilling?.ok ? <div><Badge tone="good">{results[n.id]?.tilling?.status || "OK"}</Badge><div className="mt-1 text-[8px] text-slate-600">{results[n.id]?.tilling?.latencyMs ?? "—"} ms</div></div> : results[n.id]?.tilling?.skipped ? <Badge>{tx("SEM LICENÇA", "NO LICENSE")}</Badge> : results[n.id]?.tilling ? <div><Badge tone="bad">{tx("ERRO", "ERROR")}</Badge><div className="mt-1 max-w-[120px] text-[8px] leading-3 text-slate-600">{tillingFailureReason(results[n.id]?.tilling)}</div></div> : <Badge>{tx("NÃO TESTADO", "NOT TESTED")}</Badge>}</td></tr>; })}</tbody></table></div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Tilling Ratio / Score</h2><p className="text-[10px] text-slate-500"> {tx("Mostra o valor publicado pela fonte quando este estiver presente. Não é estimado localmente.", "Shows the value published by the source when present. It is not estimated locally.")} </p></div><Badge tone={selected && explorerFleet[String(selected.licenseKey || '').trim()]?.tillingRatio != null || selected && explorerFleet[String(selected.licenseKey || '').trim()]?.tillingScore != null ? "good" : "warn"}>{selected && (explorerFleet[String(selected.licenseKey || '').trim()]?.tillingRatio != null || explorerFleet[String(selected.licenseKey || '').trim()]?.tillingScore != null) ? "DADO REAL" : "AGUARDA DADOS"}</Badge></div><div className="flex h-5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-emerald-400/20" style={{ width: `${Math.min(100, Math.max(0, Number(((selected && explorerFleet[String(selected.licenseKey || '').trim()]?.tillingRatio) ?? (selected && explorerFleet[String(selected.licenseKey || '').trim()]?.tillingScore)) || 0) / 2 * 100))}%` }}/></div><div className="mt-3 flex justify-between text-[10px]"><span className="text-slate-500">Score: {selected ? (explorerFleet[String(selected.licenseKey || '').trim()]?.tillingRatio ?? explorerFleet[String(selected.licenseKey || '').trim()]?.tillingScore ?? '—') : '—'}</span><span className="text-slate-500"> {tx("Meta de unlock: 2.0", "Unlock target: 2.0")} </span></div></Card>
        <Card className="p-5"><h2 className="text-sm font-semibold"> {tx("Como será calculado", "How it will be calculated")} </h2><p className="mt-2 text-[10px] leading-5 text-slate-500">Quando tivermos as três métricas reais, o Node Manager poderá apresentar Uptime, Computation e Reputation separadamente e o Tilling Score/Ratio sem substituir dados da rede por estimativas.</p><div className="mt-3 grid gap-2 sm:grid-cols-3"><Badge>Uptime · REAL</Badge><Badge>Computation · REAL</Badge><Badge>Reputation · REAL</Badge></div></Card>
      </div>
      <Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold"> {tx("Descoberta da fonte do Explorer", "Explorer source discovery")} </h2><p className="mt-1 text-[10px] leading-5 text-slate-500">Inspeciona os recursos carregados pela página pública da licença e procura pistas de API, GraphQL, JSON, Tilling, Computation, Reputation e Unlock. Não altera a rede nem envia transações.</p></div><Badge tone={sourceInspection ? "good" : "neutral"}>{sourceInspection ? "INSPEÇÃO CONCLUÍDA" : "AGUARDA INSPEÇÃO"}</Badge></div>{sourceInspection && <div className="mt-4 grid gap-4 lg:grid-cols-2"><div><div className="text-[10px] uppercase tracking-[.14em] text-slate-600"> {tx("Recursos relevantes", "Relevant resources")} </div><div className="mt-2 max-h-[220px] overflow-auto rounded-xl border border-white/5 bg-black/20 p-3">{sourceInspection.matchingResources?.length ? sourceInspection.matchingResources.map((x:string,i:number)=><div key={i} className="border-b border-white/5 py-2 break-all font-mono text-[9px] text-sky-200">{x}</div>) : <div className="text-[10px] text-slate-600"> {tx("Nenhum recurso com termos relevantes foi encontrado.", "No resources with relevant terms were found.")} </div>}</div></div><div><div className="text-[10px] uppercase tracking-[.14em] text-slate-600"> {tx("Pistas encontradas na página", "Clues found on the page")} </div><div className="mt-2 max-h-[220px] overflow-auto rounded-xl border border-white/5 bg-black/20 p-3">{sourceInspection.bodyHints?.length ? sourceInspection.bodyHints.map((x:string,i:number)=><div key={i} className="border-b border-white/5 py-2 text-[9px] text-slate-300">{x}</div>) : <div className="text-[10px] text-slate-600"> {tx("Nenhuma pista textual adicional.", "No additional textual clues.")} </div>}</div></div></div>}</Card><Card className="p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold"> {tx("Teste direto das fontes encontradas", "Direct test of discovered sources")} </h3><p className="mt-1 text-[10px] text-slate-500">{tx("O diagnóstico testa apenas recursos que o próprio Explorer carregou e mostra HTTP, content-type e campos encontrados. Nenhuma transação é enviada.", "V24 tests only resources loaded by Explorer and shows HTTP, content-type and discovered fields. No transaction is sent.")}</p></div><Badge tone={sourceInspection?.probes?.some((x:any) => x.ok && x.metricHits?.length) ? "good" : "neutral"}>{sourceInspection?.probes?.some((x:any) => x.ok && x.metricHits?.length) ? "DADOS DE PERFORMANCE ENCONTRADOS" : "SEM DADOS ESTRUTURADOS AINDA"}</Badge></div>{sourceInspection?.probes?.length ? <div className="mt-4 space-y-2">{sourceInspection.probes.map((x:any,i:number) => <div key={i} className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="break-all font-mono text-[9px] text-slate-300">{x.url}</div><div className="mt-1 text-[9px] text-slate-500">{x.ok ? `HTTP ${x.status} · ${x.contentType || "sem content-type"}` : `Falhou · ${x.error || "erro"}`}</div>{x.metricHits?.length ? <div className="mt-1 text-[9px] text-emerald-300">Campos relevantes: {x.metricHits.join(", ")}</div> : null}{x.jsonKeys?.length ? <div className="mt-1 text-[9px] text-slate-600">Chaves: {x.jsonKeys.slice(0,20).join(", ")}</div> : null}</div>)}</div> : <div className="mt-4 rounded-xl border border-white/5 p-4 text-[10px] text-slate-600"> {tx("Execute INVESTIGAR FONTE para testar automaticamente os recursos reais carregados pelo Explorer.", "Run INVESTIGATE SOURCE to automatically test the real resources loaded by Explorer.")} </div>}</Card><SimpleSource kind="tillingUrl" title={tx("Fonte de Tilling","Tilling source")} description="API real de estado da licença: http://tilling.ioai.services:8003/license_status. O teste usa o License configurado no node e mostra o estado devolvido pela fonte."/>
    </div> : tab === "earnings" ? <PlaceholderView title="Ganhos da frota" icon={Wallet}><div className="grid gap-4 lg:grid-cols-2"><Card className="p-5"><Info label="Hoje" value="—"/><Info label="7 dias" value="—"/><Info label="30 dias" value="—"/><Info label="Regra" value="Não confundir saldo com earnings"/></Card><SimpleSource kind="earningsUrl" title={tx("Fonte de earnings","Earnings source")} description="Os ganhos só serão mostrados quando vierem de uma fonte autoritativa."/></div></PlaceholderView> : tab === "alerts" ? <div className="space-y-4"><Card className="p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">{t("incidentCenter")}</h2><p className="text-[10px] text-slate-600">{tx("Incidentes derivados exclusivamente das transições registadas pelo monitor.","Incidents derived exclusively from transitions recorded by the monitor.")}</p></div><div className="flex gap-2"><Badge tone="bad">{incidents.filter((x:any)=>x.open).length} {t("openIncidents").toLowerCase()}</Badge><Badge tone="good">{incidents.filter((x:any)=>!x.open).length} {t("resolvedIncidents").toLowerCase()}</Badge></div></div>{incidents.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[10px]"><thead className="bg-black/20 text-slate-500"><tr><th className="p-3">{t("event")}</th><th className="p-3">Node</th><th className="p-3">{t("time")}</th><th className="p-3">{t("duration")}</th><th className="p-3">{tx("Estado","Status")}</th></tr></thead><tbody>{incidents.slice(0,20).map((a:any)=><tr key={a.id} className="border-t border-white/5"><td className="p-3"><Badge tone={a.type==="DEAD"?"bad":"good"}>{a.type}</Badge></td><td className="p-3 text-slate-200">{a.nodeName||"—"}</td><td className="p-3 text-slate-500">{shortDate(a.createdAt, uiLanguage === "en" ? "en-US" : "pt-PT")}</td><td className="p-3 text-slate-500">{a.durationSec!=null?fmtDuration(a.durationSec):"—"}</td><td className="p-3">{a.open?<Badge tone="bad">{t("incidentOpen")}</Badge>:<Badge tone="good">{t("incidentResolved")}</Badge>}</td></tr>)}</tbody></table></div>:<div className="p-6 text-center text-[10px] text-slate-600">{t("noIncidents")}</div>}</Card><Card className="p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">{t("alertsTitle")}</h2><p className="text-[10px] text-slate-600">{t("hourly")}</p></div><div className="flex items-center gap-2"><Badge tone={alerts.some(a => !a.acknowledged) ? "warn" : "good"}>{alerts.filter(a => !a.acknowledged).length}</Badge><button type="button" {...immediateButton(() => { void api.nodes.acknowledgeAllAlerts().then(async () => setAlerts(await api.nodes.alerts(undefined, 100))); })} className="cursor-pointer select-none rounded-lg border border-white/10 px-2 py-1 text-[9px]">{t("markAll")}</button><button type="button" {...immediateButton(() => { if (confirm(uiLanguage === "en" ? "Clear all alerts?" : "Limpar todos os alertas?")) { void api.nodes.clearAlerts().then(() => setAlerts([])); } })} className="cursor-pointer select-none rounded-lg border border-red-400/20 px-2 py-1 text-[9px] text-red-300">{t("clearAll")}</button></div></div>{alerts.map(a => <div key={a.id} className="flex items-center gap-3 border-b border-white/5 py-3"><Badge tone={a.type === "DEAD" ? "bad" : "good"}>{a.type}</Badge><div className="min-w-0 flex-1"><div className="text-[11px] text-slate-300">{a.message}</div><div className="text-[9px] text-slate-600">{shortDate(a.createdAt, uiLanguage === "en" ? "en-US" : "pt-PT")}</div></div>{!a.acknowledged && <button type="button" {...immediateButton(() => { void api.nodes.acknowledgeAlert(a.id).then(async () => setAlerts(await api.nodes.alerts(undefined, 100))); })} className="cursor-pointer select-none rounded-lg border border-white/10 px-2 py-1 text-[9px]">OK</button>}</div>)}{!alerts.length && <div className="py-12 text-center text-xs text-slate-600">{t("noAlerts")}</div>}</Card></div> : <div className="grid gap-4 lg:grid-cols-2"><Card className="p-5"><h2 className="text-sm font-semibold"> {tx("Fontes e APIs", "Sources & APIs")} </h2>{[["explorerUrl", "Explorer"], ["licensesUrl", "Licenças / Factory"], ["tillingUrl", "Tilling"], ["earningsUrl", "Earnings"]].map(([k, l]) => <label key={k} className="mt-4 block text-[10px] text-slate-500">{l}<input value={sources[k] || ""} onChange={e => setSources({ ...sources, [k]: e.target.value })} placeholder="https://… (Tilling usa API oficial integrada)" className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-2.5 text-[11px] text-white outline-none"/></label>)}<div className="mt-4 flex gap-2"><button type="button" {...immediateButton(() => void api.nodes.sourcesSet(sources).then(() => setNotice("Fontes guardadas.")))} className="cursor-pointer select-none rounded-xl bg-white px-3 py-2 text-[10px] font-semibold text-black">{tx("GUARDAR", "SAVE")}</button><button type="button" {...immediateButton(() => void api.nodes.sourceRead("explorerUrl").then((r: any) => setSourceStatus(s => ({ ...s, explorerUrl: r }))))} className="cursor-pointer select-none rounded-xl border border-white/10 px-3 py-2 text-[10px]">{tx("TESTAR EXPLORER", "TEST EXPLORER")}</button></div></Card><Card className="p-5"><h2 className="text-sm font-semibold"> {tx("Operação segura", "Safe operation")} </h2><Info label="Capacidade" value="500 nodes"/><Info label="Auto refresh UI" value="30 segundos"/><Info label="Heartbeat persistente" value="Ativo enquanto a aplicação estiver em execução"/><Info label="Chaves privadas" value="Nunca armazenadas"/><Info label="Pagamentos" value="Nunca automáticos"/><div className="mt-4 rounded-xl border border-sky-400/10 bg-sky-400/[.03] p-3 text-[10px] leading-5 text-slate-500">{tx("O uptime observado começa quando o primeiro heartbeat é registado.", "Observed uptime starts when the first heartbeat is recorded.")} Se o próprio node fornecer um contador de uptime, este aparece separadamente como <b className="text-slate-300"> {tx("uptime reportado pelo node", "node-reported uptime")} </b>.</div></Card><Card className="p-5"><h2 className="text-sm font-semibold">{t("privacy")} & Interface</h2><label className="mt-4 block text-[10px] text-slate-500">{t("language")}<select value={uiLanguage} onChange={e => setUiLanguage(e.target.value as "pt" | "en")} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-2.5 text-[11px] text-white"><option value="pt">Português</option><option value="en">English</option></select></label><p className="mt-2 text-[9px] leading-4 text-slate-600">{t("languageComplete")}</p><label className="mt-4 flex items-center gap-2 text-[10px] text-slate-400"><input type="checkbox" checked={hideNumbers} onChange={e => setHideNumbers(e.target.checked)}/>{t("hideNumbers")}</label><div className="mt-4 rounded-xl border border-emerald-400/10 bg-emerald-400/[.03] p-3">
  <div className="flex items-center justify-between gap-2"><div><div className="text-[10px] font-semibold text-emerald-200">{t("privacyShare")}</div><div className="mt-1 text-[9px] leading-4 text-slate-500">{t("privacyShareHint")}</div></div><Badge tone="good">{t("shareReady")}</Badge></div>
  <button type="button" {...immediateButton(() => void exportSanitizedShare())} disabled={shareExportBusy} className="mt-3 cursor-pointer select-none rounded-lg border border-emerald-400/20 px-3 py-2 text-[9px] font-semibold text-emerald-200 disabled:opacity-40">{shareExportBusy ? "A EXPORTAR…" : t("exportSanitized")}</button>
</div><div className="mt-4 rounded-xl border border-amber-400/10 bg-amber-400/[.03] p-3 text-[10px] leading-5 text-slate-500">{t("hourly")}</div></Card></div>;

  return <div ref={uiRootRef} className="flex h-full min-h-0 overflow-hidden bg-[#07090d] text-white"><Sidebar/><div className="min-w-0 flex-1"><header className="border-b border-white/10 bg-black/20 backdrop-blur"><div className="flex items-center justify-between gap-3 px-4 py-3"><div><div className="flex items-center gap-2"><h1 className="text-sm font-semibold lg:text-base">{({overview:t("dashboard"),nodes:t("nodes"),licenses:t("licenses"),aims:t("aims"),tilling:t("tilling"),diagnostics:t("diagnostics"),earnings:t("earnings"),alerts:t("alerts"),settings:t("settings")} as any)[tab]}</h1><Badge tone="good"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400"/> LIVE</Badge></div><p className="mt-0.5 text-[9px] text-slate-600">{stat.alive}/{stat.active} nodes ativos online · atualização automática</p></div><div className="flex items-center gap-2"><button type="button" {...immediateButton(() => void testAll())} className="cursor-pointer select-none rounded-xl border border-white/10 bg-white/[.05] px-3 py-2 text-[10px] font-semibold hover:bg-white/[.09]"><Gauge size={13} className="mr-1 inline"/>{t("testFleet")}</button><button type="button" {...immediateButton(() => void refreshExplorerFleet())} disabled={explorerFleetBusy} className="cursor-pointer select-none rounded-xl border border-sky-400/20 bg-sky-400/[.06] px-3 py-2 text-[10px] font-semibold text-sky-200 disabled:opacity-40"><RefreshCw size={13} className={`mr-1 inline ${explorerFleetBusy ? "animate-spin" : ""}`}/> {explorerFleetBusy ? "EXPLORER…" : t("refreshExplorer")}</button><button type="button" {...immediateButton(openAdd)} className="cursor-pointer select-none rounded-xl bg-white px-3 py-2 text-[10px] font-semibold text-black"><Plus size={13} className="mr-1 inline"/> NODE</button></div></div><MobileNav/></header>{notice && <div className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-sky-400/10 bg-sky-400/[.04] px-3 py-2 text-[10px] text-sky-200"><span>{notice}</span><button type="button" {...immediateButton(() => setNotice(""))} className="cursor-pointer select-none text-slate-600">×</button></div>}<main key={tab} className="relative z-10 h-[calc(100%-64px)] overflow-auto p-4 lg:p-5">{tabContent}</main></div>
    {showEditor && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"><div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl"><div className="flex items-center justify-between border-b border-white/10 p-5"><div><h2 className="text-sm font-semibold">{form.id ? "Editar node" : "Adicionar node"}</h2><p className="mt-1 text-[10px] text-slate-600"> {tx("Ligação, network e diagnóstico. Nunca introduza uma chave privada.", "Connection, network and diagnostics. Never enter a private key.")} </p></div><button onClick={() => setShowEditor(false)} className="text-slate-600 hover:text-white">×</button></div><div className="max-h-[70vh] overflow-auto p-5"><div className="grid gap-3 md:grid-cols-2">{[["name", "Nome"], ["apiHost", "Host / IP"], ["apiPort", "Porta Node"], ["licenseKey", "License"], ["senderAddress", "Sender / Wallet address"], ["aimPort", "AIM service port"], ["aimManagerPort", "AIM Manager API port"], ["aimSlot", "AIM slot"], ["tags", "Tags"]].map(([k, l]) => <label key={k} className="text-[10px] text-slate-500">{l}<input value={String((form as any)[k] ?? "")} onChange={e => setForm({ ...form, [k]: k === "aimSlot" ? Number(e.target.value) : e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-2.5 text-[11px] text-white outline-none"/></label>)}</div><div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-[10px] text-slate-500">Network<select value={form.network || "TODA"} onChange={e => setForm({ ...form, network: e.target.value as any, apiPort: e.target.value === "BASE" ? "8010" : "8000", aimPort: "9000", aimManagerPort: "8005", aimSlot: e.target.value === "BASE" ? 2 : 0, aimPath: `/api/aim/${e.target.value === "BASE" ? 2 : 0}/request` })} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-2.5 text-[11px] text-white"><option>TODA</option><option>BASE</option></select></label><label className="flex items-center gap-2 pt-6 text-[10px] text-slate-500"><input type="checkbox" checked={form.isActive !== false} onChange={e => setForm({ ...form, isActive: e.target.checked })}/> Monitorizar este node</label></div></div><div className="flex gap-2 border-t border-white/10 p-4"><button onClick={() => void saveNode()} className="flex-1 rounded-xl bg-white py-2.5 text-[10px] font-semibold text-black"> {tx("GUARDAR NODE", "SAVE NODE")} </button>{form.id && <button onClick={() => { if (selected) void remove(selected); setShowEditor(false); }} className="rounded-xl border border-red-400/20 px-4 text-[10px] text-red-300"><Trash2 size={13}/></button>}</div></div></div>}
  </div>;
}

export default NodeManagerPage;
