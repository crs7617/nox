import { describe, expect, it } from "vitest";
import { emptyPolicy, mapPolicyTools, policyForTools } from "./policy";

describe("policy mapping", () => {
  it("applies deny precedence and distinguishes explicit and default behavior", () => {
    const tools = mapPolicyTools({
      ...emptyPolicy,
      allow: ["safe"],
      deny: ["blocked", "approval-wins"],
      approval: ["approval-wins", "needs-review"],
    });
    expect(tools).toEqual([
      { name: "approval-wins", state: "denied", source: "explicit-deny" },
      { name: "blocked", state: "denied", source: "explicit-deny" },
      { name: "needs-review", state: "approval", source: "explicit-approval" },
      { name: "safe", state: "allowed", source: "explicit-allow" },
    ]);
  });

  it("maps allow-list omissions to default deny", () => {
    expect(mapPolicyTools({ ...emptyPolicy, allow: ["known"] })).toEqual([
      { name: "known", state: "allowed", source: "explicit-allow" },
    ]);
  });

  it("creates a complete policy from edited assignments", () => {
    const tools = mapPolicyTools({ ...emptyPolicy, allow: ["safe"], deny: ["blocked"] });
    expect(policyForTools(tools, { safe: "approval", blocked: "allowed" }, {
      ...emptyPolicy,
      approvalTimeoutMs: 1200,
      upstreamTimeoutMs: 3400,
    })).toEqual({
      allow: ["blocked"],
      deny: [],
      approval: ["safe"],
      approvalTimeoutMs: 1200,
      upstreamTimeoutMs: 3400,
    });
  });

  it("maps the complete discovered inventory while preserving undiscovered rules", () => {
    const policy = { ...emptyPolicy, allow: ["future"], deny: ["blocked"] };
    const tools = mapPolicyTools(policy, [
      { name: "visible", description: "Visible tool", hasInputSchema: true },
    ]);
    expect(tools).toEqual([
      {
        name: "visible",
        description: "Visible tool",
        hasInputSchema: true,
        state: "denied",
        source: "default-deny",
      },
    ]);
    expect(policyForTools(tools, { visible: "approval" }, policy)).toEqual({
      ...policy,
      allow: ["future"],
      deny: ["blocked"],
      approval: ["visible"],
    });
  });
});
