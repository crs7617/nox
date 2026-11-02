export type PolicyConfig = {
  allow: string[];
  deny: string[];
  approval: string[];
  approvalTimeoutMs: number;
  upstreamTimeoutMs: number;
};

export type PolicyState = "allowed" | "denied" | "approval";
export type PolicySource =
  | "explicit-allow"
  | "explicit-deny"
  | "explicit-approval"
  | "default-allow"
  | "default-deny";

export type PolicyTool = {
  name: string;
  description?: string;
  state: PolicyState;
  source: PolicySource;
};

export const emptyPolicy: PolicyConfig = {
  allow: [],
  deny: [],
  approval: [],
  approvalTimeoutMs: 30000,
  upstreamTimeoutMs: 30000,
};

export function normalizePolicy(value: unknown): PolicyConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The management API returned an invalid policy.");
  }
  const record = value as Record<string, unknown>;
  const lists = ["allow", "deny", "approval"] as const;
  for (const key of lists) {
    if (!Array.isArray(record[key]) || record[key].some((item) => typeof item !== "string")) {
      throw new Error(`The management API returned an invalid ${key} rule list.`);
    }
  }
  if (
    typeof record.approvalTimeoutMs !== "number" ||
    typeof record.upstreamTimeoutMs !== "number"
  ) {
    throw new Error("The management API returned invalid policy timeouts.");
  }
  return {
    allow: [...(record.allow as string[])],
    deny: [...(record.deny as string[])],
    approval: [...(record.approval as string[])],
    approvalTimeoutMs: record.approvalTimeoutMs,
    upstreamTimeoutMs: record.upstreamTimeoutMs,
  };
}

export function mapPolicyTools(policy: PolicyConfig): PolicyTool[] {
  const names = new Set([...policy.allow, ...policy.deny, ...policy.approval]);
  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
    if (policy.deny.includes(name)) {
      return { name, state: "denied", source: "explicit-deny" };
    }
    if (policy.approval.includes(name)) {
      return { name, state: "approval", source: "explicit-approval" };
    }
    if (policy.allow.includes(name)) {
      return { name, state: "allowed", source: "explicit-allow" };
    }
    return policy.allow.length > 0
      ? { name, state: "denied", source: "default-deny" }
      : { name, state: "allowed", source: "default-allow" };
  });
}

export function policyForTools(
  tools: PolicyTool[],
  changes: Record<string, PolicyState>,
  base: PolicyConfig = emptyPolicy,
): PolicyConfig {
  const next = {
    allow: [] as string[],
    deny: [] as string[],
    approval: [] as string[],
  };
  for (const tool of tools) {
    const state = changes[tool.name] ?? tool.state;
    next[state === "allowed" ? "allow" : state === "denied" ? "deny" : "approval"].push(tool.name);
  }
  return { ...base, ...next };
}

export function policyDescription(source: PolicySource): string {
  return {
    "explicit-allow": "Explicit allow rule",
    "explicit-deny": "Explicit deny rule",
    "explicit-approval": "Explicit approval rule",
    "default-allow": "Default allow behavior",
    "default-deny": "Default deny behavior",
  }[source];
}
