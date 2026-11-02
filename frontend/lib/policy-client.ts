import { normalizePolicy, type PolicyConfig } from "./policy";

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
    throw new Error(message);
  }
  return body as T;
}

export async function getPolicy(): Promise<PolicyConfig> {
  return normalizePolicy(await requestJson("policy"));
}

export async function getDiscoveredToolCount(): Promise<number | null> {
  const body = await requestJson<{ discoveredToolCount?: unknown }>("health");
  return typeof body.discoveredToolCount === "number" ? body.discoveredToolCount : null;
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
