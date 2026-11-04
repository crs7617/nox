"use client";

import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  CircleUserRound,
  FileClock,
  Gauge,
  KeyRound,
  Menu,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  mapPolicyTools,
  policyDescription,
  policyForTools,
  type PolicyConfig,
  type PolicyState,
  type PolicyTool,
} from "@/lib/policy";
import { getDiscoveredTools, getPolicy, ManagementApiError, savePolicy, validatePolicy } from "@/lib/policy-client";

const navigation = [
  { label: "Overview", icon: Gauge, href: "/" },
  { label: "Tools & policies", icon: TerminalSquare, href: "/tools-policies" },
  { label: "Approvals", icon: KeyRound, href: "#" },
  { label: "Audit logs", icon: FileClock, href: "#" },
  { label: "Upstreams", icon: Network, href: "#" },
];

function Sidebar({ onClose }: { onClose: () => void }) {
  return <aside className="sidebar">
    <div className="sidebar-top"><div className="brand"><span className="brand-mark"><ShieldCheck size={15} strokeWidth={2.5} /></span><span>Nox</span><ChevronDown size={13} className="muted-icon" /></div><button className="icon-button mobile-close" onClick={onClose} aria-label="Close navigation"><X size={16} /></button></div>
    <div className="workspace-switcher"><span className="workspace-avatar">N</span><span className="workspace-name">Local workspace</span><ChevronDown size={13} className="muted-icon" /></div>
    <nav aria-label="Primary navigation" className="nav-section"><span className="nav-label">Workspace</span>{navigation.map(({ label, icon: Icon, href }) => <a key={label} className={`nav-item ${label === "Tools & policies" ? "nav-active" : ""}`} href={href} onClick={onClose}><Icon size={15} strokeWidth={1.8} /><span>{label}</span>{label === "Tools & policies" && <span className="nav-indicator" />}</a>)}</nav>
    <div className="sidebar-bottom"><button className="nav-item"><CircleHelp size={15} /><span>Help & docs</span></button><button className="user-row"><span className="user-avatar">OP</span><span className="user-copy"><strong>Operator</strong><small>Local admin</small></span><ChevronDown size={13} className="muted-icon" /></button></div>
  </aside>;
}

function stateLabel(state: PolicyState) {
  return state === "approval" ? "Approval required" : state === "allowed" ? "Allowed" : "Denied";
}

function StateBadge({ state }: { state: PolicyState }) {
  return <span className={`status-badge status-${state === "allowed" ? "success" : state === "denied" ? "danger" : "warning"}`}><span className="status-dot" />{stateLabel(state)}</span>;
}

function LoadingRows() {
  return <div className="loading-list">{[1, 2, 3, 4].map((item) => <div className="skeleton-row policy-skeleton" key={item}><span /><span /><span /><span /></div>)}</div>;
}

