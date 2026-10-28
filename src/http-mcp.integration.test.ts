import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

async function startHttpUpstream(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = new Server(
    { name: "nox-http-test-server", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "remote-add",
        description: "Add two remote numbers.",
        inputSchema: {
          type: "object",
          properties: { left: { type: "number" }, right: { type: "number" } },
          required: ["left", "right"],
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [
      {
        type: "text",
        text: String(
          Number(request.params.arguments?.left) + Number(request.params.arguments?.right),
        ),
      },
    ],
  }));

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);
  const httpServer = createServer((request, response) => {
    void transport.handleRequest(request, response);
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      await transport.close();
      await server.close();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    },
  };
}

function createNoxTransport(url: string) {
  return new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    env: {
      NOX_UPSTREAM_TRANSPORT: "http",
      NOX_UPSTREAM_URL: url,
    },
    stderr: "pipe",
  });
}

describe("Nox with a Streamable HTTP upstream", () => {
  it("discovers metadata and forwards a remote tool call", async () => {
    const upstream = await startHttpUpstream();
    const client = new Client({ name: "nox-http-integration-test", version: "1.0.0" });
    const transport = createNoxTransport(upstream.url);
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools).toMatchObject([
        {
          name: "remote-add",
          description: "Add two remote numbers.",
          inputSchema: { required: ["left", "right"] },
        },
      ]);
      await expect(
        client.callTool({ name: "remote-add", arguments: { left: 4, right: 6 } }),
      ).resolves.toEqual({ content: [{ type: "text", text: "10" }] });
    } finally {
      await client.close();
      await upstream.close();
    }
  }, 30000);

  it("reports a safe connection failure for an unavailable HTTP upstream", async () => {
    const client = new Client({ name: "nox-http-failure-test", version: "1.0.0" });
    const transport = createNoxTransport("http://127.0.0.1:1/mcp");
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    await expect(client.connect(transport)).rejects.toThrow();
    expect(stderr).toContain("[NOX] Startup failed: upstream unavailable");
    await client.close();
  }, 15000);
});
