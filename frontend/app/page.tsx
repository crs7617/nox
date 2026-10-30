"use client";

import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  CircleUserRound,
  FileCheck2,
  FileClock,
  Gauge,
  KeyRound,
  Menu,
  Network,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditEvent, AuditResult } from "@/lib/audit";
import { calculateMetrics, decisionBreakdown, filterEventsByRange, type DashboardRange } from "@/lib/dashboard";

const navigation = [
  { label: "Overview", icon: Gauge, active: true },
  { label: "Tools", icon: TerminalSquare },
  { label: "Policies", icon: FileCheck2 },
  { label: "Approvals", icon: KeyRound },
  { label: "Audit logs", icon: FileClock },
  { label: "Upstreams", icon: Network },
];

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatRelative(timestamp: string) {
  const date = new Date(timestamp);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return formatTime(timestamp);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return formatTime(timestamp);
}

function StatusBadge({ value }: { value: string }) {
  const tone = value === "allowed" || value === "success" ? "success" : value === "denied" || value === "error" ? "danger" : "warning";
  return <span className={`status-badge status-${tone}`}><span className="status-dot" />{value}</span>;
}

function Sidebar({ onClose }: { onClose: () => void }) {
  return <aside className="sidebar">
    <div className="sidebar-top"><div className="brand"><span className="brand-mark"><ShieldCheck size={15} strokeWidth={2.5} /></span><span>Nox</span><ChevronDown size={13} className="muted-icon" /></div><button className="icon-button mobile-close" onClick={onClose} aria-label="Close navigation"><X size={16} /></button></div>
    <div className="workspace-switcher"><span className="workspace-avatar">N</span><span className="workspace-name">Local workspace</span><ChevronDown size={13} className="muted-icon" /></div>
    <nav aria-label="Primary navigation" className="nav-section"><span className="nav-label">Workspace</span>{navigation.map(({ label, icon: Icon, active }) => <button key={label} className={`nav-item ${active ? "nav-active" : ""}`}><Icon size={15} strokeWidth={1.8} /><span>{label}</span>{active && <span className="nav-indicator" />}</button>)}</nav>
    <div className="sidebar-bottom"><button className="nav-item"><CircleHelp size={15} /><span>Help & docs</span></button><button className="user-row"><span className="user-avatar">OP</span><span className="user-copy"><strong>Operator</strong><small>Local admin</small></span><ChevronDown size={13} className="muted-icon" /></button></div>
  </aside>;
}

function EmptyState({ result }: { result: Extract<AuditResult, { status: "not-configured" | "error" }> }) {
  const error = result.status === "error";
  return <div className="empty-state dashboard-empty"><div className={`empty-icon ${error ? "empty-icon-error" : ""}`}>{error ? <XCircle size={18} /> : <FileClock size={18} />}</div><h2>{error ? "Dashboard unavailable" : "Connect an audit source"}</h2><p>{result.message}</p>{!error && <code>NOX_AUDIT_FILE=/path/to/nox-audit.jsonl</code>}</div>;
}

