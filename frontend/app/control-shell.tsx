"use client";

import { ChevronDown, CircleHelp, CircleUserRound, FileClock, Gauge, KeyRound, Menu, Network, ShieldCheck, TerminalSquare, X } from "lucide-react";
import { useState, type ReactNode } from "react";

const navigation = [
  ["Overview", Gauge, "/"],
  ["Tools & policies", TerminalSquare, "/tools-policies"],
  ["Approvals", KeyRound, "/approvals"],
  ["Audit logs", FileClock, "#"],
  ["Upstreams", Network, "/upstreams"],
] as const;

export function ControlShell({ active, children }: { active: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="app-shell">
    <div className={`mobile-overlay ${open ? "is-visible" : ""}`} onClick={() => setOpen(false)} />
    <div className={open ? "sidebar-mobile-open" : ""}><aside className="sidebar">
      <div className="sidebar-top"><div className="brand"><span className="brand-mark"><ShieldCheck size={15} /></span><span>Nox</span><ChevronDown size={13} className="muted-icon" /></div><button className="icon-button mobile-close" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={16} /></button></div>
      <div className="workspace-switcher"><span className="workspace-avatar">N</span><span className="workspace-name">Local workspace</span></div>
      <nav aria-label="Primary navigation" className="nav-section"><span className="nav-label">Workspace</span>{navigation.map(([label, Icon, href]) => <a key={label} href={href} onClick={() => setOpen(false)} className={`nav-item ${active === label ? "nav-active" : ""}`}><Icon size={15} /><span>{label}</span>{active === label && <span className="nav-indicator" />}</a>)}</nav>
      <div className="sidebar-bottom"><button className="nav-item"><CircleHelp size={15} /><span>Help & docs</span></button><button className="user-row"><span className="user-avatar">OP</span><span className="user-copy"><strong>Operator</strong><small>Local admin</small></span><ChevronDown size={13} /></button></div>
    </aside></div>
    <main className="main-content"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={18} /></button><div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-separator">/</span><strong>{active}</strong></div><div className="topbar-actions"><button className="icon-button" aria-label="Account"><CircleUserRound size={17} /></button></div></header>{children}</main>
  </div>;
}

export function StateBadge({ value }: { value: string }) {
  const tone = value === "approved" || value === "connected" ? "success" : value === "rejected" || value === "expired" || value === "disconnected" ? "danger" : "warning";
  return <span className={`status-badge status-${tone}`}><span className="status-dot" />{value}</span>;
}
