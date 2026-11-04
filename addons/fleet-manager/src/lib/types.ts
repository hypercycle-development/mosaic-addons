// =============================================================================
// Fleet Manager — shared domain types.
//
// These mirror the domain model of the original Mosaic Companion Node Manager
// (electron/nodeManagerService.ts in Mosaic-fleet-manager v1.0.0), preserved
// in shape so the existing UI keeps working unchanged. What differs is where
// the data comes from: the original read it from the Electron main process
// over IPC; this add-on produces it inside the renderer.
// =============================================================================

/** A HyperCycle node as registered in the Mosaic node registry. */
export interface HypercycleNode {
  id: string;
  name: string;
  apiHost: string;
  apiPort?: string;
  isActive: boolean;
  network?: "TODA" | "BASE";
  licenseKey?: string;
  senderAddress?: string;
  aimPort?: string;
  aimManagerPort?: string;
  aimSlot?: number;
  aimPath?: string;
  tags?: string;
  hasAdminPanel?: boolean;
  adminHost?: string;
  adminPort?: string;
}

/** Result of a single HTTP probe against a node. */
export interface ProbeResult {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  data?: unknown;
  error?: string;
  skipped?: boolean;
}

/** Result of the authoritative Tilling license-status query. */
export interface TillingResult {
  ok: boolean;
  status?: string;
  statusSince?: string;
  latencyMs?: number;
  error?: string;
  skipped?: boolean;
}

/** Aggregate result of testing one node. */
export interface NodeTestResult {
  nodeId: string;
  testedAt: string;
  alive: boolean;
  totalLatencyMs: number;
  tests: Record<string, ProbeResult>;
  info?: unknown;
  tilling?: TillingResult;
}

/** Heartbeat-derived uptime statistics for one node. */
export interface NodeHeartbeatAnalytics {
  nodeId: string;
  firstObservedAt: string | null;
  lastHeartbeatAt: string | null;
  heartbeatCount: number;
  aliveSamples: number;
  observedUptimePercent: number | null;
  observedDurationSeconds: number;
  reportedUptimeSeconds: number | null;
  reportedUptimeSource: string | null;
}

/** An ALIVE/DEAD transition alert. */
export interface NodeAlert {
  id: string;
  nodeId: string;
  type: "ALIVE" | "DEAD";
  createdAt: string;
  message: string;
  acknowledged?: boolean;
  /**
   * How long the incident lasted, in seconds.
   *
   * Measured from the transition that opened the incident to the transition
   * that closed it. It is undefined while the incident is still open, because
   * an open incident has no duration yet — the elapsed time is not the same
   * fact as the incident's length.
   */
  durationSec?: number;
}

/** One point of fleet test history. */
export interface FleetHistoryPoint {
  nodeId: string;
  testedAt: string;
  alive: boolean;
  totalLatencyMs: number;
}

/** Aggregate fleet analytics. */
export interface FleetAnalytics {
  total: number;
  active: number;
  alive: number;
  dead: number;
  untested: number;
  avgLatencyMs: number | null;
  lastTestAt: string | null;
  uptime24h: Record<string, number | null>;
  transitions: NodeAlert[];
}

/** Per-node Explorer information (license status, uptime, tilling, …). */
export interface ExplorerNodeInfo {
  licenseKey?: string;
  /** The license as the source reported it. */
  license?: string;
  status?: string;
  level?: number | string;
  /** Percentage of time online, 0-100. */
  upPercent?: number | null;
  /** Total observed seconds. */
  totalTime?: number | null;
  upTime?: number | null;
  downTime?: number | null;
  /** The same figures expressed in hours — what the UI displays. */
  totalHours?: number | null;
  upHours?: number | null;
  downHours?: number | null;
  onlineHours?: number | null;
  offlineHours?: number | null;
  totalOnlineHours?: number | null;
  totalOfflineHours?: number | null;
  heartbeat?: number | null;
  /**
   * The computation count the Explorer publishes for this license.
   *
   * Source: the `uptimeReports.updates[].computations.total` field of
   * https://explorer.hypercycle.ai/v1/licenses/details — a real, published
   * number. It is undefined when the source publishes no updates.
   */
  computation?: number | string | null;
  /**
   * Reputation and scaling factor.
   *
   * The public Explorer does not publish either: its own bundle contains no
   * `reputation` or `scalingFactor` field, and neither endpoint carries one.
   * They stay undefined so the UI can say the source does not publish them,
   * rather than showing a number nobody published.
   */
  reputation?: number | string | null;
  tillingScore?: number | string | null;
  tillingRatio?: number | string | null;
  scalingFactor?: number | string | null;
  chypc?: number | string | null;
  network?: string;
  chain?: string;
  block?: string | number | null;
  /** The delegate identifier the Explorer publishes for this license. */
  did?: string;
  /** The priority the Explorer publishes for this license. */
  priority?: number | null;
  /** When the source answered. */
  fetchedAt?: string;
  /** The historical uptime reports, when the source publishes them. */
  reports?: Array<{
    name?: string;
    version?: string;
    timestamp?: string;
    status?: string;
  }>;
  /** The billing lines shown by the source, when it publishes them. */
  billingLines?: string[];
  rawTextLength?: number;
  error?: string;
}

/** A probe performed against a source discovered on the Explorer page. */
export interface SourceProbe {
  url: string;
  ok: boolean;
  status?: number;
  contentType?: string;
  error?: string;
  metricHits?: string[];
  jsonKeys?: string[];
}

/** The result of inspecting the public Explorer license page. */
export interface SourceInspection {
  matchingResources?: string[];
  bodyHints?: string[];
  probes?: SourceProbe[];
  error?: string;
}

/** Persisted, user-configurable source URLs. */
export interface FleetSources {
  explorerUrl?: string;
  licensesUrl?: string;
  tillingUrl?: string;
  earningsUrl?: string;
}

/** The shape of the add-on's persistent state file. */
export interface FleetState {
  history: NodeTestResult[];
  alerts: NodeAlert[];
  sources: FleetSources;
}

// -----------------------------------------------------------------------------
// Diagnostics — mirrors electron/nodeDiagnosticsService.ts in the original
// -----------------------------------------------------------------------------

/** One diagnostic check against a node's own endpoint. */
export interface DiagnosticCheck {
  key: string;
  label: string;
  ok: boolean | null;
  status?: number;
  latencyMs?: number;
  url?: string;
  error?: string;
  skipped?: boolean;
}

/** The result of a diagnostic pass over one node. */
export interface NodeDiagnosticResult {
  nodeId: string;
  testedAt: string;
  overall: "HEALTHY" | "DEGRADED" | "OFFLINE";
  checks: DiagnosticCheck[];
  summary: { passed: number; failed: number; skipped: number };
}

// -----------------------------------------------------------------------------
// AIM management — mirrors electron/aimManagerService.ts in the original
// -----------------------------------------------------------------------------

/** The result of an AIM Manager operation. */
export interface AimManagerResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  url: string;
  data?: unknown;
  error?: string;
}