function EventDetail({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  return <div className="detail-backdrop" role="presentation" onMouseDown={onClose}><aside className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title" onMouseDown={(e) => e.stopPropagation()}>
    <div className="detail-header"><div><span className="eyebrow">Audit event</span><h2 id="detail-title">{event.tool}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close event details"><X size={16} /></button></div>
    <div className="detail-status-row"><StatusBadge value={event.decision} /><StatusBadge value={event.outcome} /></div>
    <dl className="detail-list"><div><dt>Timestamp</dt><dd>{formatTime(event.timestamp)} <span className="detail-muted">({formatRelative(event.timestamp)})</span></dd></div><div><dt>Tool</dt><dd className="mono">{event.tool}</dd></div><div><dt>Decision</dt><dd><StatusBadge value={event.decision} /></dd></div><div><dt>Outcome</dt><dd><StatusBadge value={event.outcome} /></dd></div>{event.approval && <div><dt>Approval</dt><dd><StatusBadge value={event.approval} /></dd></div>}{event.reason && <div className="detail-reason"><dt>Reason</dt><dd>{event.reason}</dd></div>}</dl>
    <div className="safe-note"><ShieldCheck size={15} /><span>Arguments, results, credentials, and raw exception details are not included in audit events.</span></div>
  </aside></div>;
}

function MetricCard({ label, value, tone, icon: Icon }: { label: string; value: number; tone?: string; icon: typeof Activity }) {
  return <div className="metric-card"><div className={`metric-icon ${tone ?? ""}`}><Icon size={16} /></div><div><span className="metric-label">{label}</span><strong>{value.toLocaleString()}</strong></div></div>;
}

export default function OverviewPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [range, setRange] = useState<DashboardRange>("24h");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const loadEvents = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/audit", { cache: "no-store" });
      if (!response.ok) throw new Error("audit request failed");
      setResult((await response.json()) as AuditResult);
    } catch {
      setResult({ status: "error", message: "The audit service could not be reached. Try refreshing again." });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void loadEvents(); }, [loadEvents]);

  const events = useMemo(() => result?.status === "ready" ? filterEventsByRange(result.events, range) : [], [range, result]);
  const metrics = useMemo(() => calculateMetrics(events), [events]);
  const breakdown = useMemo(() => decisionBreakdown(events), [events]);
  const latest = events.slice(0, 8);
  const maxDecision = Math.max(...breakdown.map((item) => item.value), 1);

  return <div className="app-shell">
    <div className={`mobile-overlay ${sidebarOpen ? "is-visible" : ""}`} onClick={() => setSidebarOpen(false)} /><div className={sidebarOpen ? "sidebar-mobile-open" : ""}><Sidebar onClose={() => setSidebarOpen(false)} /></div>
    <main className="main-content"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={18} /></button><div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-separator">/</span><strong>Overview</strong></div><div className="topbar-actions"><button className="topbar-link"><BookOpen size={14} /> Docs</button><button className="icon-button" aria-label="Account"><CircleUserRound size={17} /></button></div></header>
      <div className="page-wrap"><div className="page-heading"><div><span className="eyebrow">Security observability</span><h1>Overview</h1><p>Monitor policy decisions and tool execution health.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => void loadEvents()} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spin" : ""} /> Refresh</button></div></div>
        <section className="integration-strip"><div className="integration-icon"><Activity size={15} /></div><div><strong>{result?.status === "ready" ? `Connected to ${result.source}` : "Read-only local integration"}</strong><span>{result?.status === "ready" ? "Showing sanitized events from the configured audit file." : "This dashboard never controls the gateway or exposes sensitive event data."}</span></div><span className={`connection-state ${result?.status === "ready" ? "state-connected" : ""}`}><span className="status-dot" />{result?.status === "ready" ? "Connected" : "Disconnected"}</span></section>
        <div className="range-toolbar" role="group" aria-label="Time range"><span>Time range</span>{(["24h", "7d", "all"] as const).map((value) => <button key={value} className={range === value ? "range-active" : ""} onClick={() => setRange(value)}>{value === "24h" ? "Last 24 hours" : value === "7d" ? "Last 7 days" : "All history"}</button>)}</div>
        {loading ? <div className="dashboard-loading"><div className="metric-grid">{[1, 2, 3, 4].map((item) => <div className="metric-card skeleton-card" key={item} />)}</div><div className="dashboard-grid"><div className="audit-section skeleton-panel" /><div className="audit-section skeleton-panel" /></div></div> : result?.status !== "ready" ? <section className="audit-section"><EmptyState result={result ?? { status: "not-configured", message: "Set NOX_AUDIT_FILE to connect the dashboard." }} /></section> : events.length === 0 ? <section className="audit-section"><div className="no-results dashboard-empty"><CheckCircle2 size={20} /><h2>No audit events in this range</h2><p>Try a wider time range or check back after the gateway records an event.</p></div></section> : <>
          <section className="metric-grid"><MetricCard label="Total tool calls" value={metrics.total} icon={Activity} /><MetricCard label="Allowed calls" value={metrics.allowed} tone="success" icon={CheckCircle2} /><MetricCard label="Denied calls" value={metrics.denied} tone="danger" icon={XCircle} /><MetricCard label="Failed calls" value={metrics.failed} tone="danger" icon={XCircle} /></section>
          <div className="dashboard-grid"><section className="audit-section breakdown-panel"><div className="section-heading"><div><h2>Decision breakdown</h2><span className="result-count">Based on {metrics.total} calls</span></div></div><div className="breakdown-content">{breakdown.map((item) => <div className="breakdown-row" key={item.label}><div className="breakdown-label"><span className={`legend-dot ${item.tone}`} />{item.label}<strong>{item.value}</strong></div><div className="bar-track"><span className={`bar-fill ${item.tone}`} style={{ width: `${(item.value / maxDecision) * 100}%` }} /></div></div>)}</div></section>
            <section className="audit-section"><div className="section-heading"><div><h2>Latest activity</h2><span className="result-count">{latest.length} of {events.length} events</span></div><span className="section-caption">Sanitized data</span></div><div className="activity-list">{latest.map((event, index) => <button className="activity-row" key={`${event.timestamp}-${event.tool}-${index}`} onClick={() => setSelected(event)}><span className="activity-time">{formatRelative(event.timestamp)}</span><span className="activity-tool mono">{event.tool}</span><StatusBadge value={event.decision} /><ArrowUpRight size={14} className="activity-arrow" /></button>)}</div></section>
          </div>
        </>}
      </div>
    </main>{selected && <EventDetail event={selected} onClose={() => setSelected(null)} />}
  </div>;
}
