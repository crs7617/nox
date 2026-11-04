import { normalizePolicy, type DiscoveredTool, type PolicyConfig } from "./policy";

export class ManagementApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ManagementApiError";
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/management/${path}`, { ...init, cache: "no-store" });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : "The management API request failed.";
    throw new ManagementApiError(message, response.status);
  }
  return body as T;
}

export async function getPolicy(): Promise<PolicyConfig> {
  return normalizePolicy(await requestJson("policy"));
}

export async function getDiscoveredTools(): Promise<{ count: number; tools: DiscoveredTool[] }> {
  const body = await requestJson<{ count?: unknown; tools?: unknown }>("tools");
  if (
    typeof body.count !== "number" ||
    !Array.isArray(body.tools) ||
    body.tools.some((tool) => {
      if (typeof tool !== "object" || tool === null || Array.isArray(tool)) return true;
      const record = tool as Record<string, unknown>;
      return (
        typeof record.name !== "string" ||
        (record.description !== undefined && typeof record.description !== "string") ||
        typeof record.inputSchema !== "object" ||
        record.inputSchema === null ||
        Array.isArray(record.inputSchema)
      );
    })
  ) {
    throw new Error("The management API returned an invalid tool inventory.");
  }
  return {
    count: body.count,
    tools: body.tools.map((tool) => {
      const record = tool as Record<string, unknown>;
      return {
        name: record.name as string,
        ...(record.description === undefined ? {} : { description: record.description as string }),
        hasInputSchema: true,
      };
    }),
  };
}

export async function validatePolicy(policy: PolicyConfig): Promise<PolicyConfig> {
  const body = await requestJson<{ valid?: unknown; policy?: unknown }>("policy/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(policy),
  });
  if (body.valid !== true || body.policy === undefined) {
    throw new Error("The management API returned an invalid validation response.");
  }
  return normalizePolicy(body.policy);
}

export async function savePolicy(policy: PolicyConfig): Promise<PolicyConfig> {
  return normalizePolicy(
    await requestJson("policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(policy),
    }),
  );
}
