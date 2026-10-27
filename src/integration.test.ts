import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

describe("Nox integration", () => {
  it("returns an MCP error without executing the upstream handler", async () => {
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: {
        NOX_DENY_TOOLS: "greet",
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
    } finally {
      await client.close();
    }
  }, 15000);
});
