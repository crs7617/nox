"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  CircleUserRound,
  FileCheck2,
  FileClock,
  Filter,
  Gauge,
  KeyRound,
  Menu,
  Network,
  PanelLeft,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditEvent, AuditResult } from "@/lib/audit";

const navigation = [
  { label: "Overview", icon: Gauge },
  { label: "Tools", icon: TerminalSquare },
  { label: "Policies", icon: FileCheck2 },
  { label: "Approvals", icon: KeyRound },
  { label: "Audit logs", icon: FileClock, active: true },
  { label: "Upstreams", icon: Network },
  { label: "Settings", icon: Settings },
];

const decisions = ["All decisions", "Allowed", "Denied"];
const outcomes = ["All outcomes", "Success", "Error"];

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelative(timestamp: string) {
  const date = new Date(timestamp);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return formatTime(timestamp);
}

function StatusBadge({
  kind,
  value,
}: {
  kind: "decision" | "outcome" | "approval";
  value: string;
}) {
  const tone =
    value === "allowed" || value === "success" || value === "approved"
      ? "success"
      : value === "denied" || value === "error" || value === "rejected"
        ? "danger"
        : "warning";
  return (
    <span className={`status-badge status-${tone}`}>
      <span className="status-dot" />
      {value}
    </span>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <span className="brand-mark"><ShieldCheck size={15} strokeWidth={2.5} /></span>
          <span>Nox</span>
          <ChevronDown size={13} className="muted-icon" />
        </div>
        <button className="icon-button mobile-close" onClick={onClose} aria-label="Close navigation">
          <X size={16} />
        </button>
      </div>
      <div className="workspace-switcher">
        <span className="workspace-avatar">N</span>
        <span className="workspace-name">Local workspace</span>
        <ChevronDown size={13} className="muted-icon" />
      </div>
      <nav aria-label="Primary navigation" className="nav-section">
        <span className="nav-label">Workspace</span>
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.label} className={`nav-item ${item.active ? "nav-active" : ""}`}>
              <Icon size={15} strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.active && <span className="nav-indicator" />}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item"><CircleHelp size={15} /><span>Help & docs</span></button>
        <button className="user-row">
          <span className="user-avatar">OP</span>
          <span className="user-copy"><strong>Operator</strong><small>Local admin</small></span>
          <ChevronDown size={13} className="muted-icon" />
        </button>
      </div>
    </aside>
  );
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-control">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
      <ChevronDown size={13} />
    </label>
  );
}

function EmptyState({ result }: { result: Extract<AuditResult, { status: "not-configured" | "error" }> }) {
  const isError = result.status === "error";
  return (
    <div className="empty-state">
      <div className={`empty-icon ${isError ? "empty-icon-error" : ""}`}>
        {isError ? <XCircle size={18} /> : <FileClock size={18} />}
      </div>
      <h2>{isError ? "Audit log unavailable" : "Connect an audit source"}</h2>
      <p>{result.message}</p>
      {!isError && <code>NOX_AUDIT_FILE=/path/to/nox-audit.jsonl</code>}
    </div>
  );
}

