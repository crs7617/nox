import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

function createNoxTransport(environment: Record<string, string> = {}) {
  return new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    env: {
      NOX_UPSTREAM_COMMAND: "npx",
      NOX_UPSTREAM_ARGS: JSON.stringify(["tsx", "src/local-test-server.ts"]),
      ...environment,
    },
    stderr: "pipe",
  });
}

describe("Nox with an independent local MCP server", () => {
  it("discovers metadata and forwards a successful tool call", async () => {
    const client = new Client({ name: "nox-local-integration-test", version: "1.0.0" });
    const transport = createNoxTransport();

    try {
      await client.connect(transport);
      const tools = await client.listTools();

      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "add",
        "blocked-operation",
      ]);
      expect(tools.tools[0]).toMatchObject({
        name: "add",
        description: "Add two numbers.",
        inputSchema: {
          type: "object",
          properties: {
            left: { type: "number" },
            right: { type: "number" },
          },
          required: ["left", "right"],
        },
      });

      const result = await client.callTool({
        name: "add",
        arguments: { left: 2, right: 3 },
      });
      expect(result).toEqual({
        content: [{ type: "text", text: "5" }],
      });
    } finally {
      await client.close();
    }
  }, 30000);

  it("denies a tool before the independent upstream handler runs", async () => {
    const client = new Client({ name: "nox-local-policy-test", version: "1.0.0" });
    const transport = createNoxTransport({
      NOX_DENY_TOOLS: "blocked-operation",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "blocked-operation",
        arguments: {},
      });

      expect(result).toEqual({
        content: [
          { type: "text", text: "Blocked by Nox policy: Denied by NOX_DENY_TOOLS" },
        ],
        isError: true,
      });
      expect(stderr).not.toContain("[NOX-LOCAL-TEST] blocked-operation handler executed");
    } finally {
      await client.close();
    }
  }, 30000);

  it("fails safely when the configured upstream executable is unavailable", async () => {
    const client = new Client({ name: "nox-local-startup-failure-test", version: "1.0.0" });
    const transport = createNoxTransport({
      NOX_UPSTREAM_COMMAND: "nox-upstream-executable-that-does-not-exist",
      NOX_UPSTREAM_ARGS: "[]",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    await expect(client.connect(transport)).rejects.toThrow();
    expect(stderr).toContain("[NOX] Startup failed: upstream unavailable");
    await client.close();
  }, 15000);
});
