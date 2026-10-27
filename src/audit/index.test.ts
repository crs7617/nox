import { describe, expect, it, vi } from "vitest";
import { AuditLogger, serializeAuditEvent } from "./index.js";

describe("audit logger", () => {
  it("serializes only privacy-safe event fields", () => {
    const line = serializeAuditEvent({
      timestamp: "2026-10-27T00:00:00.000Z",
      tool: "secret-tool\n",
      decision: "denied",
      outcome: "error",
      reason: "Denied by policy",
    });

    expect(JSON.parse(line)).toEqual({
      timestamp: "2026-10-27T00:00:00.000Z",
      tool: "secret-tool?",
      decision: "denied",
      outcome: "error",
      reason: "Denied by policy",
    });
    expect(line).not.toContain("arguments");
    expect(line).not.toContain("result");
  });

  it("appends JSONL events in order", async () => {
    const lines: string[] = [];
    const logger = new AuditLogger(
      "audit.jsonl",
      async (_path, line) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        lines.push(line);
      },
    );

    await Promise.all([
      logger.write({
        timestamp: "2026-10-27T00:00:00.000Z",
        tool: "first",
        decision: "allowed",
        outcome: "success",
      }),
      logger.write({
        timestamp: "2026-10-27T00:00:01.000Z",
        tool: "second",
        decision: "denied",
        outcome: "error",
      }),
    ]);

    expect(lines.map((line) => JSON.parse(line).tool)).toEqual(["first", "second"]);
  });

  it("reports write failures without claiming persistence", async () => {
    const warn = vi.fn();
    const logger = new AuditLogger(
      "audit.jsonl",
      async () => {
        throw new Error("disk full");
      },
      warn,
    );

    await expect(
      logger.write({
        timestamp: "2026-10-27T00:00:00.000Z",
        tool: "greet",
        decision: "allowed",
        outcome: "success",
      }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith("Could not persist audit event");
  });

  it("writes a warning to stderr when the default warning handler is used", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new AuditLogger("audit.jsonl", async () => {
      throw new Error("disk full");
    });

    await logger.write({
      timestamp: "2026-10-27T00:00:00.000Z",
      tool: "greet",
      decision: "denied",
      outcome: "error",
    });

    expect(error).toHaveBeenCalledWith(
      "[NOX] Audit warning: Could not persist audit event",
    );
    error.mockRestore();
  });
});
