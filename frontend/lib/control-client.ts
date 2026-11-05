export type Approval = {
  id: string;
  toolName: string;
  upstream: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "rejected" | "expired";
};

export type Upstream = {
  id: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  status: string;
  toolCount: number;
};

export class ControlApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/management${path}`, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ControlApiError(response.status, body.message ?? "The management API request failed.");
  }
  return body as T;
}

export function getApprovals() {
  return call<{ count: number; approvals: Approval[] }>("/approvals");
}

export function resolveApproval(id: string, decision: "approve" | "reject") {
  return call<{ approval: Approval }>(`/approvals/${encodeURIComponent(id)}/${decision}`, { method: "POST" });
}

export function getUpstreams() {
  return call<{ restartRequired: boolean; upstreams: Upstream[] }>("/upstreams");
}

export function saveUpstream(configuration: Record<string, unknown>, id?: string) {
  return call<Upstream>(id ? `/upstreams/${id}` : "/upstreams", {
    method: id ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(configuration),
  });
}

export function testUpstream(configuration: Record<string, unknown>) {
  return call<{ connected: boolean; toolCount: number }>("/upstreams/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(configuration),
  });
}

export function removeUpstream(id: string) {
  return call(`/upstreams/${id}`, { method: "DELETE" });
}
