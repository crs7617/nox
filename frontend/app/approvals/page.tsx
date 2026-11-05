"use client";

import { Check, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ControlShell, StateBadge } from "../control-shell";
import { getApprovals, resolveApproval, type Approval, ControlApiError } from "@/lib/control-client";

function time(value: string) { return new Date(value).toLocaleString(); }

export default function ApprovalsPage() {
  const [items, setItems] = useState<Approval[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error" | "disconnected">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try { const result = await getApprovals(); setItems(result.approvals); setState(result.approvals.length ? "ready" : "empty"); }
    catch (error) { setState(error instanceof ControlApiError && error.status >= 500 ? "disconnected" : "error"); setMessage(error instanceof Error ? error.message : "Approvals could not be loaded."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function decide(item: Approval, decision: "approve" | "reject") {
    if (!window.confirm(`${decision === "approve" ? "Approve" : "Reject"} ${item.toolName}?`)) return;
    setBusy(item.id);
    try { await resolveApproval(item.id, decision); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The approval decision failed."); }
    finally { setBusy(null); }
  }
  return <ControlShell active="Approvals"><div className="page-wrap"><div className="page-heading"><div><span className="eyebrow">Human-in-the-loop control</span><h1>Approvals</h1><p>Review tool requests without exposing execution arguments.</p></div><button className="button button-secondary" onClick={() => void load()} disabled={state === "loading"}><RefreshCw size={14} /> Refresh</button></div>
    {state === "loading" && <section className="audit-section"><div className="loading-list"><div className="skeleton-row"><span /><span /><span /><span /></div></div></section>}
    {state !== "loading" && (state === "error" || state === "disconnected") && <div className="empty-state"><div className="empty-icon empty-icon-error"><X size={18} /></div><h2>{state === "disconnected" ? "Gateway unavailable" : "Approvals unavailable"}</h2><p>{message}</p></div>}
    {state === "empty" && <div className="empty-state"><div className="empty-icon"><ShieldCheck size={18} /></div><h2>No pending approvals</h2><p>Requests requiring a decision will appear here.</p></div>}
    {state === "ready" && <section className="audit-section"><div className="section-heading"><h2>Pending requests <span className="result-count">{items.length}</span></h2></div><div className="table-wrap"><table><thead><tr><th>Tool</th><th>Upstream</th><th>Created</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="tool-name">{item.toolName}</td><td>{item.upstream}</td><td>{time(item.createdAt)}</td><td>{time(item.expiresAt)}</td><td><StateBadge value={item.status} /></td><td><button className="button button-primary" disabled={busy === item.id} onClick={() => void decide(item, "approve")}><Check size={13} /> Approve</button> <button className="button button-secondary" disabled={busy === item.id} onClick={() => void decide(item, "reject")}><X size={13} /> Reject</button></td></tr>)}</tbody></table></div>{message && <div className="policy-notice">{message}</div>}</section>}
  </div></ControlShell>;
}
