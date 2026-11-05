"use client";

import { Network, RefreshCw, ShieldCheck, Trash2, Wifi, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ControlShell, StateBadge } from "../control-shell";
import { getUpstreams, removeUpstream, saveUpstream, testUpstream, type Upstream } from "@/lib/control-client";

export default function UpstreamsPage() {
  const [items, setItems] = useState<Upstream[]>([]);
  const [restartRequired, setRestartRequired] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [message, setMessage] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const result = await getUpstreams();
      setItems(result.upstreams);
      setRestartRequired(result.restartRequired);
      const current = result.upstreams[0];
      if (current) {
        setTransport(current.transport);
        setCommand(current.command ?? "");
        setArgs((current.args ?? []).join("\n"));
        setUrl(current.url ?? "");
      }
      setState(result.upstreams.length ? "ready" : "empty");
    }
    catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Upstreams could not be loaded."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  function configuration() { return transport === "stdio" ? { transport, command, args: args.split("\n").filter(Boolean) } : { transport, url }; }
  async function save() {
    setMessage("");
    try { await saveUpstream(configuration(), items[0]?.id); await load(); setMessage("Configuration saved. Restart the gateway to apply it."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Configuration could not be saved."); }
  }
  async function test() {
    setTesting(true); setMessage("");
    try { const result = await testUpstream(configuration()); setMessage(result.connected ? `Connection succeeded; ${result.toolCount} tools discovered.` : "Connection failed."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Connection test failed."); }
    finally { setTesting(false); }
  }
  async function remove() {
    if (!items[0] || !window.confirm("Remove this upstream configuration?")) return;
    try { await removeUpstream(items[0].id); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "The upstream could not be removed while running."); }
  }
  return <ControlShell active="Upstreams"><div className="page-wrap"><div className="page-heading"><div><span className="eyebrow">Gateway connections</span><h1>Upstreams</h1><p>Inspect MCP servers and validate changes before restarting Nox.</p></div><button className="button button-secondary" onClick={() => void load()} disabled={state === "loading"}><RefreshCw size={14} /> Refresh</button></div>
    {state === "error" && <div className="empty-state"><div className="empty-icon empty-icon-error"><X size={18} /></div><h2>Upstreams unavailable</h2><p>{message}</p></div>}
    {state !== "error" && <><section className="audit-section"><div className="section-heading"><h2>Configured upstreams</h2>{restartRequired && <span className="status-badge status-warning">Restart required</span>}</div>{state === "empty" ? <div className="empty-state"><div className="empty-icon"><Network size={18} /></div><h2>No upstream configured</h2><p>Add a supported stdio or Streamable HTTP server below.</p></div> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Transport</th><th>Status</th><th>Tools</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="tool-name">{item.id}</td><td>{item.transport}</td><td><StateBadge value={item.status} /></td><td>{item.toolCount}</td><td><button className="icon-button" onClick={() => void remove()} aria-label="Remove upstream"><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>}</section>
      <section className="audit-section" style={{ marginTop: 20 }}><div className="section-heading"><h2>{items.length ? "Edit configuration" : "Add upstream"}</h2></div><div style={{ padding: 17 }}><label className="form-message">Transport <select className="policy-select" value={transport} onChange={(event) => setTransport(event.target.value as "stdio" | "http")}><option value="stdio">Local stdio</option><option value="http">Streamable HTTP</option></select></label>{transport === "stdio" ? <><label className="form-message" style={{ display: "block", marginTop: 14 }}>Command<input className="search-control" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="node" /></label><label className="form-message" style={{ display: "block", marginTop: 14 }}>Arguments, one per line<textarea className="search-control" value={args} onChange={(event) => setArgs(event.target.value)} /></label></> : <label className="form-message" style={{ display: "block", marginTop: 14 }}>HTTPS URL<input className="search-control" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://server.example/mcp" /></label>}<div className="policy-actions"><span className="form-message">{message}</span><span><button className="button button-secondary" onClick={() => void test()} disabled={testing}><Wifi size={13} /> Test connection</button> <button className="button button-primary" onClick={() => void save()}><ShieldCheck size={13} /> Save</button></span></div></div></section></>}
  </div></ControlShell>;
}
