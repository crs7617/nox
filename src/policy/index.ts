import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type PolicyDecision = {
  allowed: boolean;
  reason: string;
};

export type PolicyConfig = {
  allow: string[];
  deny: string[];
  approval: string[];
  approvalTimeoutMs: number;
};

export class PolicyConfigurationError extends Error {}

const emptyPolicy: PolicyConfig = { allow: [], deny: [], approval: [], approvalTimeoutMs: 30000 };

function validateRuleList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((rule) => typeof rule !== "string" || rule.trim() === "")) {
    throw new PolicyConfigurationError(`${name} must be an array of non-empty tool names`);
  }

  return value.map((rule) => rule.trim());
}

export function parsePolicyConfiguration(value: unknown): PolicyConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PolicyConfigurationError("Policy must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => !["allow", "deny", "approval", "approvalTimeoutMs"].includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new PolicyConfigurationError(`Unknown policy field(s): ${unknownKeys.join(", ")}`);
  }

  const allow = record.allow === undefined ? [] : validateRuleList(record.allow, "allow");
  const deny = record.deny === undefined ? [] : validateRuleList(record.deny, "deny");
  const approval =
    record.approval === undefined ? [] : validateRuleList(record.approval, "approval");
  const approvalTimeoutMs = record.approvalTimeoutMs ?? 30000;
  if (
    typeof approvalTimeoutMs !== "number" ||
    !Number.isInteger(approvalTimeoutMs) ||
    approvalTimeoutMs <= 0
  ) {
    throw new PolicyConfigurationError("approvalTimeoutMs must be a positive integer");
  }
  const overlap = allow.filter((tool) => deny.includes(tool));
  if (overlap.length > 0) {
    throw new PolicyConfigurationError(
      `Contradictory policy rules for tool(s): ${overlap.join(", ")}`,
    );
  }

  return { allow, deny, approval, approvalTimeoutMs };
}

export function loadPolicyConfiguration(
  policyPath = process.env.NOX_POLICY_FILE ?? "nox-policy.json",
): PolicyConfig {
  try {
    const contents = readFileSync(resolve(policyPath), "utf8");
    return parsePolicyConfiguration(JSON.parse(contents) as unknown);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT" &&
      process.env.NOX_POLICY_FILE === undefined
    ) {
      return emptyPolicy;
    }

    if (error instanceof PolicyConfigurationError) {
      throw error;
    }

    throw new PolicyConfigurationError(
      `Unable to load policy configuration "${policyPath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function createPolicyEngine(
  config: PolicyConfig,
  environmentDeniedTools: Iterable<string> = [],
) {
  const environmentDeny = new Set(environmentDeniedTools);

  return {
    evaluate(toolName: string): PolicyDecision {
      if (environmentDeny.has(toolName)) {
        return { allowed: false, reason: "Denied by NOX_DENY_TOOLS" };
      }

      if (config.deny.includes(toolName)) {
        return { allowed: false, reason: "Denied by policy file" };
      }

      if (config.allow.length > 0 && !config.allow.includes(toolName)) {
        return { allowed: false, reason: "Not listed in policy allow rules" };
      }

      return { allowed: true, reason: "Allowed by policy" };
    },
  };
}

export function parseEnvironmentDeniedTools(value = process.env.NOX_DENY_TOOLS): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
}