function EventDetail({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  return (
    <div className="detail-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="detail-header">
          <div><span className="eyebrow">Audit event</span><h2 id="detail-title">{event.tool}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close event details"><X size={16} /></button>
        </div>
        <div className="detail-status-row">
          <StatusBadge kind="decision" value={event.decision} />
          <StatusBadge kind="outcome" value={event.outcome} />
        </div>
        <dl className="detail-list">
          <div><dt>Timestamp</dt><dd>{formatTime(event.timestamp)} <span className="detail-muted">({formatRelative(event.timestamp)})</span></dd></div>
          <div><dt>Tool</dt><dd className="mono">{event.tool}</dd></div>
          <div><dt>Decision</dt><dd><StatusBadge kind="decision" value={event.decision} /></dd></div>
          <div><dt>Outcome</dt><dd><StatusBadge kind="outcome" value={event.outcome} /></dd></div>
          {event.approval && <div><dt>Approval</dt><dd><StatusBadge kind="approval" value={event.approval} /></dd></div>}
          {event.reason && <div className="detail-reason"><dt>Reason</dt><dd>{event.reason}</dd></div>}
        </dl>
        <div className="safe-note"><ShieldCheck size={15} /><span>Arguments, results, credentials, and raw exception details are not included in audit events.</span></div>
      </aside>
    </div>
  );
}

export default function AuditLogsPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState("All decisions");
  const [outcome, setOutcome] = useState("All outcomes");
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadEvents = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/audit", { cache: "no-store" });
      const data = (await response.json()) as AuditResult;
      setResult(data);
    } catch {
      setResult({ status: "error", message: "The audit service could not be reached." });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  const events = useMemo(() => {
    if (!result || result.status !== "ready") return [];
    const query = search.trim().toLowerCase();
    return result.events.filter((event) => {
      const matchesSearch = !query || [event.tool, event.reason].filter(Boolean).some((value) => value!.toLowerCase().includes(query));
      const matchesDecision = decision === "All decisions" || event.decision === decision.toLowerCase();
      const matchesOutcome = outcome === "All outcomes" || event.outcome === outcome.toLowerCase();
      return matchesSearch && matchesDecision && matchesOutcome;
    });
  }, [decision, outcome, result, search]);

  return (
    <div className="app-shell">
      <div className={`mobile-overlay ${sidebarOpen ? "is-visible" : ""}`} onClick={() => setSidebarOpen(false)} />
      <div className={sidebarOpen ? "sidebar-mobile-open" : ""}><Sidebar onClose={() => setSidebarOpen(false)} /></div>
      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={18} /></button>
          <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-separator">/</span><strong>Audit logs</strong></div>
          <div className="topbar-actions"><button className="topbar-link"><BookOpen size={14} /> Docs</button><button className="icon-button" aria-label="Account"><CircleUserRound size={17} /></button></div>
        </header>
        <div className="page-wrap">
          <div className="page-heading">
            <div><span className="eyebrow">Security observability</span><h1>Audit logs</h1><p>Review policy decisions and tool execution outcomes.</p></div>
            <div className="heading-actions"><button className="button button-secondary" onClick={() => void loadEvents()} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spin" : ""} /> Refresh</button><button className="button button-primary"><Filter size={14} /> Filters</button></div>
          </div>
          <section className="integration-strip"><div className="integration-icon"><Activity size={15} /></div><div><strong>{result?.status === "ready" ? `Connected to ${result.source}` : "Read-only local integration"}</strong><span>{result?.status === "ready" ? "Showing sanitized events from the configured audit file." : "This explorer never controls the gateway or exposes sensitive event data."}</span></div><span className={`connection-state ${result?.status === "ready" ? "state-connected" : "state-pending"}`}><span className="status-dot" />{result?.status === "ready" ? "Connected" : "Not connected"}</span></section>
          <section className="toolbar" aria-label="Audit log filters">
            <div className="search-control"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tools or reasons..." aria-label="Search audit logs" /><kbd>⌘ K</kbd></div>
            <div className="toolbar-divider" />
            <SelectFilter label="Filter by decision" value={decision} options={decisions} onChange={setDecision} />
            <SelectFilter label="Filter by outcome" value={outcome} options={outcomes} onChange={setOutcome} />
            <button className="filter-icon-button" aria-label="More filters"><SlidersHorizontal size={15} /></button>
          </section>
          <section className="audit-section">
            <div className="section-heading"><div><h2>Recent events</h2><span className="result-count">{result?.status === "ready" ? `${events.length} of ${result.events.length} events` : "Waiting for a source"}</span></div><button className="quiet-button"><PanelLeft size={14} /> Columns</button></div>
            {loading ? <div className="loading-list">{[1, 2, 3, 4].map((item) => <div className="skeleton-row" key={item}><span /><span /><span /><span /></div>)}</div> : result?.status !== "ready" ? <EmptyState result={result ?? { status: "not-configured", message: "Set NOX_AUDIT_FILE to connect the explorer." }} /> : events.length === 0 ? <div className="no-results"><Search size={18} /><h2>No matching events</h2><p>Try clearing a filter or changing your search.</p></div> : <div className="table-wrap"><table><thead><tr><th>Timestamp</th><th>Tool</th><th>Decision</th><th>Outcome</th><th>Reason</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{events.map((event, index) => <tr key={`${event.timestamp}-${event.tool}-${index}`} onClick={() => setSelected(event)} tabIndex={0} onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") setSelected(event); }}><td><span className="time-primary">{formatRelative(event.timestamp)}</span><span className="time-secondary">{formatTime(event.timestamp)}</span></td><td><span className="tool-name">{event.tool}</span></td><td><StatusBadge kind="decision" value={event.decision} /></td><td><StatusBadge kind="outcome" value={event.outcome} /></td><td><span className="reason-cell">{event.reason ?? "—"}</span></td><td><ArrowUp size={13} className="row-arrow" /></td></tr>)}</tbody></table></div>}
          </section>
          {result?.status === "ready" && <div className="table-footer"><span>Showing sanitized audit data only</span><span><ArrowDown size={13} /> Newest first</span></div>}
        </div>
      </main>
      {selected && <EventDetail event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