export default function ToolsPoliciesPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [policy, setPolicy] = useState<PolicyConfig | null>(null);
  const [tools, setTools] = useState<PolicyTool[]>([]);
  const [changes, setChanges] = useState<Record<string, PolicyState>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | PolicyState>("all");
  const [inventoryCount, setInventoryCount] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "unavailable" | "error">("loading");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<"idle" | "validating" | "valid" | "invalid">("idle");

  const load = useCallback(async () => {
    setStatus("loading");
    setMessage("");
    try {
      const [policyResult, inventoryResult] = await Promise.allSettled([getPolicy(), getDiscoveredTools()]);
      if (policyResult.status === "rejected") {
        setStatus("error");
        setMessage(policyResult.reason instanceof Error ? policyResult.reason.message : "The policy could not be loaded.");
        return;
      }
      if (inventoryResult.status === "rejected") {
        const error = inventoryResult.reason;
        setStatus(error instanceof ManagementApiError && error.status === 503 ? "unavailable" : "error");
        setMessage(error instanceof Error ? error.message : "The tool inventory could not be loaded.");
        return;
      }
      const nextPolicy = policyResult.value;
      const inventory = inventoryResult.value;
      const nextTools = mapPolicyTools(nextPolicy, inventory.tools);
      setPolicy(nextPolicy);
      setTools(nextTools);
      setInventoryCount(inventory.count);
      setValidation("idle");
      setStatus(inventory.count === 0 ? "empty" : "ready");
    } catch (error) {
      setStatus(error instanceof ManagementApiError && error.status === 503 ? "unavailable" : "error");
      setMessage(error instanceof Error ? error.message : "The management API request failed.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleTools = useMemo(() => tools.filter((tool) => {
    const state = changes[tool.name] ?? tool.state;
    const text = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (filter === "all" || state === filter);
  }), [changes, filter, query, tools]);
  const dirty = Object.keys(changes).length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function editTool(tool: PolicyTool, state: PolicyState) {
    setChanges((current) => ({ ...current, [tool.name]: state }));
    setValidation("idle");
    setMessage("");
  }

  function discard() {
    setChanges({});
    setValidation("idle");
    setMessage("");
  }

  async function save() {
    if (!policy || saving) return;
    setValidation("validating");
    setMessage("");
    const proposed = policyForTools(tools, changes, policy);
    try {
      const validated = await validatePolicy(proposed);
      setValidation("valid");
      setSaving(true);
      await savePolicy(validated);
      setChanges({});
      await load();
      setMessage("Policy saved successfully.");
    } catch (error) {
      setValidation("invalid");
      setMessage(error instanceof Error ? error.message : "The policy could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="app-shell">
    <div className={`mobile-overlay ${sidebarOpen ? "is-visible" : ""}`} onClick={() => setSidebarOpen(false)} /><div className={sidebarOpen ? "sidebar-mobile-open" : ""}><Sidebar onClose={() => setSidebarOpen(false)} /></div>
    <main className="main-content"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={18} /></button><div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-separator">/</span><strong>Tools & policies</strong></div><div className="topbar-actions"><button className="topbar-link"><BookOpen size={14} /> Docs</button><button className="icon-button" aria-label="Account"><CircleUserRound size={17} /></button></div></header>
      <div className="page-wrap"><div className="page-heading"><div><span className="eyebrow">Gateway control plane</span><h1>Tools & policies</h1><p>Review and assign effective access rules without bypassing gateway enforcement.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => void load()} disabled={status === "loading" || saving}><RefreshCw size={14} className={status === "loading" ? "spin" : ""} /> Refresh</button></div></div>
        <section className="integration-strip"><div className="integration-icon"><ShieldCheck size={15} /></div><div><strong>Authenticated management API</strong><span>{inventoryCount === null ? "Tool inventory is served by the configured Nox management endpoint." : `${inventoryCount} tools discovered by the gateway.`}</span></div><span className={`connection-state ${status === "ready" || status === "empty" ? "state-connected" : ""}`}><span className="status-dot" />{status === "ready" || status === "empty" ? "Connected" : status === "loading" ? "Loading" : "Unavailable"}</span></section>
        {status === "loading" ? <section className="audit-section"><LoadingRows /></section> : status === "unavailable" ? <section className="audit-section"><div className="empty-state"><div className="empty-icon empty-icon-error"><AlertCircle size={18} /></div><h2>Tool inventory unavailable</h2><p>The upstream tool inventory is currently unavailable.</p><button className="button button-secondary" onClick={() => void load()}>Try again</button></div></section> : status === "error" ? <section className="audit-section"><div className="empty-state"><div className="empty-icon empty-icon-error"><AlertCircle size={18} /></div><h2>Management API error</h2><p>{message}</p><button className="button button-secondary" onClick={() => void load()}>Try again</button></div></section> : status === "empty" ? <section className="audit-section"><div className="empty-state"><div className="empty-icon"><TerminalSquare size={18} /></div><h2>No tools discovered</h2><p>The upstream returned an empty tool inventory. Policy settings remain available for tools discovered later.</p></div></section> : <><div className="policy-notice"><AlertCircle size={15} /><span>Tool descriptions and metadata come from the upstream and are displayed without rendering schema contents.</span></div>
          <div className="toolbar"><label className="search-control"><Search size={15} /><span className="sr-only">Search tools</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools and descriptions" /></label><span className="toolbar-divider" /><label className="filter-control"><span className="sr-only">Filter by effective policy</span><select value={filter} onChange={(event) => setFilter(event.target.value as "all" | PolicyState)}><option value="all">All policies</option><option value="allowed">Allowed</option><option value="denied">Denied</option><option value="approval">Approval required</option></select><ChevronDown size={13} /></label></div>
          <section className="audit-section policy-section"><div className="section-heading"><div><h2>Discovered tools</h2><span className="result-count">{visibleTools.length} of {tools.length} discovered tools</span></div><span className="section-caption">Input schemas are {tools.some((tool) => tool.hasInputSchema) ? "available" : "not available"}</span></div>{visibleTools.length === 0 ? <div className="no-results"><Search size={19} /><h2>No matching tools</h2><p>Adjust the search or policy filter.</p></div> : <div className="table-wrap"><table><thead><tr><th>Tool</th><th>Description</th><th>Input schema</th><th>Effective policy</th><th>Rule source</th><th>Assignment</th></tr></thead><tbody>{visibleTools.map((tool) => { const state = changes[tool.name] ?? tool.state; return <tr key={tool.name}><td><span className="tool-name">{tool.name}</span></td><td><span className="reason-cell">{tool.description ?? "Not provided by upstream"}</span></td><td><span className="rule-source">{tool.hasInputSchema ? "Available" : "Unavailable"}</span></td><td><StateBadge state={state} /></td><td><span className="rule-source">{policyDescription(tool.source)}</span></td><td><select className="policy-select" aria-label={`Policy for ${tool.name}`} value={state} onChange={(event) => editTool(tool, event.target.value as PolicyState)}><option value="allowed">Allowed</option><option value="denied">Denied</option><option value="approval">Approval required</option></select></td></tr>; })}</tbody></table></div>}</section>
          <div className="policy-actions"><span className={validation === "invalid" ? "form-error" : validation === "valid" ? "form-success" : "form-message"}>{message || (dirty ? "You have unsaved policy changes." : "No unsaved changes.")}</span><div className="heading-actions"><button className="button button-secondary" onClick={discard} disabled={!dirty || saving}>Discard</button><button className="button button-primary" onClick={() => void save()} disabled={!dirty || saving || validation === "validating"}>{validation === "validating" ? "Validating..." : saving ? "Saving..." : <><Check size={14} /> Save changes</>}</button></div></div>
        </>}
      </div>
    </main>
  </div>;
}
