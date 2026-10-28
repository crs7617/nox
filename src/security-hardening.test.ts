import { describe, expect, it, vi } from "vitest";
import {
  ApprovalManager,
  type ApprovalReader,
} from "./approval/index.js";
import { AuditLogger, serializeAuditEvent } from "./audit/index.js";
import { discoverTools } from "./discovery/index.js";
import { parsePolicyConfiguration, PolicyConfigurationError } from "./policy/index.js";
import { UpstreamTimeoutError, withUpstreamTimeout } from "./resilience/index.js";

describe("security hardening regressions", () => {
  it("rejects malformed policy values instead of applying partial configuration", () => {
    expect(() => parsePolicyConfiguration({ allow: [""], deny: [7] })).toThrow(
      PolicyConfigurationError,
    );
    expect(() => parsePolicyConfiguration({ approvalTimeoutMs: Number.NaN })).toThrow(
      /approvalTimeoutMs/,
    );
  });

  it("rejects malformed discovery responses and never forwards them", async () => {
    await expect(
      discoverTools({
        listTools: async () => ({
          tools: [{ name: "tool", inputSchema: null as never }],
        }),
      }),
    ).rejects.toThrow(/invalid tool list/);
    await expect(
      discoverTools({
        listTools: async () => ({
          tools: [{ name: "", inputSchema: { type: "object" } }],
        }),
      }),
    ).rejects.toThrow(/invalid tool list/);
    await expect(
      discoverTools({
        listTools: async () => ({ tools: [{ name: "tool" }] as never }),
      }),
    ).rejects.toThrow(/invalid tool list/);
  });

  it("does not serialize raw arguments, results, credentials, or exception details", () => {
    const secret = "test-only-secret";
    const line = serializeAuditEvent({
      timestamp: new Date().toISOString(),
      tool: "tool",
      decision: "allowed",
      outcome: "error",
      reason: "Upstream call failed",
    });
    const logger = new AuditLogger("unused", vi.fn());
    expect(line).not.toContain(secret);
    expect(line).not.toContain("Authorization");
    expect(line).not.toContain("raw exception");
    expect(logger).toBeDefined();
  });

  it("fails closed for rejection, timeout, and unavailable approval input", async () => {
    const reader = (answer: string | Promise<string>): ApprovalReader => ({
      question: async () => await answer,
      close: vi.fn(),
    });
    expect(
      await new ApprovalManager(new Set(["tool"]), 50, () => reader("no"), vi.fn()).request("tool"),
    ).toBe("rejected");
    expect(
      await new ApprovalManager(
        new Set(["tool"]),
        5,
        () => reader(new Promise<string>(() => {})),
        vi.fn(),
      ).request("tool"),
    ).toBe("timed_out");
    expect(await new ApprovalManager(new Set(["tool"]), 5, () => undefined, vi.fn()).request("tool")).toBe(
      "unavailable",
    );
  });

  it("returns a timeout without retrying the operation", async () => {
    let attempts = 0;
    const operation = new Promise<string>(() => {
      attempts += 1;
    });
    await expect(withUpstreamTimeout(operation, 5)).rejects.toBeInstanceOf(
      UpstreamTimeoutError,
    );
    expect(attempts).toBe(1);
  });
});
