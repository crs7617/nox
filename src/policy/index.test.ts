import { describe, expect, it } from "vitest";
import {
  createPolicyEngine,
  parseEnvironmentDeniedTools,
  parsePolicyConfiguration,
  PolicyConfigurationError,
} from "./index.js";

describe("policy engine", () => {
  it("allows tools by default", () => {
    expect(
      createPolicyEngine({
        allow: [],
        deny: [],
        approval: [],
        approvalTimeoutMs: 30000,
        upstreamTimeoutMs: 30000,
      }).evaluate("greet"),
    ).toEqual({
      allowed: true,
      reason: "Allowed by policy",
    });
  });

  it("denies tools listed in deny rules", () => {
    expect(
      createPolicyEngine({
        allow: [],
        deny: ["greet"],
        approval: [],
        approvalTimeoutMs: 30000,
        upstreamTimeoutMs: 30000,
      }).evaluate("greet"),
    ).toEqual({
      allowed: false,
      reason: "Denied by policy file",
    });
  });

  it("gives deny rules precedence over allow rules", () => {
    expect(
      createPolicyEngine({
        allow: ["greet"],
        deny: ["other"],
        approval: [],
        approvalTimeoutMs: 30000,
        upstreamTimeoutMs: 30000,
      }).evaluate("other"),
    ).toEqual({
      allowed: false,
      reason: "Denied by policy file",
    });
  });

  it("rejects malformed and contradictory configurations", () => {
    expect(() => parsePolicyConfiguration({ allow: "greet" })).toThrow(
      PolicyConfigurationError,
    );
    expect(() =>
      parsePolicyConfiguration({ allow: ["greet"], deny: ["greet"] }),
    ).toThrow(/Contradictory/);
    expect(() => parsePolicyConfiguration({ upstreamTimeoutMs: 0 })).toThrow(
      /upstreamTimeoutMs/,
    );
  });

  it("lets the environment deny tools without overriding a deny", () => {
    const policy = createPolicyEngine(
      {
        allow: ["greet"],
        deny: [],
        approval: [],
        approvalTimeoutMs: 30000,
        upstreamTimeoutMs: 30000,
      },
      ["greet"],
    );
    expect(policy.evaluate("greet")).toEqual({
      allowed: false,
      reason: "Denied by NOX_DENY_TOOLS",
    });
    expect(parseEnvironmentDeniedTools(" greet, other ")).toEqual(
      new Set(["greet", "other"]),
    );
  });
});
