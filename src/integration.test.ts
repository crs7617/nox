import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Nox integration", () => {
  it("allows greet and audits the successful call", async () => {
    const auditFile = join(tmpdir(), `nox-allowed-${Date.now()}.jsonl`);
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: { NOX_AUDIT_FILE: auditFile },
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "greet",
        arguments: { name: "Test" },
      });

      expect(result.isError).not.toBe(true);
      const event = JSON.parse((await readFile(auditFile, "utf8")).trim());
      expect(event).toMatchObject({
        tool: "greet",
        decision: "allowed",
        outcome: "success",
      });
      expect(event).not.toHaveProperty("arguments");
      expect(event).not.toHaveProperty("result");
    } finally {
      await client.close();
      await rm(auditFile, { force: true });
    }
  }, 15000);

  it("returns an MCP error without executing the upstream handler", async () => {
    const auditFile = join(tmpdir(), `nox-denied-${Date.now()}.jsonl`);
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: {
        NOX_DENY_TOOLS: "greet",
        NOX_AUDIT_FILE: auditFile,
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "greet",
        arguments: { name: "Test" },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "Blocked by Nox policy: Denied by NOX_DENY_TOOLS" },
      ]);
      expect(stderr).not.toContain("[NOX-DEMO] greet handler executed");
      const event = JSON.parse((await readFile(auditFile, "utf8")).trim());
      expect(event).toMatchObject({
        tool: "greet",
        decision: "denied",
        outcome: "error",
        reason: "Denied by NOX_DENY_TOOLS",
      });
    } finally {
      await client.close();
      await rm(auditFile, { force: true });
    }
  }, 15000);
});
